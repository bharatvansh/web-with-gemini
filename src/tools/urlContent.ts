import { z } from "zod";
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { extractText, getDocumentProxy } from "unpdf";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ContentFormat =
    | "html"
    | "pdf"
    | "json"
    | "markdown"
    | "plain_text"
    | "csv"
    | "xml"
    | "rss_atom";

export interface DocumentChunk {
    position: number;
    headers: string[];
    content: string;
    summary: string;
    charCount: number;
    hasOverlap: boolean;
}

export interface StoredDocument {
    url: string;
    title: string;
    excerpt: string;
    byline: string;
    chunks: DocumentChunk[];
    fetchedAt: Date;
    isReaderable: boolean;
    format: ContentFormat;
}

export interface ExtractedContent {
    title: string;
    excerpt: string;
    byline: string;
    markdown: string;
    isReaderable: boolean;
    format: ContentFormat;
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
// HTML to Markdown converter
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

export function isJunkHeader(text: string): boolean {
    const normalized = text.toLowerCase().trim();

    // Too short
    if (normalized.length < 3) return true;

    // Too long - real headers are typically short
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
// Format Detection
// ─────────────────────────────────────────────────────────────

export function detectContentFormat(contentTypeHeader: string, urlStr: string): ContentFormat | "unsupported" {
    const contentType = (contentTypeHeader || "").toLowerCase().trim();
    let pathname = "";
    try {
        pathname = new URL(urlStr).pathname.toLowerCase();
    } catch {
        pathname = urlStr.toLowerCase();
    }

    // 1. PDF
    if (contentType.includes("application/pdf") || pathname.endsWith(".pdf")) {
        return "pdf";
    }

    // 2. JSON
    if (
        contentType.includes("application/json") ||
        contentType.includes("text/json") ||
        contentType.includes("+json") ||
        pathname.endsWith(".json")
    ) {
        return "json";
    }

    // 3. Markdown
    if (
        contentType.includes("text/markdown") ||
        contentType.includes("text/x-markdown") ||
        pathname.endsWith(".md") ||
        pathname.endsWith(".markdown")
    ) {
        return "markdown";
    }

    // 4. CSV / TSV
    if (
        contentType.includes("text/csv") ||
        contentType.includes("text/tab-separated-values") ||
        pathname.endsWith(".csv") ||
        pathname.endsWith(".tsv")
    ) {
        return "csv";
    }

    // 5. RSS / Atom
    if (
        contentType.includes("application/rss+xml") ||
        contentType.includes("application/atom+xml") ||
        pathname.endsWith(".rss") ||
        pathname.endsWith(".atom")
    ) {
        return "rss_atom";
    }

    // 6. XML
    if (
        contentType.includes("application/xml") ||
        contentType.includes("text/xml") ||
        contentType.includes("+xml") ||
        pathname.endsWith(".xml")
    ) {
        return "xml";
    }

    // 7. HTML / XHTML
    if (
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml+xml") ||
        pathname.endsWith(".html") ||
        pathname.endsWith(".htm")
    ) {
        return "html";
    }

    // 8. Plain Text / Code extensions
    const codeOrTextExtensions = [
        ".txt", ".text", ".log", ".env", ".yaml", ".yml", ".toml", ".ini", ".conf",
        ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
        ".py", ".pyw", ".go", ".rs", ".java", ".kt", ".c", ".cpp", ".h", ".hpp",
        ".cs", ".rb", ".php", ".sh", ".bash", ".zsh", ".sql", ".css", ".scss"
    ];
    if (
        contentType.includes("text/plain") ||
        codeOrTextExtensions.some(ext => pathname.endsWith(ext))
    ) {
        return "plain_text";
    }

    // 9. Unsupported binary types
    if (
        contentType.startsWith("image/") ||
        contentType.startsWith("video/") ||
        contentType.startsWith("audio/") ||
        contentType.includes("application/zip") ||
        contentType.includes("application/gzip") ||
        contentType.includes("application/x-tar") ||
        contentType.includes("application/octet-stream")
    ) {
        return "unsupported";
    }

    // Fallback: if text/*, treat as plain text; otherwise try html
    if (contentType.startsWith("text/")) {
        return "plain_text";
    }

    return "html";
}

// ─────────────────────────────────────────────────────────────
// Format Parsers
// ─────────────────────────────────────────────────────────────

export async function parsePdfContent(buffer: ArrayBuffer | Uint8Array, url: string): Promise<ExtractedContent> {
    const uint8Array = buffer instanceof Uint8Array
        ? new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
        : new Uint8Array(buffer);
    const pdf = await getDocumentProxy(uint8Array);
    try {
        const totalPages = pdf.numPages;
        const { text } = await extractText(pdf, { mergePages: false });

        let title = "";
        let byline = "";
        let subject = "";

        try {
            const meta = await pdf.getMetadata();
            const info = meta?.info as Record<string, unknown> | undefined;
            if (info) {
                if (typeof info.Title === "string" && info.Title.trim()) {
                    title = info.Title.trim();
                }
                if (typeof info.Author === "string" && info.Author.trim()) {
                    byline = info.Author.trim();
                }
                if (typeof info.Subject === "string" && info.Subject.trim()) {
                    subject = info.Subject.trim();
                }
            }
        } catch {
            // Silently continue if metadata extraction fails
        }

        if (!title) {
            title = extractFilenameFromUrl(url) || "PDF Document";
        }

        const pages = Array.isArray(text) ? text : [text];
        const markdownParts: string[] = [];

        pages.forEach((pageText, idx) => {
            const pageNum = idx + 1;
            const cleanedPage = cleanPdfPageText(pageText);
            if (cleanedPage) {
                if (totalPages > 1) {
                    markdownParts.push(`### Page ${pageNum}\n\n${cleanedPage}`);
                } else {
                    markdownParts.push(cleanedPage);
                }
            }
        });

        const markdown = markdownParts.join("\n\n") || "_No readable text extracted from PDF._";
        const excerpt = subject || (pages[0] ? pages[0].slice(0, 200).replace(/\s+/g, " ").trim() + "..." : `PDF document (${totalPages} pages)`);

        return {
            title,
            excerpt,
            byline,
            markdown,
            isReaderable: true,
            format: "pdf"
        };
    } finally {
        await pdf.loadingTask.destroy();
    }
}

function cleanPdfPageText(pageText: string): string {
    return pageText
        .replace(/\r\n/g, "\n")
        .replace(/\f/g, "\n\n")
        .replace(/\t/g, "  ")
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function parseJsonContent(text: string, url: string): ExtractedContent {
    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        // If malformed JSON, treat as plain text
        return parsePlainTextContent(text, url);
    }

    let title = extractFilenameFromUrl(url) || "JSON Data";
    let excerpt = "";
    let byline = "";

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (typeof parsed.name === "string" && parsed.name.trim()) title = parsed.name.trim();
        else if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title.trim();

        if (typeof parsed.description === "string" && parsed.description.trim()) excerpt = parsed.description.trim();
        else if (typeof parsed.summary === "string" && parsed.summary.trim()) excerpt = parsed.summary.trim();

        if (typeof parsed.author === "string" && parsed.author.trim()) byline = parsed.author.trim();
        else if (typeof parsed.author?.name === "string" && parsed.author.name.trim()) byline = parsed.author.name.trim();
    }

    const formattedJson = JSON.stringify(parsed, null, 2);
    const lineCount = formattedJson.split("\n").length;
    const isArray = Array.isArray(parsed);
    const keyCount = isArray ? parsed.length : (parsed && typeof parsed === "object" ? Object.keys(parsed).length : 1);

    if (!excerpt) {
        excerpt = isArray
            ? `JSON Array with ${keyCount} items (${lineCount} lines)`
            : `JSON Object with ${keyCount} fields (${lineCount} lines)`;
    }

    const markdown = "```json\n" + formattedJson + "\n```";

    return {
        title,
        excerpt,
        byline,
        markdown,
        isReaderable: true,
        format: "json"
    };
}

export function parseMarkdownContent(text: string, url: string): ExtractedContent {
    let title = "";
    let excerpt = "";

    // Find first # Heading
    const headingMatch = text.match(/^#\s+(.+)$/m);
    if (headingMatch) {
        title = headingMatch[1].trim();
    } else {
        title = extractFilenameFromUrl(url) || "Markdown Document";
    }

    // Find first non-heading paragraph for excerpt
    const paragraphs = text.split(/\n\s*\n/);
    for (const p of paragraphs) {
        const trimmed = p.trim();
        if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```") && trimmed.length > 20) {
            excerpt = trimmed.replace(/\n/g, " ").slice(0, 200);
            if (trimmed.length > 200) excerpt += "...";
            break;
        }
    }

    return {
        title,
        excerpt,
        byline: "",
        markdown: cleanMarkdown(text),
        isReaderable: true,
        format: "markdown"
    };
}

export function parseCsvContent(text: string, url: string, delimiter = ","): ExtractedContent {
    const sourceText = text.replace(/^\uFEFF/, "");
    const title = extractFilenameFromUrl(url) || "CSV Dataset";

    if (sourceText.trim().length === 0) {
        return {
            title,
            excerpt: "Empty CSV data",
            byline: "",
            markdown: "_Empty CSV data._",
            isReaderable: true,
            format: "csv"
        };
    }

    let isTsvPath = false;
    try {
        isTsvPath = new URL(url).pathname.toLowerCase().endsWith(".tsv");
    } catch {
        // Use content-based delimiter detection for non-URL callers.
    }

    const isTsv = delimiter === "\t" || isTsvPath || (!sourceText.includes(",") && sourceText.includes("\t"));
    const actualDelimiter = isTsv ? "\t" : delimiter;

    const parsedRows = parseCsvRecords(sourceText, actualDelimiter);

    let markdown = "";
    if (parsedRows.length > 0 && parsedRows[0].length <= 30 && parsedRows.length <= 500) {
        markdown = formatCsvAsMarkdownTable(parsedRows);
    } else {
        markdown = `*Dataset contains ${parsedRows.length} rows and ${parsedRows[0]?.length || 0} columns.*\n\n\`\`\`csv\n${sourceText.slice(0, 15000)}\n\`\`\``;
        if (sourceText.length > 15000) {
            markdown += `\n\n*(Truncated preview from ${sourceText.length} characters)*`;
        }
    }

    const excerpt = `CSV Table: ${parsedRows.length} rows × ${parsedRows[0]?.length || 0} columns`;

    return {
        title,
        excerpt,
        byline: "",
        markdown,
        isReaderable: true,
        format: "csv"
    };
}

export function parseCsvRecords(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let current = "";
    let inQuotes = false;
    let rowHasContent = false;

    const finishRow = () => {
        row.push(current.trim());
        if (rowHasContent) {
            rows.push(row);
        }
        row = [];
        current = "";
        rowHasContent = false;
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '"') {
            if (inQuotes && text[i + 1] === '"') {
                current += '"';
                rowHasContent = true;
                i++;
            } else {
                inQuotes = !inQuotes;
                rowHasContent = true;
            }
        } else if (char === delimiter && !inQuotes) {
            row.push(current.trim());
            current = "";
            rowHasContent = true;
        } else if ((char === "\n" || char === "\r") && !inQuotes) {
            finishRow();
            if (char === "\r" && text[i + 1] === "\n") {
                i++;
            }
        } else {
            current += char;
            if (char.trim().length > 0) {
                rowHasContent = true;
            }
        }
    }

    if (rowHasContent || row.length > 0 || current.length > 0) {
        finishRow();
    }

    return rows;
}

export function parseCsvLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

export function formatCsvAsMarkdownTable(rows: string[][]): string {
    if (rows.length === 0) return "";
    const headers = rows[0];
    const dataRows = rows.slice(1);

    const escapeCell = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

    const headerLine = "| " + headers.map(escapeCell).join(" | ") + " |";
    const separatorLine = "| " + headers.map(() => "---").join(" | ") + " |";

    const bodyLines = dataRows.map(row => {
        const paddedRow = headers.map((_, i) => row[i] !== undefined ? row[i] : "");
        return "| " + paddedRow.map(escapeCell).join(" | ") + " |";
    });

    return [headerLine, separatorLine, ...bodyLines].join("\n");
}

export function parseXmlContent(text: string, url: string, isAtomHint = false): ExtractedContent {
    const title = extractFilenameFromUrl(url) || "XML Document";

    // Detect if this is RSS / Atom feed
    const isRss = /<rss(?:\s|>)/i.test(text) || /<channel(?:\s|>)/i.test(text);
    const isAtom = isAtomHint || (/<feed(?:\s|>)/i.test(text) && /http:\/\/www\.w3\.org\/2005\/Atom/i.test(text));

    if (isRss || isAtom) {
        return parseRssOrAtomFeed(text, url, isAtom);
    }

    const lineCount = text.split("\n").length;
    return {
        title,
        excerpt: `XML Document (${lineCount} lines)`,
        byline: "",
        markdown: "```xml\n" + text.trim() + "\n```",
        isReaderable: true,
        format: "xml"
    };
}

export function parseRssOrAtomFeed(xmlText: string, url: string, isAtom: boolean): ExtractedContent {
    let feedTitle = "";
    let feedDescription = "";
    const items: Array<{ title: string; link: string; date?: string; summary?: string }> = [];

    try {
        const dom = new JSDOM(xmlText, { contentType: "text/xml" });
        const doc = dom.window.document;

        if (isAtom) {
            feedTitle = doc.querySelector("feed > title")?.textContent?.trim() || "";
            feedDescription = doc.querySelector("feed > subtitle")?.textContent?.trim() || "";

            const entries = doc.querySelectorAll("entry");
            entries.forEach(entry => {
                const itemTitle = entry.querySelector("title")?.textContent?.trim() || "Untitled";
                const linkElem = entry.querySelector("link");
                const itemLink = linkElem?.getAttribute("href") || linkElem?.textContent?.trim() || "";
                const date = entry.querySelector("updated")?.textContent?.trim() || entry.querySelector("published")?.textContent?.trim() || "";
                const summary = entry.querySelector("summary")?.textContent?.trim() || entry.querySelector("content")?.textContent?.trim() || "";

                items.push({
                    title: itemTitle,
                    link: itemLink,
                    date: date ? new Date(date).toLocaleDateString() : undefined,
                    summary: summary.slice(0, 150)
                });
            });
        } else {
            feedTitle = doc.querySelector("channel > title")?.textContent?.trim() || "";
            feedDescription = doc.querySelector("channel > description")?.textContent?.trim() || "";

            const itemNodes = doc.querySelectorAll("item");
            itemNodes.forEach(item => {
                const itemTitle = item.querySelector("title")?.textContent?.trim() || "Untitled";
                const itemLink = item.querySelector("link")?.textContent?.trim() || "";
                const date = item.querySelector("pubDate")?.textContent?.trim() || "";
                const desc = item.querySelector("description")?.textContent?.trim() || "";

                items.push({
                    title: itemTitle,
                    link: itemLink,
                    date: date ? new Date(date).toLocaleDateString() : undefined,
                    summary: desc ? cleanMarkdown(nhm.translate(desc)).slice(0, 150) : undefined
                });
            });
        }
    } catch {
        return {
            title: extractFilenameFromUrl(url) || "XML Feed",
            excerpt: "RSS/Atom Feed",
            byline: "",
            markdown: "```xml\n" + xmlText.trim() + "\n```",
            isReaderable: true,
            format: "rss_atom"
        };
    }

    if (!feedTitle) {
        feedTitle = extractFilenameFromUrl(url) || "RSS Feed";
    }

    const markdownParts: string[] = [];
    markdownParts.push(`# ${feedTitle}`);
    if (feedDescription) {
        markdownParts.push(`*${feedDescription}*\n`);
    }

    markdownParts.push(`## Feed Items (${items.length})\n`);
    items.forEach((item, index) => {
        let entry = `${index + 1}. **[${item.title}](${item.link || url})**`;
        if (item.date) entry += ` — *${item.date}*`;
        if (item.summary) entry += `\n   > ${item.summary}`;
        markdownParts.push(entry);
    });

    return {
        title: feedTitle,
        excerpt: feedDescription || `Feed with ${items.length} items`,
        byline: "",
        markdown: markdownParts.join("\n\n"),
        isReaderable: true,
        format: "rss_atom"
    };
}

export function parsePlainTextContent(text: string, url: string): ExtractedContent {
    const title = extractFilenameFromUrl(url) || "Plain Text Document";
    const lineCount = text.split("\n").length;
    const isCode = isLikelyCode(url, text);

    let markdown = "";
    if (isCode) {
        const lang = getLanguageFromUrl(url);
        markdown = `\`\`\`${lang}\n${text.trim()}\n\`\`\``;
    } else {
        markdown = text.trim();
    }

    const excerpt = `Text document (${lineCount} lines, ${text.length} characters)`;

    return {
        title,
        excerpt,
        byline: "",
        markdown,
        isReaderable: true,
        format: "plain_text"
    };
}

export function parseHtmlContent(html: string, url: string): ExtractedContent {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    const isReaderable = isProbablyReaderable(document);

    const reader = new Readability(document.cloneNode(true) as Document);
    const article = reader.parse();

    let title: string;
    let excerpt: string;
    let byline: string;
    let markdown: string;

    if (article) {
        title = article.title || extractFallbackTitle(html, url);
        excerpt = article.excerpt || "";
        byline = article.byline || "";
        markdown = nhm.translate(article.content || "");
    } else {
        title = extractFallbackTitle(html, url);
        excerpt = extractMetaDescription(html);
        byline = "";
        markdown = nhm.translate(html);
    }

    return {
        title,
        excerpt,
        byline,
        markdown: cleanMarkdown(markdown),
        isReaderable,
        format: "html"
    };
}

// ─────────────────────────────────────────────────────────────
// Format Helpers
// ─────────────────────────────────────────────────────────────

function getLanguageFromUrl(urlStr: string): string {
    try {
        const pathname = new URL(urlStr).pathname;
        const ext = pathname.split(".").pop()?.toLowerCase() || "";
        const langMap: Record<string, string> = {
            js: "javascript",
            mjs: "javascript",
            cjs: "javascript",
            ts: "typescript",
            mts: "typescript",
            cts: "typescript",
            jsx: "jsx",
            tsx: "tsx",
            py: "python",
            pyw: "python",
            go: "go",
            rs: "rust",
            java: "java",
            kt: "kotlin",
            c: "c",
            cpp: "cpp",
            h: "c",
            hpp: "cpp",
            cs: "csharp",
            rb: "ruby",
            php: "php",
            sh: "bash",
            bash: "bash",
            zsh: "bash",
            yaml: "yaml",
            yml: "yaml",
            toml: "toml",
            ini: "ini",
            conf: "ini",
            sql: "sql",
            html: "html",
            css: "css",
            scss: "scss",
            json: "json",
            xml: "xml",
            md: "markdown"
        };
        return langMap[ext] || "";
    } catch {
        return "";
    }
}

function isLikelyCode(urlStr: string, text: string): boolean {
    const lang = getLanguageFromUrl(urlStr);
    if (lang && lang !== "markdown") return true;
    if (
        text.startsWith("#!") ||
        text.startsWith("<?php") ||
        text.startsWith("import ") ||
        text.startsWith("package ")
    ) {
        return true;
    }
    return false;
}

export function extractFilenameFromUrl(urlStr: string): string {
    try {
        const parsed = new URL(urlStr);
        const segments = parsed.pathname.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        if (last && last.length > 0) {
            return decodeURIComponent(last);
        }
        return parsed.hostname;
    } catch {
        return urlStr;
    }
}

// ─────────────────────────────────────────────────────────────
// read_url_content
// ─────────────────────────────────────────────────────────────

export const readUrlContentInput = {
    Url: z.string().url().describe("URL to read content from (supports HTML, PDF, JSON, Markdown, Plain Text, CSV, XML/RSS)")
};

export type ReadUrlContentArgs = {
    Url: string;
};

function isAtomFeedResponse(contentTypeHeader: string, url: string): boolean {
    if (contentTypeHeader.toLowerCase().includes("application/atom+xml")) {
        return true;
    }

    try {
        return new URL(url).pathname.toLowerCase().endsWith(".atom");
    } catch {
        return false;
    }
}

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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,text/plain;q=0.8,text/markdown;q=0.8,application/json;q=0.8,text/csv;q=0.8,*/*;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const contentTypeHeader = response.headers.get("content-type") || "";
    const format = detectContentFormat(contentTypeHeader, Url);

    if (format === "unsupported") {
        throw new Error(`Unsupported content type: ${contentTypeHeader || "unknown"}. Supported formats: HTML, PDF, JSON, Markdown, Plain Text, CSV, XML/RSS.`);
    }

    let extracted: ExtractedContent;

    if (format === "pdf") {
        const arrayBuffer = await response.arrayBuffer();
        extracted = await parsePdfContent(arrayBuffer, Url);
    } else {
        const text = await response.text();

        // If detected as HTML, double check if it might actually be JSON or XML or Markdown
        if (format === "html") {
            const trimmed = text.trim();
            if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
                extracted = parseJsonContent(text, Url);
            } else {
                extracted = parseHtmlContent(text, Url);
            }
        } else if (format === "json") {
            extracted = parseJsonContent(text, Url);
        } else if (format === "markdown") {
            extracted = parseMarkdownContent(text, Url);
        } else if (format === "csv") {
            extracted = parseCsvContent(text, Url);
        } else if (format === "xml" || format === "rss_atom") {
            extracted = parseXmlContent(text, Url, isAtomFeedResponse(contentTypeHeader, Url));
        } else {
            extracted = parsePlainTextContent(text, Url);
        }
    }

    // Clean up the markdown
    const cleanedContent = cleanMarkdown(extracted.markdown);

    // Create chunks with overlap
    const chunks = createChunksWithOverlap(cleanedContent);

    // Store the document
    const storedDoc: StoredDocument = {
        url: Url,
        title: extracted.title,
        excerpt: extracted.excerpt,
        byline: extracted.byline,
        chunks,
        fetchedAt: new Date(),
        isReaderable: extracted.isReaderable,
        format: extracted.format
    };
    documentStore.set(Url, storedDoc);

    return formatReadUrlResponse(storedDoc);
}

// ─────────────────────────────────────────────────────────────
// Metadata extraction helpers
// ─────────────────────────────────────────────────────────────

export function extractFallbackTitle(html: string, url: string): string {
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

export function extractMetaDescription(html: string): string {
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

export function decodeHtmlEntities(text: string): string {
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

export function cleanMarkdown(markdown: string): string {
    return markdown
        // Remove any leftover HTML doctype artifacts
        .replace(/<!doctype[^>]*>/gi, "")
        // Remove skip links and navigation artifacts
        .replace(/\[Skip to [^\]]+\]\s*\([^)]+\)/gi, "")
        .replace(/\[#[^\]]*\]/g, "")
        .replace(/\[\s*\]\([^)]*\)/g, "")
        // Remove image references with empty alt text
        .replace(/!\[\s*\]\([^)]*\)/g, "")
        // Clean up excessive whitespace
        .replace(/\n{3,}/g, "\n\n")
        .replace(/^\s+$/gm, "")
        .trim();
}

// ─────────────────────────────────────────────────────────────
// Chunking with overlap and semantic boundaries
// ─────────────────────────────────────────────────────────────

export function createChunksWithOverlap(content: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = content.split("\n");

    let currentChunk: string[] = [];
    let currentHeaders: string[] = [];
    let currentCharCount = 0;
    let previousChunkEnd = ""; // For overlap

    // Track code blocks and preserve fence pairs when splitting
    let inCodeBlock = false;
    let codeFenceLanguage = "";

    const flushCurrentChunk = (): void => {
        const chunkContent = currentChunk.join("\n").trim();

        if (chunkContent) {
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

            previousChunkEnd = extractOverlapText(chunkContent);
        }

        currentChunk = [];
        currentCharCount = 0;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const isCodeFence = trimmed.startsWith("```");

        // Track code block boundaries
        const wasInCodeBlock = inCodeBlock;
        if (isCodeFence) {
            if (!wasInCodeBlock) {
                codeFenceLanguage = trimmed.slice(3).trim();
            }
            inCodeBlock = !inCodeBlock;
        }

        // Track headers for context (outside code blocks)
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch && !inCodeBlock && !isCodeFence) {
            const level = headerMatch[1].length;
            const headerText = headerMatch[2].trim();

            if (!isJunkHeader(headerText)) {
                currentHeaders = currentHeaders.slice(0, level - 1);
                currentHeaders[level - 1] = headerText;
                currentHeaders = currentHeaders.filter(Boolean);
            }
        }

        currentChunk.push(line);
        currentCharCount += line.length + 1;

        // Determine if we should split after this line
        const atGoodBreakPoint = !inCodeBlock && (
            headerMatch !== null ||                 // Header boundary
            trimmed === "" ||                       // Paragraph boundary  
            /^[-*]\s/.test(trimmed) ||             // List item
            (isCodeFence && wasInCodeBlock) ||     // Just completed a code block
            currentCharCount >= MAX_CHUNK_SIZE      // Hard limit
        );

        const shouldSplit = currentCharCount >= TARGET_CHUNK_SIZE && atGoodBreakPoint;

        if (shouldSplit && currentChunk.length > 0) {
            flushCurrentChunk();
        }

        // Keep the hard limit effective for very large fenced documents by
        // closing and reopening the fence at a line boundary.
        if (inCodeBlock && currentCharCount >= MAX_CHUNK_SIZE && currentChunk.length > 0) {
            currentChunk.push("```");
            currentCharCount += "```".length + 1;
            flushCurrentChunk();

            const reopeningFence = codeFenceLanguage ? `\`\`\`${codeFenceLanguage}` : "```";
            currentChunk = [reopeningFence];
            currentCharCount = reopeningFence.length + 1;
        }
    }

    // Don't forget the last chunk
    if (inCodeBlock && currentChunk.length > 0) {
        currentChunk.push("```");
    }
    flushCurrentChunk();

    return chunks;
}

export function extractOverlapText(content: string): string {
    // Get the last ~OVERLAP_SIZE characters, but try to end at a sentence boundary
    if (!content || content.length <= OVERLAP_SIZE) {
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

    let overlap = sentenceEnd > 0 ? tail.slice(sentenceEnd + 2).trim() : content.slice(-OVERLAP_SIZE).trim();

    // Ensure overlap doesn't introduce unclosed/dangling code fences into the next chunk
    const fenceCount = (overlap.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
        overlap = overlap.replace(/```[a-zA-Z0-9_-]*/g, "").trim();
    }

    return overlap;
}

