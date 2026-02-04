#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig, requireApiKey } from "./config.js";
import { createLogger } from "./log.js";
import { createGeminiClient } from "./gemini/client.js";
import { webSearchInput, runWebSearch } from "./tools/webSearch.js";
import {
  readUrlContentInput,
  runReadUrlContent,
  viewContentChunkInput,
  runViewContentChunk
} from "./tools/urlContent.js";
import { deepResearchInput, runDeepResearch } from "./tools/deepResearch.js";
import { createImageInput, runCreateImage } from "./tools/imageGeneration.js";

const config = loadConfig();
const log = createLogger(config.logLevel);

const server = new McpServer({
  name: "gemini-web-mcp",
  version: "0.2.0"
});

registerToolCompat(
  server,
  "search_web",
  {
    title: "Web Search",
    description: "Performs a web search for a given query. Returns a summary of relevant information along with URL citations.",
    inputSchema: webSearchInput
  },
  async (input: any) => {
    try {
      const apiKey = requireApiKey(config);
      const ai = createGeminiClient(apiKey);
      const text = await runWebSearch({
        ai,
        model: config.webSearchModel,
        input
      });
      return { content: [{ type: "text", text }] };
    } catch (err) {
      log.error("search_web failed", toErrorObject(err));
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

registerToolCompat(
  server,
  "read_url_content",
  {
    title: "Read URL Content",
    description:
      "Fetch content from a URL via HTTP request. Converts HTML to markdown. " +
      "No JavaScript execution, no authentication. For pages requiring login or JavaScript, " +
      "consider alternatives. Returns chunk summaries with positions - use view_content_chunk " +
      "to read specific chunks by position. The DocumentId for view_content_chunk is the URL.",
    inputSchema: readUrlContentInput
  },
  async (input: any) => {
    try {
      const text = await runReadUrlContent({ input });
      return { content: [{ type: "text", text }] };
    } catch (err) {
      log.error("read_url_content failed", toErrorObject(err));
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

registerToolCompat(
  server,
  "view_content_chunk",
  {
    title: "View Content Chunk",
    description:
      "View a specific chunk of document content using its DocumentId and chunk position. " +
      "The DocumentId must have already been read by the read_url_content tool before " +
      "this can be used on that particular DocumentId.",
    inputSchema: viewContentChunkInput
  },
  async (input: any) => {
    try {
      const text = runViewContentChunk(input);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      log.error("view_content_chunk failed", toErrorObject(err));
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

const DEEP_RESEARCH_DESCRIPTION = `Conduct comprehensive web research using Gemini's Deep Research Agent.

When to use this tool:
- Researching complex topics requiring multi-source analysis
- Need synthesized information from the web
- Require fact-checking and cross-referencing of information

Parameters:
- \`prompt\`: Your research question or topic (required)
- \`include_citations\`: Whether to include source URLs in the report (default: true)

Returns:
- \`status\`: Final state (completed, failed, cancelled)
- \`report_text\`: The synthesized research report with findings

Notes:
- This tool blocks until research completes (typically 10-20 minutes)`;

registerToolCompat(
  server,
  "gemini_deep_research",
  {
    title: "Gemini Deep Research",
    description: DEEP_RESEARCH_DESCRIPTION,
    inputSchema: deepResearchInput
  },
  async (input: any) => {
    try {
      const apiKey = requireApiKey(config);
      const ai = createGeminiClient(apiKey);
      const result = await runDeepResearch({
        ai,
        agent: config.deepResearchAgent,
        timeoutSeconds: config.deepResearchTimeoutSeconds,
        pollIntervalSeconds: config.deepResearchPollIntervalSeconds,
        input
      });
      // Return as JSON text for MCP
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      log.error("gemini_deep_research failed", toErrorObject(err));
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

const CREATE_IMAGE_DESCRIPTION = `Generate or edit images using natural language instructions.

Capabilities:
- **Text-to-Image**: Generate images from text prompts
- **Image-to-Image**: Edit existing images based on text instructions + reference image(s)

Parameters:
- \`prompt\`: Text prompt describing what to generate or how to edit (required)
- \`images\`: Array of file paths to images for editing mode (optional, up to 7 images)
- \`aspect_ratio\`: Output dimensions - "1:1", "16:9", "9:16", "4:3", "3:4" (optional, default: "1:1")

Notes:
- The resulting image will be saved as an artifact for use and file paths are returned
- Image model can't generate transparent images, use workarounds
- For best results, be specific and descriptive in your prompts`;

registerToolCompat(
  server,
  "create_image",
  {
    title: "Create Image",
    description: CREATE_IMAGE_DESCRIPTION,
    inputSchema: createImageInput
  },
  async (input: any) => {
    try {
      const apiKey = requireApiKey(config);
      const ai = createGeminiClient(apiKey);
      const result = await runCreateImage({
        ai,
        model: config.imageModel,
        input
      });

      if (!result.success) {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      }

      // Build content array with proper MCP content types
      const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];

      // Add text response if present
      if (result.text) {
        content.push({ type: "text", text: result.text });
      }

      // Add images using MCP's native image content type + include file paths
      if (result.images && result.images.length > 0) {
        const filePaths = result.images.map(img => img.filePath);

        // Add file paths as text so agent can access them
        content.push({
          type: "text",
          text: `Generated ${result.images.length} image(s). Saved to:\n${filePaths.join("\n")}\n\nYou can copy these to the workspace, pass back for edits, or retry if not as expected.`
        });

        // Add image previews
        for (const img of result.images) {
          content.push({
            type: "image",
            data: img.data,
            mimeType: img.mimeType
          });
        }
      }

      // If no content was added, return a success message
      if (content.length === 0) {
        content.push({ type: "text", text: "Image generated successfully but no content returned." });
      }

      return { content };
    } catch (err) {
      log.error("create_image failed", toErrorObject(err));
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("gemini-web-mcp running (stdio)");
}

main().catch((err) => {
  log.error("Fatal error", toErrorObject(err));
  process.exitCode = 1;
});

function formatError(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `Error: ${e.message}`;
}

function toErrorObject(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function registerToolCompat(
  serverInstance: any,
  name: string,
  def: { title?: string; description?: string; inputSchema: any },
  handler: (input: any) => Promise<any>
) {
  if (typeof serverInstance.registerTool === "function") {
    serverInstance.registerTool(name, def, handler);
    return;
  }
  if (typeof serverInstance.tool === "function") {
    try {
      serverInstance.tool(name, def.description ?? def.title ?? name, def.inputSchema, handler);
      return;
    } catch {
      serverInstance.tool(name, def.inputSchema, handler);
      return;
    }
  }
  throw new Error("MCP SDK does not expose registerTool/tool on McpServer.");
}
