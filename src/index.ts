#!/usr/bin/env node
import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig, requireApiKey } from "./config.js";
import { createLogger } from "./log.js";
import { createGeminiClient } from "./gemini/client.js";
import { webSearchInput, runWebSearch } from "./tools/webSearch.js";
import { pageSummaryInput, runPageSummary } from "./tools/pageSummary.js";

const config = loadConfig();
const log = createLogger(config.logLevel);

const server = new McpServer({
  name: "gemini-web-mcp",
  version: "0.1.0"
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
  "page_summary",
  {
    title: "Page Summary (Gemini)",
    description: "Summarize a page via Gemini 3 Flash with URL context retrieval.",
    inputSchema: pageSummaryInput
  },
  async (input: any) => {
    try {
      const apiKey = requireApiKey(config);
      const ai = createGeminiClient(apiKey);
      const text = await runPageSummary({
        ai,
        model: config.urlSummaryModel,
        input
      });
      return { content: [{ type: "text", text }] };
    } catch (err) {
      log.error("page_summary failed", toErrorObject(err));
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
