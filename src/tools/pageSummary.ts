import { z } from "zod";
import type { GoogleGenAI } from "@google/genai";

import { safeGetResponseText } from "../gemini/response.js";

export const pageSummaryInput = {
  url: z.string().url(),
  focus: z.string().min(1).optional(),
  summary_length: z.enum(["short", "medium", "long"]).default("medium"),
  max_output_tokens: z.number().int().min(128).max(4096).default(1024)
};

export type PageSummaryArgs = {
  url: string;
  focus?: string;
  summary_length: "short" | "medium" | "long";
  max_output_tokens: number;
};

export async function runPageSummary(params: {
  ai: GoogleGenAI;
  model: string;
  input: PageSummaryArgs;
}): Promise<string> {
  const prompt = buildPrompt(params.input.url, params.input.focus, params.input.summary_length);

  const response = await params.ai.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: [{ urlContext: {} }],
      temperature: 0.2,
      maxOutputTokens: params.input.max_output_tokens
    }
  });

  const summary = safeGetResponseText(response as unknown as any).trim();
  const lines: string[] = [];
  lines.push(`## URL\n\n${params.input.url}`);
  lines.push(`\n## Summary\n\n${summary || "_No summary returned._"}`);
  return lines.join("\n");
}

function buildPrompt(url: string, focus: string | undefined, length: "short" | "medium" | "long"): string {
  const lengthGuidance =
    length === "short"
      ? "Write 5–8 bullet points and a 2-sentence summary."
      : length === "long"
        ? "Write a detailed outline with sections and key takeaways."
        : "Write a medium-length summary with sections and bullet points.";

  const focusLine = focus ? `Focus on: ${focus}` : "Cover the most important information on the page.";

  return [
    "Summarize the content of the URL using URL context retrieval.",
    "Do not rely on prior knowledge. If the page cannot be accessed or parsed, say so explicitly.",
    "",
    `URL: ${url}`,
    focusLine,
    "",
    lengthGuidance,
    "Output markdown."
  ].join("\n");
}
