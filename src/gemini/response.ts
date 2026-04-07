type GroundingChunkWeb = { uri?: string; title?: string };

type GroundingChunk = {
  web?: GroundingChunkWeb;
};

type GroundingSupport = {
  segment?: { startIndex?: number; endIndex?: number; text?: string };
  groundingChunkIndices?: number[];
};

type GroundingMetadata = {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
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
  chunks: GroundingChunk[];
  supports: GroundingSupport[];
  webSearchQueries: string[];
} {
  const meta = resp.candidates?.[0]?.groundingMetadata;
  return {
    chunks: meta?.groundingChunks ?? [],
    supports: meta?.groundingSupports ?? [],
    webSearchQueries: meta?.webSearchQueries ?? []
  };
}

export function addInlineCitations(
  text: string,
  chunks: GroundingChunk[],
  supports: GroundingSupport[]
): string {
  if (!supports.length || !chunks.length) return text;

  // Sort supports by endIndex descending to avoid shifting issues
  const sortedSupports = [...supports].sort(
    (a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0)
  );

  let result = text;
  for (const support of sortedSupports) {
    const endIndex = support.segment?.endIndex;
    if (endIndex === undefined || !support.groundingChunkIndices?.length) continue;

    const citations = support.groundingChunkIndices
      .map(i => {
        const title = chunks[i]?.web?.title;
        if (title) return `[${i + 1}]`;
        return null;
      })
      .filter(Boolean);

    if (citations.length > 0) {
      result = result.slice(0, endIndex) + citations.join("") + result.slice(endIndex);
    }
  }

  return result;
}

export function formatSources(chunks: GroundingChunk[]): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];

  chunks.forEach((c, i) => {
    const title = c.web?.title?.trim();
    const uri = c.web?.uri?.trim();
    
    // We need at least a title or a URI
    if (!title && !uri) return;
    
    // Use URI for deduplication if available, otherwise title
    const uniqueKey = uri || title;
    if (!uniqueKey || seen.has(uniqueKey)) return;
    
    seen.add(uniqueKey);
    
    if (title && uri) {
      sources.push(`[${i + 1}] ${title} (${uri})`);
    } else if (uri) {
      sources.push(`[${i + 1}] ${uri}`);
    } else if (title) {
      sources.push(`[${i + 1}] ${title}`);
    }
  });

  return sources;
}

