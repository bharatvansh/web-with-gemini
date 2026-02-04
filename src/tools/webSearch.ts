import { z } from "zod";
import type { GoogleGenAI } from "@google/genai";

import { safeGetResponseText, extractGrounding } from "../gemini/response.js";

export const webSearchInput = {
  query: z.string().describe("The search query to look up"),
  domain: z.string().optional().describe("Optional domain to recommend the search prioritize")
};

export type WebSearchArgs = {
  query: string;
  domain?: string;
};

export async function runWebSearch(params: {
  ai: GoogleGenAI;
  model: string;
  input: WebSearchArgs;
}): Promise<string> {
  const systemInstruction = buildSystemInstruction(params.input.domain);

  const response = await params.ai.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: params.input.query }] }],
    config: {
      systemInstruction,
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
      maxOutputTokens: 1024
    }
  });

  const answer = safeGetResponseText(response as unknown as any).trim();
  const grounding = extractGrounding(response as unknown as any);
  const sources = grounding.sources;

  const lines: string[] = [];
  lines.push(answer || "_No answer returned._");

  if (sources.length > 0) {
    lines.push("\n\n## Sources");
    sources.forEach((s, i) => {
      const title = s.title ? ` — ${s.title}` : "";
      lines.push(`${i + 1}. ${s.url}${title}`);
    });
  }

  return lines.join("\n");
}

function buildSystemInstruction(domain?: string): string {
  const base = "You're a web search assistant. Utilize the web capabilities and search for relevant information from the query. Rely on latest and accurate information. Give summary of the findings.";
  if (domain) {
    return `${base}\nPrioritize results from: ${domain}`;
  }
  return base;
}
