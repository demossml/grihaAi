import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "@griha/config";
import {
  runAnalyzeImage,
  type AnalyzeImageParams,
  type VisionCaller,
} from "../../../src/utils/image-analyzer.js";

/** Emulated vision caller — swap for a real vision LLM call later. */
const emulatedVision: VisionCaller = async (_vision, image, task, languageHint) =>
  `[vision] ${task}${languageHint ? ` (${languageHint})` : ""}: ${image.source}:${image.value.slice(0, 80)}`;

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
      const result = await runAnalyzeImage(cfg, params, emulatedVision);
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
