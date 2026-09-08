import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Type, type Static } from "typebox";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transcribeVoice } from "@griha/stt";
import { loadConfig } from "@griha/config";
import { downloadTelegramFileToDisk } from "../../../src/utils/telegram-files.js";
import { assessTranscriptConfidence } from "../../../src/utils/voice-intake.js";

const TranscribeVoiceSchema = Type.Object({
  /** Local audio file path. */
  filePath: Type.Optional(Type.String()),
  /** Telegram voice/file_id to download first (requires bot token in config). */
  fileId: Type.Optional(Type.String()),
  language: Type.Optional(Type.String()),
});
type TranscribeVoiceParams = Static<typeof TranscribeVoiceSchema>;

/**
 * Voice intake — transcribe a voice message and report confidence. When the
 * transcript is uncertain, the returned instruction tells the agent to re-ask
 * instead of guessing critical numbers/dates/names/amounts.
 */
export default function voiceIntake(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "transcribe_voice",
    label: "Transcribe voice",
    description:
      "Транскрибировать голосовое сообщение (локальный путь или Telegram file_id). Возвращает текст и confidence; при неоднозначности — переспроси пользователя, не додумывай числа/даты/имена/суммы.",
    parameters: TranscribeVoiceSchema,
    async execute(
      _toolCallId: string,
      params: TranscribeVoiceParams,
    ): Promise<
      AgentToolResult<{
        text?: string;
        confidence?: number;
        uncertain?: boolean;
        error?: string;
      }>
    > {
      let filePath = params.filePath;
      try {
        if (!filePath && params.fileId) {
          const token = loadConfig()?.telegram?.botToken;
          if (!token) {
            return {
              content: [{ type: "text", text: "Voice transcription unavailable: no bot token configured." }],
              details: { error: "no bot token" },
            };
          }
          filePath = path.join(os.tmpdir(), `griha-voice-${randomUUID()}.ogg`);
          await downloadTelegramFileToDisk(token, params.fileId, filePath);
        }
        if (!filePath) {
          return {
            content: [{ type: "text", text: "Provide filePath or fileId." }],
            details: { error: "no input" },
          };
        }

        const result = await transcribeVoice(filePath, { language: params.language });
        const assessment = assessTranscriptConfidence(result);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Transcription failed: ${result.error ?? "unknown error"}` }],
            details: { error: result.error, uncertain: true, confidence: 0 },
          };
        }
        const clarify = assessment.uncertain
          ? "\n\nТранскрипция неоднозначна — переспроси пользователя и не додумывай числа, даты, имена и суммы."
          : "";
        return {
          content: [{ type: "text", text: result.text + clarify }],
          details: {
            text: result.text,
            confidence: assessment.confidence,
            uncertain: assessment.uncertain,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Transcription failed: ${message}` }],
          details: { error: message, uncertain: true, confidence: 0 },
        };
      }
    },
  });
}
