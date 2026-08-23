import { z } from "zod";

const configSchema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GOOGLE_API_KEY: z.string().min(1).optional(),
  GEMINI_WEBSEARCH_MODEL: z.string().min(1).default("gemini-3.7-flash"),

  GEMINI_DEEP_RESEARCH_AGENT: z.string().min(1).default("deep-research-preview-04-2026"),

  GEMINI_IMAGE_MODEL: z.string().min(1).default("gemini-3.1-flash-image"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type AppConfig = {
  apiKey?: string;
  webSearchModel: string;

  deepResearchAgent: string;

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
    apiKey: parsed.data.GEMINI_API_KEY || parsed.data.GOOGLE_API_KEY,
    webSearchModel: parsed.data.GEMINI_WEBSEARCH_MODEL,

    deepResearchAgent: parsed.data.GEMINI_DEEP_RESEARCH_AGENT,

    imageModel: parsed.data.GEMINI_IMAGE_MODEL,
    logLevel: parsed.data.LOG_LEVEL
  };
}

export function requireApiKey(config: AppConfig): string {
  const key = config.apiKey?.trim();
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY (or GOOGLE_API_KEY fallback). Set it in your environment or .env.");
  }
  return key;
}