// ─────────────────────────────────────────────────────────────
// Summary generation
// ─────────────────────────────────────────────────────────────

export function generateChunkSummary(content: string, headers: string[]): string {
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

export function formatReadUrlResponse(doc: StoredDocument): string {
    const parts: string[] = [];

    parts.push(`**Title:** ${doc.title}`);

    if (doc.byline) {
        parts.push(`**Author:** ${doc.byline}`);
    }

    if (doc.excerpt) {
        parts.push(`**Summary:** ${doc.excerpt}`);
    }

    if (doc.format && doc.format !== "html") {
        parts.push(`**Format:** ${doc.format.toUpperCase()}`);
    }

    if (!doc.isReaderable && doc.format === "html") {
        parts.push(`\n⚠️ Note: This page may not be a standard article. Content extraction quality may vary.`);
    }

    if (doc.chunks.length === 1) {
        parts.push(`\n**Content:**\n\n${doc.chunks[0].content}`);
    } else {
        parts.push(`\nDocument contains ${doc.chunks.length} chunks:`);

        for (const chunk of doc.chunks) {
            const overlapNote = chunk.hasOverlap ? " (includes overlap)" : "";
            parts.push(`- [${chunk.position}] ${chunk.summary} (${chunk.charCount} chars${overlapNote})`);
        }

        parts.push(`\nUse view_content_chunk with document_id="${doc.url}" and position=N to read a chunk.`);
    }

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
