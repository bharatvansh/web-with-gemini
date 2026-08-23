import test from "node:test";
import assert from "node:assert/strict";
import {
    detectContentFormat,
    parseJsonContent,
    parseMarkdownContent,
    parseCsvContent,
    parseCsvRecords,
    parseXmlContent,
    parseRssOrAtomFeed,
    parsePlainTextContent,
    parseHtmlContent,
    parseCsvLine,
    formatCsvAsMarkdownTable,
    isJunkHeader,
    cleanMarkdown,
    createChunksWithOverlap,
    extractOverlapText,
    generateChunkSummary,
    runReadUrlContent,
    runViewContentChunk,
    getDocumentStore,
    clearDocumentStore
} from "../src/tools/urlContent.js";

test("detectContentFormat identifies formats correctly", () => {
    assert.equal(detectContentFormat("application/pdf", "https://example.com/doc"), "pdf");
    assert.equal(detectContentFormat("application/octet-stream", "https://example.com/paper.pdf"), "pdf");

    assert.equal(detectContentFormat("application/json; charset=utf-8", "https://api.example.com/data"), "json");
    assert.equal(detectContentFormat("", "https://example.com/schema.json"), "json");

    assert.equal(detectContentFormat("text/markdown", "https://example.com/doc"), "markdown");
    assert.equal(detectContentFormat("text/plain", "https://raw.githubusercontent.com/user/repo/main/README.md"), "markdown");

    assert.equal(detectContentFormat("text/csv", "https://example.com/data"), "csv");
    assert.equal(detectContentFormat("", "https://example.com/dataset.tsv"), "csv");

    assert.equal(detectContentFormat("application/rss+xml", "https://example.com/feed"), "rss_atom");
    assert.equal(detectContentFormat("application/atom+xml", "https://example.com/atom"), "rss_atom");
    assert.equal(detectContentFormat("application/xml", "https://example.com/data.xml"), "xml");

    assert.equal(detectContentFormat("text/html; charset=utf-8", "https://example.com/page"), "html");
    assert.equal(detectContentFormat("", "https://example.com/page.html"), "html");

    assert.equal(detectContentFormat("text/plain", "https://example.com/script.py"), "plain_text");
    assert.equal(detectContentFormat("", "https://example.com/server.ts"), "plain_text");

    assert.equal(detectContentFormat("image/png", "https://example.com/pic.png"), "unsupported");
    assert.equal(detectContentFormat("video/mp4", "https://example.com/video.mp4"), "unsupported");
    assert.equal(detectContentFormat("application/zip", "https://example.com/archive.zip"), "unsupported");
});

test("parseJsonContent converts JSON object and array to markdown", () => {
    const jsonObject = JSON.stringify({
        name: "my-package",
        description: "A test package",
        version: "1.0.0",
        author: "Alice"
    });

    const parsedObj = parseJsonContent(jsonObject, "https://example.com/package.json");
    assert.equal(parsedObj.format, "json");
    assert.equal(parsedObj.title, "my-package");
    assert.equal(parsedObj.excerpt, "A test package");
    assert.equal(parsedObj.byline, "Alice");
    assert.ok(parsedObj.markdown.includes("```json"));
    assert.ok(parsedObj.markdown.includes('"name": "my-package"'));

    const jsonArray = JSON.stringify([{ id: 1, name: "Item 1" }, { id: 2, name: "Item 2" }]);
    const parsedArr = parseJsonContent(jsonArray, "https://example.com/items.json");
    assert.equal(parsedArr.format, "json");
    assert.ok(parsedArr.excerpt.includes("2 items"));
    assert.ok(parsedArr.markdown.includes('"Item 1"'));
});

test("parseMarkdownContent extracts title and preserves markdown structure", () => {
    const markdown = `# API Reference

Welcome to the API reference documentation.

## Authentication
Use bearer tokens.`;

    const parsed = parseMarkdownContent(markdown, "https://example.com/docs.md");
    assert.equal(parsed.format, "markdown");
    assert.equal(parsed.title, "API Reference");
    assert.ok(parsed.excerpt.includes("Welcome to the API reference"));
    assert.ok(parsed.markdown.includes("## Authentication"));
});

test("parseCsvContent converts CSV to Markdown table", () => {
    const csv = `Name,Age,Role\nAlice,30,Engineer\nBob,25,"Designer, UX"\nCharlie,35,Manager`;
    const parsed = parseCsvContent(csv, "https://example.com/team.csv");

    assert.equal(parsed.format, "csv");
    assert.ok(parsed.excerpt.includes("4 rows × 3 columns"));
    assert.ok(parsed.markdown.includes("| Name | Age | Role |"));
    assert.ok(parsed.markdown.includes("| --- | --- | --- |"));
    assert.ok(parsed.markdown.includes("| Alice | 30 | Engineer |"));
    assert.ok(parsed.markdown.includes("| Bob | 25 | Designer, UX |"));
});

