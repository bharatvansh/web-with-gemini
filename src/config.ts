import { z } from "zod";

const configSchema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_WEBSEARCH_MODEL: z.string().min(1).default("gemini-3-flash-preview"),

  GEMINI_DEEP_RESEARCH_AGENT: z.string().min(1).default("deep-research-pro-preview-12-2025"),
  GEMINI_DEEP_RESEARCH_TIMEOUT: z.coerce.number().int().min(60).default(1200),
  GEMINI_DEEP_RESEARCH_POLL_INTERVAL: z.coerce.number().int().min(5).default(10),

  GEMINI_IMAGE_MODEL: z.string().min(1).default("gemini-3-pro-image-preview"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type AppConfig = {
  apiKey?: string;
  webSearchModel: string;

  deepResearchAgent: string;
  deepResearchTimeoutSeconds: number;
  deepResearchPollIntervalSeconds: number;

  imageModel: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export function loadConfig(): AppConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return {
    apiKey: parsed.data.GEMINI_API_KEY,
    webSearchModel: parsed.data.GEMINI_WEBSEARCH_MODEL,

    deepResearchAgent: parsed.data.GEMINI_DEEP_RESEARCH_AGENT,
    deepResearchTimeoutSeconds: parsed.data.GEMINI_DEEP_RESEARCH_TIMEOUT,
    deepResearchPollIntervalSeconds: parsed.data.GEMINI_DEEP_RESEARCH_POLL_INTERVAL,

    imageModel: parsed.data.GEMINI_IMAGE_MODEL,
    logLevel: parsed.data.LOG_LEVEL
  };
}

export function requireApiKey(config: AppConfig): string {
  const key = config.apiKey?.trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY is missing. Set it in your environment or .env.");
  }
  return key;
}
