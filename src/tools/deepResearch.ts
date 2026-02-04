/**
 * Gemini Deep Research Tool
 *
 * Conducts comprehensive web research using Gemini's Deep Research Agent.
 * Ported from the Python implementation.
 */

import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

// --- Input Schema ---

export const deepResearchInput = z.object({
    prompt: z
        .string()
        .min(1, "prompt is required")
        .describe("Your research question or topic"),
    include_citations: z
        .boolean()
        .default(true)
        .describe("Whether to include source URLs in the report")
});

export type DeepResearchInput = z.infer<typeof deepResearchInput>;

// --- Output Type ---

export interface DeepResearchOutput {
    status: string;
    report_text: string;
}

// --- URL Redirect Resolution ---

/**
 * Pattern to match Gemini grounding redirect URLs
 */
const REDIRECT_URL_PATTERN =
    /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_-]+/g;

/**
 * Resolve a Gemini grounding redirect URL to its actual destination.
 * Uses HEAD request to follow redirects without downloading content.
 */
async function resolveRedirectUrl(url: string): Promise<string | null> {
    if (!url || !url.includes("grounding-api-redirect")) {
        return null;
    }

    try {
        // Use HEAD request with redirect: "manual" to capture Location header
        const response = await fetch(url, {
            method: "HEAD",
            redirect: "manual"
        });

        // Check for redirect status codes
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            if (location) {
                return location;
            }
        }

        // If no redirect, try GET as fallback
        const getResponse = await fetch(url, {
            method: "GET",
            redirect: "follow"
        });

        const finalUrl = getResponse.url;
        if (finalUrl !== url && !finalUrl.includes("grounding-api-redirect")) {
            return finalUrl;
        }
    } catch (error) {
        // Silently fail, keep original URL
    }

    return null;
}

/**
 * Find and resolve all grounding redirect URLs in text.
 * Replaces redirect URLs with resolved destination URLs where possible.
 */
async function resolveSourcesInText(text: string): Promise<string> {
    if (!text || !text.includes("grounding-api-redirect")) {
        return text;
    }

    const matches = text.match(REDIRECT_URL_PATTERN);
    if (!matches) {
        return text;
    }

    // Deduplicate URLs
    const uniqueUrls = [...new Set(matches)];

    // Resolve all URLs in parallel
    const resolutions = await Promise.all(
        uniqueUrls.map(async (url) => {
            const resolved = await resolveRedirectUrl(url);
            return { original: url, resolved };
        })
    );

    // Replace all occurrences
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
 *
 * We remove the References section since:
 * - The inline [cite: X] markers already show where info comes from
 * - The Sources section has the actual clickable URLs
 * - The References section just has brief titles without URLs
 */
function stripDuplicateReferences(text: string): string {
    // Match "### References" or "References" section with cite entries
    // Format: [cite: X] Title. Description.
    const pattern = /\n+(?:#{1,3}\s*)?References\s*\n(?:\[cite:\s*\d+\][^\n]*\n?)+/gi;
    const cleaned = text.replace(pattern, "\n");
    return cleaned.trim();
}

// --- Output Extraction ---

interface InteractionOutput {
    text?: string;
}

interface Interaction {
    id?: string;
    status?: string;
    outputs?: InteractionOutput[];
}

/**
 * Extract and join text from interaction outputs.
 */
function outputsToText(
    outputs: InteractionOutput[] | undefined | null,
    includeCitations: boolean
): string {
    if (!outputs || outputs.length === 0) {
        return "";
    }

    const parts: string[] = [];
    for (const out of outputs) {
        if (typeof out.text === "string" && out.text.trim()) {
            parts.push(out.text);
        }
    }

    let result = stripDuplicateReferences(parts.join("\n\n").trim());

    // Note: URL resolution is async and handled separately
    return result;
}

// --- Sleep Utility ---

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Main Tool Function ---

export interface RunDeepResearchParams {
    ai: GoogleGenAI;
    agent: string;
    timeoutSeconds: number;
    pollIntervalSeconds: number;
    input: DeepResearchInput;
}

export async function runDeepResearch(
    params: RunDeepResearchParams
): Promise<DeepResearchOutput> {
    const { ai, agent, timeoutSeconds, pollIntervalSeconds, input } = params;
    const { prompt, include_citations } = deepResearchInput.parse(input);

    if (!prompt.trim()) {
        throw new Error("`prompt` is required");
    }

    // 1. Start the Deep Research Agent
    const initialInteraction = (await ai.interactions.create({
        input: prompt.trim(),
        agent,
        background: true
    })) as Interaction;

    const jobId = initialInteraction.id;
    if (!jobId) {
        throw new Error("Gemini SDK did not return a research job id.");
    }

    // 2. Poll for results
    const deadline = Date.now() + timeoutSeconds * 1000;
    let interaction: Interaction = initialInteraction;

    while (true) {
        interaction = (await ai.interactions.get(jobId)) as Interaction;
        const status = interaction.status;

        if (status === "completed" || status === "failed" || status === "cancelled") {
            break;
        }

        if (Date.now() >= deadline) {
            break;
        }

        await sleep(pollIntervalSeconds * 1000);
    }

    // 3. Extract text from outputs
    let reportText = outputsToText(interaction.outputs, include_citations);

    // 4. Resolve redirect URLs if citations are enabled
    if (include_citations) {
        reportText = await resolveSourcesInText(reportText);
    }

    return {
        status: interaction.status ?? "unknown",
        report_text: reportText
    };
}
