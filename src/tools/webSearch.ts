import { z } from "zod";
import type { GoogleGenAI } from "@google/genai";

import { safeGetResponseText, extractGrounding, addInlineCitations, formatSources } from "../gemini/response.js";

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
      temperature: 1.0,
      maxOutputTokens: 1536
    }
  });

  const answer = safeGetResponseText(response as unknown as any).trim();
  const grounding = extractGrounding(response as unknown as any);

  // Add inline citations to the answer text
  const textWithCitations = addInlineCitations(answer, grounding.chunks, grounding.supports);

  const lines: string[] = [];
  lines.push(textWithCitations || "_No answer returned._");

  // Format sources with domain names
  const sources = formatSources(grounding.chunks);
  if (sources.length > 0) {
    lines.push("\n\nSources: " + sources.join(" "));
  }

  return lines.join("\n");
}

function buildSystemInstruction(domain?: string): string {
  const base = `You are a web search assistant with real-time search capabilities.

**Response Guidelines:**
- For factual/quick lookups (dates, definitions, simple facts): Be brief and direct
- For complex topics (how-to, comparisons, analysis): Provide structured, detailed explanations
- For current events/news: Summarize key points with context and timeline
- For technical queries: Include relevant code, specifications, or documentation references

**Core Principles:**
- Always use the most recent and authoritative sources
- Lead with the direct answer, then expand if needed
- Use bullet points or numbered lists for multi-part information
- Omit filler phrases and redundant context
- Match the depth of your response to the complexity of the query`;

  if (domain) {
    return `${base}\nPrioritize results from: ${domain}`;
  }
  return base;
}
