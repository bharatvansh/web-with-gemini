import { GoogleGenAI } from "@google/genai";

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

