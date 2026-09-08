import type { ModelConfig } from "@griha/shared-types";
import { CUSTOM_BASE_URL_DEFAULT, DEEPSEEK_BASE_URL } from "./provider-bootstrap.js";
import type { AnalyzeImageTask, ImageInput, VisionCaller } from "./image-analyzer.js";

export interface HttpVisionOptions {
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/** OpenAI-compatible base URL for a vision model, falling back to known defaults. */
export function resolveVisionBaseUrl(vision: ModelConfig): string {
  const base = vision.baseUrl
    ? vision.baseUrl
    : vision.provider === "deepseek"
      ? DEEPSEEK_BASE_URL
      : CUSTOM_BASE_URL_DEFAULT;
  return base.replace(/\/+$/, "");
}

function buildPrompt(task: AnalyzeImageTask, languageHint?: string): string {
  const lang = languageHint ? ` Отвечай на языке: ${languageHint}.` : "";
  switch (task) {
    case "ocr":
      return `Извлеки весь текст с изображения. Сохрани порядок и переносы строк, ничего не перефразируй.${lang}`;
    case "describe":
      return `Кратко опиши, что изображено на картинке.${lang}`;
    case "ocr_and_describe":
      return `Сначала извлеки весь текст с изображения, затем кратко опиши, что изображено.${lang}`;
  }
}

function imageToContent(image: ImageInput): { type: "image_url"; image_url: { url: string } } {
  if (image.source === "url") {
    return { type: "image_url", image_url: { url: image.value } };
  }
  if (image.source === "base64") {
    const dataUrl = image.value.startsWith("data:")
      ? image.value
      : `data:image/jpeg;base64,${image.value}`;
    return { type: "image_url", image_url: { url: dataUrl } };
  }
  throw new Error(
    "Image source 'file' (Telegram file_id) must be resolved to base64 before the vision call",
  );
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const p = part as { type?: string; text?: string };
        return p?.type === "text" && typeof p.text === "string" ? p.text : "";
      })
      .join("");
  }
  return "";
}

/**
 * Real vision backend: OpenAI-compatible `POST {baseUrl}/chat/completions` with
 * an `image_url` user message. The provider key comes from `ModelConfig.apiKey`
 * (registered through `pi.registerProvider` by the caller) — it is never read
 * from `process.env`, which pi only snapshots at startup.
 */
export function createHttpVisionCaller(options: HttpVisionOptions = {}): VisionCaller {
  return async (vision, image, task, languageHint) => {
    if (!vision.apiKey) {
      throw new Error(`Vision provider "${vision.provider}" has no API key configured`);
    }

    const fetchFn = options.fetchFn ?? fetch;
    const base = resolveVisionBaseUrl(vision);

    const response = await fetchFn(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vision.apiKey}`,
      },
      body: JSON.stringify({
        model: vision.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(task, languageHint) },
              imageToContent(image),
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Vision API error ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = contentToText(json.choices?.[0]?.message?.content);
    if (!text) throw new Error("Vision API returned no content");
    return text;
  };
}
