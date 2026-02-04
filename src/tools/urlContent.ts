import { z } from "zod";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface DocumentChunk {
    position: number;
    headers: string[];
    content: string;
    summary: string;
    charCount: number;
    hasOverlap: boolean;
}

interface StoredDocument {
    url: string;
    title: string;
    excerpt: string;
    byline: string;
    chunks: DocumentChunk[];
    fetchedAt: Date;
    isReaderable: boolean;
}

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const TARGET_CHUNK_SIZE = 2000;   // Target characters per chunk
const MAX_CHUNK_SIZE = 3000;      // Hard limit
const OVERLAP_SIZE = 200;         // ~10% overlap for context preservation
const DOCUMENT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─────────────────────────────────────────────────────────────
// In-memory document store
// ─────────────────────────────────────────────────────────────

const documentStore = new Map<string, StoredDocument>();

function cleanupExpiredDocuments(): void {
    const now = Date.now();
    for (const [url, doc] of documentStore) {
        if (now - doc.fetchedAt.getTime() > DOCUMENT_TTL_MS) {
            documentStore.delete(url);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// HTML to Markdown converter (for post-Readability processing)
// ─────────────────────────────────────────────────────────────

const nhm = new NodeHtmlMarkdown({
    codeFence: "```",
    bulletMarker: "-",
    maxConsecutiveNewlines: 2,
});

// ─────────────────────────────────────────────────────────────
// Junk header detection
// ─────────────────────────────────────────────────────────────

const JUNK_HEADERS = new Set([
    // Programming languages (often tab labels)
    "python", "javascript", "typescript", "rest", "go", "java", "kotlin",
    "swift", "ruby", "php", "c#", "c++", "rust", "dart", "shell", "bash",
    "curl", "http", "json", "yaml", "xml", "html", "css", "sql", "graphql",
    // Frameworks/platforms (tab labels)
    "apps script", "node.js", "node", "deno", "bun", "web", "api",
    "sdk", "cli", "gui", "ios", "android", "flutter", "react", "vue",
    "angular", "next.js", "nuxt", "express", "fastapi", "django", "flask",
    // Common single-word headers that are noise
    "example", "examples", "output", "response", "request", "result",
    "note", "warning", "tip", "info", "caution"
]);

function isJunkHeader(text: string): boolean {
    const normalized = text.toLowerCase().trim();

    // Too short
    if (normalized.length < 3) return true;

    // Too long - real headers are typically short
    // "The media_resolution parameter is currently only available..." is NOT a header
    if (normalized.length > 60) return true;

    // Known junk words
    if (JUNK_HEADERS.has(normalized)) return true;

    // Looks like a sentence (contains common sentence patterns)
    if (/\b(is|are|was|were|the|this|that|these|those|can|will|should|must)\b.*\b(is|are|a|an|the|to|for|in|on|at)\b/i.test(normalized)) {
        return true;
    }

    // Starts with common instruction words
    if (/^(check|note|see|view|click|read|visit|go to|refer to)/i.test(normalized)) {
        return true;
    }

    // Contains URLs or markdown links
    if (/https?:\/\/|\[.*\]\(.*\)/.test(text)) {
        return true;
    }

    return false;
}

// ─────────────────────────────────────────────────────────────
// read_url_content
// ─────────────────────────────────────────────────────────────

export const readUrlContentInput = {
    Url: z.string().url().describe("URL to read content from")
};

export type ReadUrlContentArgs = {
    Url: string;
};

export async function runReadUrlContent(params: {
    input: ReadUrlContentArgs;
}): Promise<string> {
    cleanupExpiredDocuments();

    const { Url } = params.input;

    // Check cache
    const cached = documentStore.get(Url);
    if (cached) {
        return formatReadUrlResponse(cached);
    }

    // Fetch the URL
    const response = await fetch(Url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; GeminiWebMCP/1.0; +https://github.com/user/gemini-web-mcp)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        },
        redirect: "follow",
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        throw new Error(`Unsupported content type: ${contentType}. Only HTML pages are supported.`);
    }

    const html = await response.text();

    // Parse HTML with JSDOM
    const dom = new JSDOM(html, { url: Url });
    const document = dom.window.document;

    // Check if page is readable
    const isReaderable = isProbablyReaderable(document);

    // Extract main content using Readability
    const reader = new Readability(document.cloneNode(true) as Document);
    const article = reader.parse();

    let title: string;
    let excerpt: string;
    let byline: string;
    let markdown: string;

    if (article) {
        // Readability succeeded - use its clean output
        title = article.title || extractFallbackTitle(html, Url);
        excerpt = article.excerpt || "";
        byline = article.byline || "";

        // Convert the clean HTML content to markdown
        markdown = nhm.translate(article.content || "");
    } else {
        // Readability failed - fall back to full HTML conversion
        title = extractFallbackTitle(html, Url);
        excerpt = extractMetaDescription(html);
        byline = "";

        // Convert full HTML (less ideal but better than nothing)
        markdown = nhm.translate(html);
    }

    // Clean up the markdown
    const cleanedContent = cleanMarkdown(markdown);

    // Create chunks with overlap
    const chunks = createChunksWithOverlap(cleanedContent);

    // Store the document
    const storedDoc: StoredDocument = {
        url: Url,
        title,
        excerpt,
        byline,
        chunks,
        fetchedAt: new Date(),
        isReaderable
    };
    documentStore.set(Url, storedDoc);

    return formatReadUrlResponse(storedDoc);
}

// ─────────────────────────────────────────────────────────────
// Metadata extraction helpers
// ─────────────────────────────────────────────────────────────

function extractFallbackTitle(html: string, url: string): string {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
        return decodeHtmlEntities(titleMatch[1].trim());
    }
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

function extractMetaDescription(html: string): string {
    // Try OG description first
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*?)["']/i)
        || html.match(/<meta[^>]*content=["']([^"']*?)["'][^>]*property=["']og:description["']/i);

    if (ogDescMatch) {
        return decodeHtmlEntities(ogDescMatch[1].trim());
    }

    // Fallback to meta description
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["']/i)
        || html.match(/<meta[^>]*content=["']([^"']*?)["'][^>]*name=["']description["']/i);

    if (metaDescMatch) {
        return decodeHtmlEntities(metaDescMatch[1].trim());
    }

    return "";
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/");
}

// ─────────────────────────────────────────────────────────────
// Markdown cleanup
// ─────────────────────────────────────────────────────────────

function cleanMarkdown(markdown: string): string {
    return markdown
        // Remove any leftover HTML artifacts
        .replace(/<!doctype[^>]*>/gi, "")
        .replace(/<[^>]+>/g, "")
        // Remove skip links and navigation artifacts
        .replace(/\[Skip to [^\]]+\]\s*\([^)]+\)/gi, "")
        .replace(/\[#[^\]]*\]/g, "")
        .replace(/\[\s*\]\([^)]*\)/g, "")
        // Remove image references with empty alt text
        .replace(/!\[\s*\]\([^)]*\)/g, "")
        // Clean up excessive whitespace
        .replace(/\n{3,}/g, "\n\n")
        .replace(/^\s+$/gm, "")
        // Remove orphaned code fences
        .replace(/^```\s*$/gm, "")
        .trim();
}

// ─────────────────────────────────────────────────────────────
// Chunking with overlap and semantic boundaries
// ─────────────────────────────────────────────────────────────

function createChunksWithOverlap(content: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = content.split("\n");

    let currentChunk: string[] = [];
    let currentHeaders: string[] = [];
    let currentCharCount = 0;
    let previousChunkEnd = ""; // For overlap

    // Track code blocks to never split inside them
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track code block boundaries
        if (trimmed.startsWith("```")) {
            inCodeBlock = !inCodeBlock;
        }

        // Track headers for context
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch && !inCodeBlock) {
            const level = headerMatch[1].length;
            const headerText = headerMatch[2].trim();

            if (!isJunkHeader(headerText)) {
                currentHeaders = currentHeaders.slice(0, level - 1);
                currentHeaders[level - 1] = headerText;
                currentHeaders = currentHeaders.filter(Boolean);
            }
        }

        const lineLength = line.length + 1;

        // Determine if we should split here
        const atGoodBreakPoint = !inCodeBlock && (
            headerMatch ||                          // Header boundary
            trimmed === "" ||                       // Paragraph boundary  
            /^[-*]\s/.test(trimmed) ||             // List item (can split between items)
            currentCharCount >= MAX_CHUNK_SIZE      // Hard limit
        );

        const shouldSplit = currentCharCount >= TARGET_CHUNK_SIZE && atGoodBreakPoint;

        if (shouldSplit && currentChunk.length > 0) {
            const chunkContent = currentChunk.join("\n").trim();

            if (chunkContent) {
                // Add overlap from previous chunk end
                const hasOverlap = chunks.length > 0 && previousChunkEnd.length > 0;
                const contentWithContext = hasOverlap
                    ? previousChunkEnd + "\n\n" + chunkContent
                    : chunkContent;

                chunks.push({
                    position: chunks.length,
                    headers: [...currentHeaders],
                    content: contentWithContext,
                    summary: generateChunkSummary(chunkContent, currentHeaders),
                    charCount: contentWithContext.length,
                    hasOverlap
                });

                // Save end of this chunk for overlap into next
                previousChunkEnd = extractOverlapText(chunkContent);
            }

            currentChunk = [];
            currentCharCount = 0;
        }

        currentChunk.push(line);
        currentCharCount += lineLength;
    }

    // Don't forget the last chunk
    const lastContent = currentChunk.join("\n").trim();
    if (lastContent) {
        const hasOverlap = chunks.length > 0 && previousChunkEnd.length > 0;
        const contentWithContext = hasOverlap
            ? previousChunkEnd + "\n\n" + lastContent
            : lastContent;

        chunks.push({
            position: chunks.length,
            headers: [...currentHeaders],
            content: contentWithContext,
            summary: generateChunkSummary(lastContent, currentHeaders),
            charCount: contentWithContext.length,
            hasOverlap
        });
    }

    return chunks;
}

function extractOverlapText(content: string): string {
    // Get the last ~OVERLAP_SIZE characters, but try to end at a sentence boundary
    if (content.length <= OVERLAP_SIZE) {
        return content;
    }

    const tail = content.slice(-OVERLAP_SIZE * 2); // Get extra to find good boundary

    // Find the last sentence boundary in the tail
    const sentenceEnd = Math.max(
        tail.lastIndexOf(". "),
        tail.lastIndexOf("! "),
        tail.lastIndexOf("? "),
        tail.lastIndexOf(".\n"),
        tail.lastIndexOf("!\n"),
        tail.lastIndexOf("?\n")
    );

    if (sentenceEnd > 0) {
        // Start from after the sentence boundary
        return tail.slice(sentenceEnd + 2).trim();
    }

    // No good sentence boundary, just take the last OVERLAP_SIZE chars
    return content.slice(-OVERLAP_SIZE).trim();
}

// ─────────────────────────────────────────────────────────────
// Summary generation (skip code, find meaningful content)
// ─────────────────────────────────────────────────────────────

function generateChunkSummary(content: string, headers: string[]): string {
    const headerPath = headers.join(" > ");

    // Find first meaningful prose line
    const lines = content.split("\n");
    let firstLine = "";
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("```")) {
            inCodeBlock = !inCodeBlock;
            continue;
        }

        if (inCodeBlock) continue;
        if (!trimmed || trimmed.startsWith("#") || trimmed.length < 15) continue;

        // Skip code-like patterns
        if (isCodeLikeLine(trimmed)) continue;

        // Skip markdown links: - [text](url) or [text](url)
        if (/^-?\s*\[.*\]\(.*\)/.test(trimmed)) continue;

        // Skip lines that are mostly a URL
        if (/https?:\/\/\S{20,}/.test(trimmed)) continue;

        // Skip list markers that are just short items
        if (/^[-*]\s+.{1,20}$/.test(trimmed)) continue;

        // Skip lines starting with underscore (often markdown emphasis artifacts)
        if (trimmed.startsWith("_") || trimmed.startsWith("*")) continue;

        // Found a good line
        firstLine = trimmed.length > 80 ? trimmed.slice(0, 77) + "..." : trimmed;
        break;
    }

    if (headerPath && firstLine) {
        return `${headerPath} | ${firstLine}`;
    } else if (headerPath) {
        return headerPath;
    } else if (firstLine) {
        return firstLine;
    }
    return "(content)";
}

function isCodeLikeLine(line: string): boolean {
    // Common code patterns
    const codePatterns = [
        /^import\s/,
        /^from\s.*import/,
        /^const\s/,
        /^let\s/,
        /^var\s/,
        /^function\s/,
        /^async\s/,
        /^class\s/,
        /^def\s/,
        /^pub\s/,
        /^fn\s/,
        /^func\s/,
        /^package\s/,
        /^public\s/,
        /^private\s/,
        /^export\s/,
        /^return\s/,
        /^if\s*\(/,
        /^for\s*\(/,
        /^while\s*\(/,
        /^\/\//,
        /^\/\*/,
        /^\*/,
        /^curl\s/,
        /^wget\s/,
        /^\$\s/,
        /^>\s/,
        /^@/,
        /^\[.*\]$/,
        /^\{.*\}$/,
        /console\.log/,
        /print\(/,
        /\);$/,
        /= \{$/,
        /= \[$/,
        /: \[$/,
        /=> \{/,
        /\(\) \{/,
        /\(\) =>/,
        /^https?:\/\//,
        /^[\[\]{}();,]+$/,
    ];

    return codePatterns.some(pattern => pattern.test(line)) ||
        line.endsWith(",") ||
        line.endsWith("{") ||
        line.endsWith("[") ||
        line.endsWith(";") ||
        line.endsWith("\\") ||  // Line continuation
        line.includes("API_KEY") ||
        line.includes("api_key") ||
        line.includes("apiKey") ||
        /^-[A-Za-z]\s/.test(line) ||  // CLI flags like -H, -d
        /^--[a-z]/.test(line);         // Long CLI flags
}

// ─────────────────────────────────────────────────────────────
// Response formatting
// ─────────────────────────────────────────────────────────────

function formatReadUrlResponse(doc: StoredDocument): string {
    const parts: string[] = [];

    parts.push(`**Title:** ${doc.title}`);

    if (doc.byline) {
        parts.push(`**Author:** ${doc.byline}`);
    }

    if (doc.excerpt) {
        parts.push(`**Summary:** ${doc.excerpt}`);
    }

    if (!doc.isReaderable) {
        parts.push(`\n⚠️ Note: This page may not be a standard article. Content extraction quality may vary.`);
    }

    parts.push(`\nDocument contains ${doc.chunks.length} chunks:`);

    for (const chunk of doc.chunks) {
        const overlapNote = chunk.hasOverlap ? " (includes overlap)" : "";
        parts.push(`- [${chunk.position}] ${chunk.summary} (${chunk.charCount} chars${overlapNote})`);
    }

    parts.push(`\nUse view_content_chunk with document_id="${doc.url}" and position=N to read a chunk.`);

    return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// view_content_chunk
// ─────────────────────────────────────────────────────────────

export const viewContentChunkInput = {
    document_id: z.string().describe("The ID of the document (URL) that was previously fetched by read_url_content"),
    position: z.number().int().min(0).describe("The position of the chunk to view")
};

export type ViewContentChunkArgs = {
    document_id: string;
    position: number;
};

export function runViewContentChunk(input: ViewContentChunkArgs): string {
    cleanupExpiredDocuments();

    const doc = documentStore.get(input.document_id);

    if (!doc) {
        return `Error: Document not found. The document with ID "${input.document_id}" has not been fetched yet or has expired. Use read_url_content first to fetch the URL.`;
    }

    const chunk = doc.chunks.find(c => c.position === input.position);

    if (!chunk) {
        const maxPosition = doc.chunks.length - 1;
        return `Error: Invalid position. Position ${input.position} does not exist. Valid positions are 0 to ${maxPosition}.`;
    }

    const parts: string[] = [];

    parts.push(`## Chunk ${chunk.position} of ${doc.chunks.length - 1}`);

    if (chunk.headers.length > 0) {
        parts.push(`**Section:** ${chunk.headers.join(" > ")}`);
    }

    if (chunk.hasOverlap) {
        parts.push(`*Note: First ~${OVERLAP_SIZE} chars overlap with previous chunk for context.*`);
    }

    parts.push("");
    parts.push(chunk.content);

    // Navigation hints
    const nav: string[] = [];
    if (chunk.position > 0) {
        nav.push(`Previous: position=${chunk.position - 1}`);
    }
    if (chunk.position < doc.chunks.length - 1) {
        nav.push(`Next: position=${chunk.position + 1}`);
    }
    if (nav.length > 0) {
        parts.push("");
        parts.push(`---`);
        parts.push(nav.join(" | "));
    }

    return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Utility exports
// ─────────────────────────────────────────────────────────────

export function getDocumentStore(): Map<string, StoredDocument> {
    return documentStore;
}

export function clearDocumentStore(): void {
    documentStore.clear();
}
