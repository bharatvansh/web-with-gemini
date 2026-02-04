type GroundingChunkWeb = { uri?: string; title?: string };

type GroundingChunk = {
  web?: GroundingChunkWeb;
};

type GroundingMetadata = {
  groundingChunks?: GroundingChunk[];
  webSearchQueries?: string[];
};

type Candidate = {
  content?: {
    parts?: Array<{ text?: string }>;
  };
  groundingMetadata?: GroundingMetadata;
};

type GenerateContentResponse = {
  text?: string;
  candidates?: Candidate[];
};

export function safeGetResponseText(resp: GenerateContentResponse): string {
  if (typeof resp.text === "string") return resp.text;
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim();
}

export function extractGrounding(resp: GenerateContentResponse): {
  sources: Array<{ title?: string; url: string }>;
  webSearchQueries: string[];
  rawGroundingMetadata?: unknown;
} {
  const meta = resp.candidates?.[0]?.groundingMetadata;
  const chunks = meta?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: Array<{ title?: string; url: string }> = [];
  for (const c of chunks) {
    const url = c.web?.uri?.trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ title: c.web?.title, url });
  }
  return {
    sources,
    webSearchQueries: meta?.webSearchQueries ?? [],
    rawGroundingMetadata: meta
  };
}