test("parseCsvLine handles quoted fields with commas and escaped quotes", () => {
    const line = 'Alice,30,"New York, NY","He said ""Hello"""';
    const fields = parseCsvLine(line, ",");
    assert.deepEqual(fields, ["Alice", "30", "New York, NY", 'He said "Hello"']);
});

test("parseCsvRecords preserves quoted fields containing newlines", () => {
    const csv = "Name,Notes\nAlice,\"line one\nline two\"\nBob,ok";
    const rows = parseCsvRecords(csv, ",");

    assert.deepEqual(rows, [
        ["Name", "Notes"],
        ["Alice", "line one\nline two"],
        ["Bob", "ok"]
    ]);

    const parsed = parseCsvContent(csv, "https://example.com/team.csv");
    assert.equal(parsed.excerpt, "CSV Table: 3 rows × 2 columns");
    assert.ok(parsed.markdown.includes("| Alice | line one line two |"));
});

test("parseXmlContent handles generic XML", () => {
    const xml = `<config><app name="test"><port>8080</port></app></config>`;
    const parsed = parseXmlContent(xml, "https://example.com/config.xml");
    assert.equal(parsed.format, "xml");
    assert.ok(parsed.markdown.includes("```xml"));
    assert.ok(parsed.markdown.includes("<port>8080</port>"));
});

test("parseRssOrAtomFeed parses RSS feed items", () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Tech News</title>
    <description>Latest tech updates</description>
    <item>
      <title>Article 1</title>
      <link>https://example.com/article-1</link>
      <pubDate>Mon, 23 Aug 2026 00:00:00 GMT</pubDate>
      <description>Summary of article 1</description>
    </item>
    <item>
      <title>Article 2</title>
      <link>https://example.com/article-2</link>
      <description>Summary of article 2</description>
    </item>
  </channel>
</rss>`;

    const parsed = parseRssOrAtomFeed(rss, "https://example.com/feed.xml", false);
    assert.equal(parsed.format, "rss_atom");
    assert.equal(parsed.title, "Tech News");
    assert.ok(parsed.markdown.includes("## Feed Items (2)"));
    assert.ok(parsed.markdown.includes("[Article 1](https://example.com/article-1)"));
    assert.ok(parsed.markdown.includes("[Article 2](https://example.com/article-2)"));
});

test("parsePlainTextContent formats code and plain text", () => {
    const pythonCode = `import os\n\ndef greet(name):\n    return f"Hello, {name}"\n`;
    const parsedPy = parsePlainTextContent(pythonCode, "https://example.com/script.py");
    assert.equal(parsedPy.format, "plain_text");
    assert.ok(parsedPy.markdown.startsWith("```python\nimport os"));
    assert.ok(parsedPy.markdown.endsWith("```"));

    const plainText = "This is a simple plain text notes file.\nWith multiple lines.";
    const parsedTxt = parsePlainTextContent(plainText, "https://example.com/notes.txt");
    assert.equal(parsedTxt.format, "plain_text");
    assert.equal(parsedTxt.markdown, plainText);
});

