import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { GoogleGenAI } from "@google/genai";

// Directory to save generated images
const IMAGE_OUTPUT_DIR = path.join(os.tmpdir(), "gemini-mcp-images");

/**
 * Input schema for the create_image tool
 */
export const createImageInput = {
    prompt: z.string().describe("Text prompt describing the image to generate or how to edit the input image(s)"),
    images: z.array(z.string()).optional().describe(
        "Optional array of file paths to images for editing. Supports up to 7 images. Example: ['/path/to/image.png']"
    ),
    aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional().describe(
        "Output aspect ratio. Default: 1:1. Only used for generation, not editing."
    )
};

export type CreateImageArgs = {
    prompt: string;
    images?: string[];
    aspect_ratio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
};

export type ImageResult = {
    success: boolean;
    images?: Array<{
        data: string;
        mimeType: string;
        filePath: string;  // Path where the image was saved
    }>;
    text?: string;
    error?: string;
};

/**
 * Run image generation or editing using Gemini's native image model
 * Generated images are saved to the temp directory and can be accessed by file path
 */
export async function runCreateImage(params: {
    ai: GoogleGenAI;
    model: string;
    input: CreateImageArgs;
}): Promise<ImageResult> {
    const { ai, model, input } = params;

    // Ensure output directory exists
    if (!fs.existsSync(IMAGE_OUTPUT_DIR)) {
        fs.mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
    }

    // Build content parts
    const contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Add text prompt
    contentParts.push({ text: input.prompt });

    // Add input images if provided (for editing)
    if (input.images && input.images.length > 0) {
        // Validate image count (max 7 images)
        if (input.images.length > 7) {
            return {
                success: false,
                error: `Too many input images. Max 7 images supported, got ${input.images.length}.`
            };
        }

        for (const imagePath of input.images) {
            try {
                // Read image file from disk
                const imageBuffer = fs.readFileSync(imagePath);
                const base64Data = imageBuffer.toString("base64");
                const mimeType = getMimeTypeFromPath(imagePath);

                contentParts.push({
                    inlineData: {
                        mimeType,
                        data: base64Data
                    }
                });
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to read image file: ${imagePath}. ${err instanceof Error ? err.message : String(err)}`
                };
            }
        }
    }

    // Build config
    const config: Record<string, unknown> = {
        responseModalities: ["Text", "Image"]
    };

    // Add aspect ratio config if specified and no input images (generation mode)
    if (input.aspect_ratio && (!input.images || input.images.length === 0)) {
        config.imageConfig = {
            aspectRatio: input.aspect_ratio
        };
    }

    // Call the Gemini API
    const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: contentParts as any }],
        config: config as any
    });

    // Extract results
    const result: ImageResult = {
        success: true,
        images: [],
        text: undefined
    };

    // Parse response parts
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
        return {
            success: false,
            error: "No response received from the model"
        };
    }

    for (const part of candidate.content.parts) {
        if ((part as any).text) {
            result.text = (part as any).text;
        } else if ((part as any).inlineData) {
            const inlineData = (part as any).inlineData;
            const mimeType = inlineData.mimeType || "image/png";
            const base64Data = inlineData.data;

            // Save image to temp directory
            const ext = getExtensionFromMimeType(mimeType);
            const timestamp = Date.now();
            const randomSuffix = Math.random().toString(36).substring(2, 8);
            const filename = `generated_${timestamp}_${randomSuffix}${ext}`;
            const filePath = path.join(IMAGE_OUTPUT_DIR, filename);

            // Write image to disk
            const imageBuffer = Buffer.from(base64Data, "base64");
            fs.writeFileSync(filePath, imageBuffer);

            result.images!.push({
                data: base64Data,
                mimeType,
                filePath
            });
        }
    }

    if (result.images!.length === 0 && !result.text) {
        return {
            success: false,
            error: "Model did not return any images or text"
        };
    }

    return result;
}

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml"
    };
    return mimeTypes[ext] || "image/png";
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
    const extensions: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg"
    };
    return extensions[mimeType] || ".png";
}
