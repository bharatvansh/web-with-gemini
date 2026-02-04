import { z } from "zod";

const configSchema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_WEBSEARCH_MODEL: z.string().min(1).default("gemini-3-flash-preview"),
  GEMINI_URLSUMMARY_MODEL: z.string().min(1).default("gemini-3-flash-preview"),
  GEMINI_MAX_SOURCES_DEFAULT: z.coerce.number().int().min(1).max(10).default(5),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type AppConfig = {
  apiKey?: string;
  webSearchModel: string;
  urlSummaryModel: string;
  maxSourcesDefault: number;
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
    urlSummaryModel: parsed.data.GEMINI_URLSUMMARY_MODEL,
    maxSourcesDefault: parsed.data.GEMINI_MAX_SOURCES_DEFAULT,
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
