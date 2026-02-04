# Gemini Web MCP (TypeScript)

An MCP (Model Context Protocol) server that exposes two tools powered by the Gemini Developers API:

- `web_search`: Gemini 3 Flash + Google Search grounding
- `page_summary`: Gemini 3 Flash + URL context

## Requirements

- Node.js 18+
- A Gemini Developers API key (`GEMINI_API_KEY`)

## Setup

```bash
npm i
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env` (or your shell env).

## Run

Dev (watch):

```bash
npm run dev
```

Build + run:

```bash
npm run build
npm start
```

## MCP host config (example)

Most MCP hosts accept a command-based server definition. Example (conceptual):

```json
{
  "name": "gemini-web-mcp",
  "command": "node",
  "args": ["dist/index.js"],
  "env": {
    "GEMINI_API_KEY": "YOUR_KEY"
  }
}
```

## Tools

### `web_search`

Input:

```json
{
  "query": "string",
  "answer_style": "concise | detailed (optional)",
  "max_sources": 5,
  "include_grounding_metadata": true
}
```

Output: a markdown answer with a sources section (URLs extracted from Gemini grounding metadata).

Notes:
- Uses Gemini grounding with the Google Search tool; usage may incur extra cost depending on your plan.

### `page_summary`

Input:

```json
{
  "url": "https://example.com",
  "focus": "optional string",
  "summary_length": "short | medium | long (optional)",
  "max_output_tokens": 1024
}
```

Output: a markdown summary derived from URL context retrieval.

## Troubleshooting

- If you see `GEMINI_API_KEY is missing`, set it in `.env` or your environment.
- Some URLs can’t be summarized if they are blocked, require auth, or are non-text.

## References (official)

```text
Gemini Developers API docs: https://ai.google.dev/gemini-api
Gemini built-in tools (Google Search / URL context): https://ai.google.dev/gemini-api/docs/tools
Gemini models list: https://ai.google.dev/gemini-api/docs/models
MCP spec: https://modelcontextprotocol.io
MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
```