test("parseHtmlContent extracts article with Readability", () => {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Sample Article Title</title>
    <meta name="description" content="Meta summary here">
</head>
<body>
    <header><nav>Navigation links</nav></header>
    <article>
        <h1>Sample Article Title</h1>
        <p>This is the main content paragraph of the article. It contains detailed informative text.</p>
        <p>Here is a second paragraph explaining more details about the topic.</p>
    </article>
    <footer>Footer copyright info</footer>
</body>
</html>`;

    const parsed = parseHtmlContent(html, "https://example.com/article");
    assert.equal(parsed.format, "html");
    assert.equal(parsed.title, "Sample Article Title");
    assert.ok(parsed.markdown.includes("This is the main content paragraph"));
    assert.ok(!parsed.markdown.includes("Navigation links"));
});

test("isJunkHeader filters noise headers", () => {
    assert.equal(isJunkHeader("python"), true);
    assert.equal(isJunkHeader("json"), true);
    assert.equal(isJunkHeader("note"), true);
    assert.equal(isJunkHeader("This is a complete sentence that is far too long to be a real header section"), true);
    assert.equal(isJunkHeader("Authentication & Authorization"), false);
    assert.equal(isJunkHeader("Getting Started"), false);
});

test("cleanMarkdown removes doctypes and empty markdown links", () => {
    const dirty = `<!doctype html>\n[Skip to content](#content)\n[#header]\n\n# Real Heading\n\nSome text.`;
    const cleaned = cleanMarkdown(dirty);
    assert.ok(!cleaned.includes("<!doctype"));
    assert.ok(!cleaned.includes("Skip to content"));
    assert.ok(cleaned.includes("# Real Heading"));
});

test("cleanMarkdown preserves valid fenced code blocks", () => {
    const fenced = "```json\n{\"ok\": true}\n```";
    assert.equal(cleanMarkdown(fenced), fenced);
});

test("createChunksWithOverlap preserves code blocks and generates overlap", () => {
    // Generate a long text with code blocks
    const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus diam. ".repeat(15);
    const codeBlock = "\n```typescript\nfunction longCodeBlock() {\n" + "  console.log('line');\n".repeat(40) + "}\n```\n";
    const fullText = `# Section One\n\n${paragraph}\n\n## Section Two\n\n${paragraph}${codeBlock}\n\n## Section Three\n\n${paragraph}`;

    const chunks = createChunksWithOverlap(fullText);
    assert.ok(chunks.length > 1);

    // Verify code block is intact and not severed improperly
    for (const chunk of chunks) {
        const openFences = (chunk.content.match(/```/g) || []).length;
        assert.equal(openFences % 2, 0, "Chunk should have matching code fences (even count)");
    }

    // Verify overlap presence on later chunks
    assert.equal(chunks[0].hasOverlap, false);
    if (chunks.length > 1) {
        assert.equal(chunks[1].hasOverlap, true);
    }
});

test("createChunksWithOverlap splits large fenced documents at safe boundaries", () => {
    const json = JSON.stringify(Array.from({ length: 5000 }, (_, index) => ({
        id: index,
        value: "x".repeat(40)
    })));
    const parsed = parseJsonContent(json, "https://example.com/data.json");
    const chunks = createChunksWithOverlap(cleanMarkdown(parsed.markdown));

    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
        const fenceCount = (chunk.content.match(/```/g) || []).length;
        assert.equal(fenceCount % 2, 0, "Chunk should have matching code fences");
    }
});

test("extractOverlapText extracts sentence boundaries", () => {
    const text = "First sentence here. Second sentence with detail. Third sentence at the end.";
    const overlap = extractOverlapText(text);
    assert.ok(overlap.length > 0);
    assert.ok(text.endsWith(overlap));
});

test("runViewContentChunk returns chunk content and navigation hints", () => {
    clearDocumentStore();
    const docStore = getDocumentStore();

    docStore.set("https://example.com/test-doc", {
        url: "https://example.com/test-doc",
        title: "Test Document",
        excerpt: "An excerpt",
        byline: "",
        fetchedAt: new Date(),
        isReaderable: true,
        format: "html",
        chunks: [
            {
                position: 0,
                headers: ["Section 1"],
                content: "Content of chunk 0",
                summary: "Section 1 | Content",
                charCount: 20,
                hasOverlap: false
            },
            {
                position: 1,
                headers: ["Section 2"],
                content: "Content of chunk 1",
                summary: "Section 2 | Content",
                charCount: 20,
                hasOverlap: true
            }
        ]
    });

    const chunk0 = runViewContentChunk({ document_id: "https://example.com/test-doc", position: 0 });
    assert.ok(chunk0.includes("## Chunk 0 of 1"));
    assert.ok(chunk0.includes("Section 1"));
    assert.ok(chunk0.includes("Content of chunk 0"));
    assert.ok(chunk0.includes("Next: position=1"));

    const chunk1 = runViewContentChunk({ document_id: "https://example.com/test-doc", position: 1 });
    assert.ok(chunk1.includes("## Chunk 1 of 1"));
    assert.ok(chunk1.includes("Section 2"));
    assert.ok(chunk1.includes("Content of chunk 1"));
    assert.ok(chunk1.includes("Previous: position=0"));

    const invalidPosition = runViewContentChunk({ document_id: "https://example.com/test-doc", position: 99 });
    assert.ok(invalidPosition.includes("Error: Invalid position"));

    const missingDoc = runViewContentChunk({ document_id: "https://example.com/nonexistent", position: 0 });
    assert.ok(missingDoc.includes("Error: Document not found"));
});

test("runReadUrlContent parses RSS MIME responses as RSS feeds", async () => {
    const originalFetch = globalThis.fetch;
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Tech News</title>
    <item>
      <title>Article 1</title>
      <link>https://example.com/article-1</link>
    </item>
  </channel>
</rss>`;

    clearDocumentStore();
    globalThis.fetch = async () => new Response(rss, {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
    });

    try {
        const result = await runReadUrlContent({ input: { Url: "https://example.com/feed" } });
        assert.ok(result.includes("**Title:** Tech News"));
        assert.ok(result.includes("## Feed Items (1)"));
        assert.ok(result.includes("[Article 1](https://example.com/article-1)"));
    } finally {
        globalThis.fetch = originalFetch;
        clearDocumentStore();
    }
});

test("parsePdfContent extracts text and format from PDF buffer", async () => {
    const minimalPdf = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 300 144]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
>>
endobj
4 0 obj
<<
/Length 55
>>
stream
BT
/F1 18 Tf
0 0 Td
(Hello PDF World) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000261 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
365
%%EOF`;

    const buffer = new Uint8Array(Buffer.from(minimalPdf, "utf-8"));
    const { parsePdfContent } = await import("../src/tools/urlContent.js");
    const result = await parsePdfContent(buffer, "https://example.com/test-paper.pdf");

    assert.equal(result.format, "pdf");
    assert.equal(result.title, "test-paper.pdf");
    assert.ok(result.markdown.includes("Hello PDF World"));
});
