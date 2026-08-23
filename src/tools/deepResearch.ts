/**
 * Gemini Deep Research Tools
 *
 * Conducts comprehensive web research using Gemini's Deep Research Agent.
 * Exposes start_deep_research and check_deep_research tools.
 */

import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

// --- Input Schemas ---

export const startDeepResearchInput = z.object({
  prompt: z
    .string()
    .min(1, "prompt is required")
    .describe("Your comprehensive research question or topic to investigate")
});

export type StartDeepResearchInput = z.infer<typeof startDeepResearchInput>;

export const checkDeepResearchInput = z.object({
  job_id: z
    .string()
    .min(1, "job_id is required")
    .describe("The research tracking ID returned by start_deep_research"),
  include_citations: z
    .boolean()
    .default(true)
    .describe("Whether to include source URLs in the report (default: true)")
});

export type CheckDeepResearchInput = z.infer<typeof checkDeepResearchInput>;

// --- Output Interfaces ---

export interface StartResearchOutput {
  job_id: string;
  status: string;
}

export interface CheckResearchOutput {
  job_id: string;
  status: string;
  report_text?: string;
  uptime?: string;
  error?: string;
}

// --- Interaction Model Interfaces ---

export interface InteractionStep {
  type?: string;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface InteractionOutput {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface Interaction {
  id?: string;
  status?: string;
  created?: string | number | Date;
  updated?: string | number | Date;
  output_text?: string;
  outputs?: InteractionOutput[];
  steps?: InteractionStep[];
  error?: {
    code?: string | number;
    message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// --- URL Redirect Resolution & Caching ---

const REDIRECT_URL_PATTERN =
  /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_-]+/g;

const resolvedUrlCache = new Map<string, string>();

/**
 * Resolve a Gemini grounding redirect URL to its actual destination.
 * Uses HEAD request with manual redirect to capture Location header, fallback to GET.
 */
export async function resolveRedirectUrl(url: string): Promise<string | null> {
  if (!url || !url.includes("grounding-api-redirect")) {
    return null;
  }

  if (resolvedUrlCache.has(url)) {
    return resolvedUrlCache.get(url)!;
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual"
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (location) {
        resolvedUrlCache.set(url, location);
        return location;
      }
    }

    const getResponse = await fetch(url, {
      method: "GET",
      redirect: "follow"
    });

    const finalUrl = getResponse.url;
    if (finalUrl && finalUrl !== url && !finalUrl.includes("grounding-api-redirect")) {
      resolvedUrlCache.set(url, finalUrl);
      return finalUrl;
    }
  } catch {
    // Silently ignore network failures and fallback to original URL
  }

  return null;
}

/**
 * Find and resolve all grounding redirect URLs in text.
 * Replaces redirect URLs with resolved destination URLs where possible.
 */
export async function resolveSourcesInText(text: string): Promise<string> {
  if (!text || !text.includes("grounding-api-redirect")) {
    return text;
  }

  const matches = text.match(REDIRECT_URL_PATTERN);
  if (!matches) {
    return text;
  }

  const uniqueUrls = [...new Set(matches)];
  const resolutions = await Promise.all(
    uniqueUrls.map(async (url) => {
      const resolved = await resolveRedirectUrl(url);
      return { original: url, resolved };
    })
  );

  let result = text;
  for (const { original, resolved } of resolutions) {
    if (resolved) {
      result = result.split(original).join(resolved);
    }
  }

  return result;
}

// --- Reference Stripping ---

/**
 * Remove the redundant 'References' section while keeping 'Sources'.
 *
 * Gemini Deep Research reports contain:
 * 1. Inline [cite: X] markers throughout the text
 * 2. A 'References' section with brief citation titles (REDUNDANT)
 * 3. A 'Sources:' section at the end with full URLs (KEEP THIS)
 */
export function stripDuplicateReferences(text: string): string {
  const pattern = /\n+(?:#{1,3}\s*)?References\s*\n(?:\[cite:\s*\d+\][^\n]*\n?)+/gi;
  const cleaned = text.replace(pattern, "\n");
  return cleaned.trim();
}

// --- Output Extraction ---

/**
 * Extract and join text from interaction outputs.
 */
export function outputsToText(
  outputs: InteractionOutput[] | undefined | null
): string {
  if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
    return "";
  }

  const parts: string[] = [];
  for (const out of outputs) {
    if (typeof out?.text === "string" && out.text.trim()) {
      parts.push(out.text);
    }
  }

  return parts.join("\n\n").trim();
}

/**
 * Convert an Interaction object to synthesized report markdown text.
 */
export async function extractInteractionResult(
  interaction: Interaction,
  includeCitations: boolean = true
): Promise<string> {
  let rawText = "";

  if (interaction.outputs && Array.isArray(interaction.outputs) && interaction.outputs.length > 0) {
    rawText = outputsToText(interaction.outputs);
  } else if (typeof interaction.output_text === "string" && interaction.output_text.trim()) {
    rawText = interaction.output_text.trim();
  } else if (interaction.steps && Array.isArray(interaction.steps)) {
    const stepParts: string[] = [];
    for (const step of interaction.steps) {
      if (step?.type !== "model_output" || !Array.isArray(step.content)) {
        continue;
      }
      for (const item of step.content) {
        if (typeof item?.text === "string" && item.text.trim()) {
          stepParts.push(item.text);
        }
      }
    }
    rawText = stepParts.join("\n\n").trim();
  }

  let finalized = stripDuplicateReferences(rawText);
  if (includeCitations && finalized) {
    finalized = await resolveSourcesInText(finalized);
  }

  return finalized;
}

// --- Formatting Helpers ---

/**
 * Format uptime elapsed duration (e.g., "4m 12s", "1h 5m 30s") from created timestamp.
 */
export function formatUptime(created: unknown): string | null {
  if (!created) return null;
  try {
    let createdMs: number;
    if (typeof created === "string") {
      createdMs = new Date(created.replace("Z", "+00:00")).getTime();
    } else if (created instanceof Date) {
      createdMs = created.getTime();
    } else if (typeof created === "number") {
      createdMs = created < 1e11 ? created * 1000 : created;
    } else {
      return null;
    }

    if (Number.isNaN(createdMs)) return null;

    const now = Date.now();
    const diffSeconds = Math.max(0, Math.floor((now - createdMs) / 1000));

    const hours = Math.floor(diffSeconds / 3600);
    const mins = Math.floor((diffSeconds % 3600) / 60);
    const secs = diffSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  } catch {
    return null;
  }
}

/**
 * Format error details if the interaction failed.
 */
export function formatErrorDetail(interaction: Interaction): string | null {
  const error = interaction?.error;
  if (!error) return null;
  const code = error.code;
  const message = error.message;
  if (code && message) {
    return `Error ${code} - ${message}`;
  }
  if (message) {
    return String(message);
  }
  if (code) {
    return `Error ${code}`;
  }
  return null;
}

// --- Tool Implementations ---

export interface RunStartDeepResearchParams {
  ai: GoogleGenAI;
  agent: string;
  input: StartDeepResearchInput;
}

export async function runStartDeepResearch(
  params: RunStartDeepResearchParams
): Promise<StartResearchOutput> {
  const { ai, agent, input } = params;
  const parsed = startDeepResearchInput.parse(input);
  const prompt = parsed.prompt.trim();
  if (!prompt) {
    throw new Error("`prompt` is required");
  }

  const initialInteraction = (await ai.interactions.create({
    input: prompt,
    agent,
    background: true,
    store: true
  })) as Interaction;

  const jobId = initialInteraction?.id;
  if (!jobId) {
    throw new Error("Gemini SDK did not return a research job id.");
  }

  const status = initialInteraction?.status || "in_progress";
  return {
    job_id: String(jobId),
    status: String(status)
  };
}

export interface RunCheckDeepResearchParams {
  ai: GoogleGenAI;
  input: CheckDeepResearchInput;
}

export async function runCheckDeepResearch(
  params: RunCheckDeepResearchParams
): Promise<CheckResearchOutput> {
  const { ai, input } = params;
  const parsed = checkDeepResearchInput.parse(input);
  const jobId = parsed.job_id.trim();
  if (!jobId) {
    throw new Error("`job_id` is required");
  }

  const interaction = (await ai.interactions.get(jobId)) as Interaction;
  if (!interaction) {
    throw new Error(`No research job found for ID: ${jobId}`);
  }

  const status = String(interaction.status || "unknown");

  if (status === "completed") {
    const reportText = await extractInteractionResult(interaction, parsed.include_citations);
    return {
      job_id: jobId,
      status: "completed",
      report_text: reportText
    };
  }

  if (status === "in_progress") {
    const payload: CheckResearchOutput = {
      job_id: jobId,
      status: "in_progress"
    };
    const uptime = formatUptime(interaction.created);
    if (uptime) {
      payload.uptime = uptime;
    }
    return payload;
  }

  if (status === "failed" || status === "cancelled") {
    const payload: CheckResearchOutput = {
      job_id: jobId,
      status
    };
    const errorDetail = formatErrorDetail(interaction);
    if (errorDetail) {
      payload.error = errorDetail;
    }
    return payload;
  }

  // Other statuses (e.g. unknown)
  const reportText = await extractInteractionResult(interaction, parsed.include_citations);
  const payload: CheckResearchOutput = {
    job_id: jobId,
    status
  };
  if (reportText) {
    payload.report_text = reportText;
  }
  return payload;
}
