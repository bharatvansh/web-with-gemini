# Gemini Web MCP

[![npm version](https://img.shields.io/npm/v/gemini-web-mcp)](https://www.npmjs.com/package/gemini-web-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org/)

An MCP server that brings **Gemini-powered web tools** to your AI coding assistant—web search, content extraction, deep research, and image generation.

## ✨ Features

| Tool | Description |
|------|-------------|
| **`search_web`** | Web search with AI-synthesized summaries and citations |
| **`read_url_content`** | Extract and convert web pages to clean markdown |
| **`view_content_chunk`** | Navigate large documents chunk by chunk |
| **`gemini_deep_research`** | Multi-source analysis with Gemini's Deep Research Agent |
| **`create_image`** | Generate or edit images using natural language |

---

## One-Click Install

| IDE | Install |
|-----|---------|
| **Cursor** | [![Install in Cursor](https://img.shields.io/badge/Install-Cursor-blue?logo=cursor)](https://cursor.com/en/install-mcp?name=gemini-web&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdlbWluaS13ZWItbWNwIl0sImVudiI6eyJHRU1JTklfQVBJX0tFWSI6InlvdXItYXBpLWtleSJ9fQ==) |
| **VS Code** | [![Install in VS Code](https://img.shields.io/badge/Install-VS%20Code-007ACC?logo=visualstudiocode)](https://insiders.vscode.dev/redirect/mcp/install?name=gemini-web&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22gemini-web-mcp%22%5D%2C%22env%22%3A%7B%22GEMINI_API_KEY%22%3A%22your-api-key%22%7D%7D) |
| **VS Code Insiders** | [![Install in VS Code Insiders](https://img.shields.io/badge/Install-VS%20Code%20Insiders-24bfa5?logo=visualstudiocode)](https://insiders.vscode.dev/redirect/mcp/install?name=gemini-web&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22gemini-web-mcp%22%5D%2C%22env%22%3A%7B%22GEMINI_API_KEY%22%3A%22your-api-key%22%7D%7D&quality=insiders) |

> **Note:** After clicking, replace `your-api-key` with your [Gemini API key](https://aistudio.google.com/apikey). VS Code requires version 1.101+.

---

## 🚀 Installation

### Using npx (Recommended)

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npx gemini-web-mcp
```

<details>
<summary><strong>VS Code config</strong></summary>

```json
{
  "servers": {
    "gemini-web": {
      "command": "npx",
      "args": ["-y", "gemini-web-mcp"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Claude Desktop config</strong></summary>

```json
{
  "mcpServers": {
    "gemini-web": {
      "command": "npx",
      "args": ["-y", "gemini-web-mcp"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor config</strong></summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gemini-web": {
      "command": "npx",
      "args": ["-y", "gemini-web-mcp"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf config</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json` (macOS/Linux) or `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (Windows):

```json
{
  "mcpServers": {
    "gemini-web": {
      "command": "npx",
      "args": ["-y", "gemini-web-mcp"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Cline config</strong></summary>

```json
{
  "mcpServers": {
    "gemini-web": {
      "command": "npx",
      "args": ["-y", "gemini-web-mcp"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Claude Code config</strong></summary>

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "gemini-web": {
      "command": "npx",
      "args": ["-y", "gemini-web-mcp"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Antigravity config</strong></summary>

1. Open the **Agent side panel** → click **...** → **MCP Store**
2. Click **Add Custom Server**
3. Add this configuration:

```json
{
  "gemini-web": {
    "command": "npx",
    "args": ["-y", "gemini-web-mcp"],
    "env": {
      "GEMINI_API_KEY": "your-api-key"
    }
  }
}
```
</details>

---

### Using npm (Global Install)

```bash
npm install -g gemini-web-mcp
```

Then use `gemini-web-mcp` as the command instead of `npx -y gemini-web-mcp` in your MCP configs.

---

## ⚙️ Configuration

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `GEMINI_API_KEY` | ✓ | — | Your [Gemini API key](https://aistudio.google.com/apikey) |
| `GEMINI_WEBSEARCH_MODEL` | | `gemini-3-flash-preview` | Model for web search |
| `GEMINI_DEEP_RESEARCH_AGENT` | | `deep-research-pro-preview-12-2025` | Deep Research model |
| `GEMINI_DEEP_RESEARCH_TIMEOUT` | | `1200` | Research timeout in seconds |
| `GEMINI_DEEP_RESEARCH_POLL_INTERVAL` | | `10` | Polling interval in seconds |
| `GEMINI_IMAGE_MODEL` | | `gemini-3-pro-image-preview` | Image generation model |
| `LOG_LEVEL` | | `info` | Logging level |

---

## 🛠️ Tools Reference

### `search_web`

Performs a web search and returns an AI-synthesized summary with citations.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `query` | string | ✓ | Search query |

---

### `read_url_content`

Fetches a URL and converts its content to clean markdown. Returns chunk summaries for navigation.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `url` | string | ✓ | URL to fetch |

---

### `view_content_chunk`

Retrieves a specific chunk from a previously fetched document.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| `document_id` | string | ✓ | The URL used in `read_url_content` |
| `position` | number | ✓ | Chunk position to view |

---

### `gemini_deep_research`

Conducts comprehensive web research using Gemini's Deep Research Agent. Blocks until complete (typically 10-20 minutes).

| Parameter | Type | Required | Default | Description |
|-----------|------|:--------:|---------|-------------|
| `prompt` | string | ✓ | — | Research question or topic |
| `include_citations` | boolean | | `true` | Include source URLs |

**Returns:** `{ status, report_text }`

---

### `create_image`

Generate images from text prompts or edit existing images.

| Parameter | Type | Required | Default | Description |
|-----------|------|:--------:|---------|-------------|
| `prompt` | string | ✓ | — | Text description or edit instructions |
| `images` | string[] | | — | File paths for image editing (up to 7) |
| `aspect_ratio` | string | | `"1:1"` | `"1:1"`, `"16:9"`, `"9:16"`, `"4:3"`, `"3:4"` |

---

## 🧑‍💻 Development

```bash
git clone https://github.com/bharatvansh/gemini-web-mcp.git
cd gemini-web-mcp
npm install
npm run dev
```

| Script | Description |
|--------|-------------|
| `npm run dev` | Run with hot reload |
| `npm run build` | Build for production |
| `npm run typecheck` | Type check only |
| `npm start` | Start production server |

---

## 📄 License

MIT
