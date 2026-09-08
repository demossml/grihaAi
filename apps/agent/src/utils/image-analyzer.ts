import type { GrishAiConfig, ModelConfig } from "@griha/shared-types";
import { ModelRouter } from "./model-router.js";

export type AnalyzeImageTask = "ocr" | "describe" | "ocr_and_describe";

export interface AnalyzeImageParams {
  imageUrl?: string;
  imageBase64?: string;
  fileId?: string;
  task: AnalyzeImageTask;
  languageHint?: string;
}

export type ImageInput =
  | { source: "url"; value: string }
  | { source: "base64"; value: string }
  | { source: "file"; value: string };

export interface VisionCaller {
  (
    vision: ModelConfig,
    image: ImageInput,
    task: AnalyzeImageTask,
    languageHint?: string,
  ): Promise<string>;
}

/** Resolve the image input and invoke the vision caller. */
export async function analyzeImage(
  params: AnalyzeImageParams,
  vision: VisionCaller,
  visionConfig: ModelConfig,
): Promise<string> {
  let image: ImageInput;
  if (params.imageBase64) image = { source: "base64", value: params.imageBase64 };
  else if (params.imageUrl) image = { source: "url", value: params.imageUrl };
  else if (params.fileId) image = { source: "file", value: params.fileId };
  else throw new Error("No image provided (imageUrl, imageBase64 or fileId required)");

  return vision(visionConfig, image, params.task, params.languageHint);
}

/**
 * Gate on vision config presence, then analyze. Returns a structured result so
 * the tool can report a clear error when vision is not configured.
 */
export async function runAnalyzeImage(
  config: GrishAiConfig,
  params: AnalyzeImageParams,
  vision: VisionCaller,
): Promise<{ ok: boolean; text: string }> {
  let visionConfig: ModelConfig;
  try {
    visionConfig = new ModelRouter(config).getConfig("vision");
  } catch {
    return { ok: false, text: "Vision model is not configured. Use /setup or /model to add it." };
  }

  try {
    const text = await analyzeImage(params, vision, visionConfig);
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}
