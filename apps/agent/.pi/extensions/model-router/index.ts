import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "@griha/config";
import {
  runAnalyzeImage,
  type AnalyzeImageParams,
  type VisionCaller,
} from "../../../src/utils/vision/image-analyzer.js";
import { createHttpVisionCaller } from "../../../src/utils/vision/http-vision.js";
import { downloadTelegramFileAsBase64 } from "../../../src/utils/telegram/telegram-files.js";
import { registerModelProvider } from "../../../src/utils/bootstrap/provider-bootstrap.js";
import { ModelRouter } from "../../../src/utils/routing/model-router.js";

/** Emulated vision caller kept for offline/time-free unit tests. */
export const emulatedVision: VisionCaller = async (_vision, image, task, languageHint) =>
  `[vision] ${task}${languageHint ? ` (${languageHint})` : ""}: ${image.source}:${image.value.slice(0, 80)}`;

/** Real vision caller: OpenAI-compatible /chat/completions to models.vision. */
const realVision = createHttpVisionCaller();

export default function modelRouter(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    const guidance = [
      "## Изображения и OCR",
      "У тебя есть tool analyze_image. Когда пользователь присылает фото, скриншот или скан — используй analyze_image, чтобы получить текст или описание.",
      "После получения результата продолжай работать уже сам.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
  });

  pi.registerTool({
    name: "analyze_image",
    label: "Analyze image",
    description:
      "Распознать текст на изображении (OCR) или описать содержимое картинки. Использовать когда пользователь прислал фото, скриншот, скан документа.",
    parameters: Type.Object({
      imageUrl: Type.Optional(Type.String()),
      imageBase64: Type.Optional(Type.String()),
      fileId: Type.Optional(Type.String()),
      task: Type.Union([
        Type.Literal("ocr"),
        Type.Literal("describe"),
        Type.Literal("ocr_and_describe"),
      ]),
      languageHint: Type.Optional(Type.String()),
    }),
    async execute(
      _id: string,
      params: AnalyzeImageParams,
    ): Promise<AgentToolResult<{ ok: boolean }>> {
      const cfg = loadConfig();
      if (!cfg) {
        return {
          content: [{ type: "text", text: "No config found — run /setup first." }],
          details: { ok: false },
        };
      }

      // Phase 10: a Telegram photo arrives as a `file_id`. Resolve it to image
      // bytes through the Bot API before the vision call (the Main Brain path).
      let resolved = params;
      if (params.fileId) {
        const botToken = cfg.telegram?.botToken;
        if (!botToken) {
          return {
            content: [{ type: "text", text: "Telegram bot token is not configured — cannot resolve file_id." }],
            details: { ok: false },
          };
        }
        try {
          const dataUrl = await downloadTelegramFileAsBase64(botToken, params.fileId);
          resolved = { ...params, fileId: undefined, imageBase64: dataUrl };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to download Telegram photo: ${message}` }],
            details: { ok: false },
          };
        }
      }

      // Register the vision provider key through pi (§6: env is not re-read
      // after startup). The real caller reads the key from the model config.
      try {
        registerModelProvider(pi, new ModelRouter(cfg).getConfig("vision"));
      } catch {
        // runAnalyzeImage reports the missing-vision error below.
      }

      const result = await runAnalyzeImage(cfg, resolved, realVision);
      return { content: [{ type: "text", text: result.text }], details: { ok: result.ok } };
    },
  });

  pi.registerCommand("models", {
    description: "Show main + vision model status",
    async handler() {
      const cfg = loadConfig();
      if (!cfg) {
        pi.sendMessage({
          customType: "models",
          content: [{ type: "text", text: "No config found — run /setup first." }],
          display: true,
        });
        return;
      }
      const main = cfg.models?.main ?? { provider: cfg.provider, model: cfg.model };
      const vision = cfg.models?.vision;
      const text = `Main: ${main.provider}/${main.model}\nVision: ${
        vision ? `${vision.provider}/${vision.model}` : "не настроен (настрой через /setup)"
      }`;
      pi.sendMessage({
        customType: "models",
        content: [{ type: "text", text }],
        display: true,
        details: { main, vision },
      });
    },
  });
}
