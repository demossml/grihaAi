/**
 * Prompt 06 — таксономия ошибок + primaryFailure + failureChain.
 *
 * Машинные коды неудач вместо голого «ОШИБКА». Только коды, реально
 * встречающиеся в Griha (см. Architecture Map): model/tool/telegram/file/OCR/
 * STT/report + context/retrieval-диагностика.
 */

export type AgentErrorCode =
  | "CONTEXT_MISSING"
  | "CONTEXT_TOO_LARGE"
  | "RETRIEVAL_EMPTY"
  | "RETRIEVAL_IRRELEVANT"
  | "MODEL_ERROR"
  | "TOOL_ERROR"
  | "TOOL_TIMEOUT"
  | "TOOL_INVALID_RESULT"
  | "VALIDATION_ERROR"
  | "PERSISTENCE_ERROR"
  | "TELEGRAM_ERROR"
  | "FILE_ERROR"
  | "OCR_ERROR"
  | "STT_ERROR"
  | "REPORT_ERROR"
  | "UNKNOWN";

export interface PrimaryFailure {
  category: string;
  code: AgentErrorCode;
  stepId?: string;
  toolCallId?: string;
  explanation?: string;
}

/** Один шаг failureChain (упорядоченный список шагов, приведших к провалу). */
export interface FailureChainEntry {
  stepId: string;
  stepType: string;
  code?: AgentErrorCode;
  note?: string;
}

/** Коарс-категория по коду (для primaryFailure.category). */
export function categoryForCode(code: AgentErrorCode): string {
  switch (code) {
    case "CONTEXT_MISSING":
    case "CONTEXT_TOO_LARGE":
    case "RETRIEVAL_EMPTY":
    case "RETRIEVAL_IRRELEVANT":
      return "context";
    case "MODEL_ERROR":
    case "TOOL_ERROR":
    case "TOOL_TIMEOUT":
    case "TOOL_INVALID_RESULT":
    case "VALIDATION_ERROR":
      return "execution";
    case "TELEGRAM_ERROR":
      return "telegram";
    case "FILE_ERROR":
    case "OCR_ERROR":
    case "STT_ERROR":
    case "REPORT_ERROR":
      return "media";
    case "PERSISTENCE_ERROR":
      return "persistence";
    default:
      return "unknown";
  }
}

/**
 * Отобразить terminal turnCode (TelegramSessionPool) в AgentErrorCode.
 * Griha-терминальные коды: "timeout" (watchdog), "prompt_error", "ok".
 */
export function codeFromTurnCode(turnCode: string): AgentErrorCode {
  switch (turnCode) {
    case "timeout":
      return "TOOL_TIMEOUT";
    case "prompt_error":
      return "MODEL_ERROR";
    default:
      return "UNKNOWN";
  }
}

/**
 * Отобразить render-contracts `RenderErrorCode` в AgentErrorCode.
 * schema mismatch (`INVALID_INPUT`) и прочие render-сбои → REPORT_ERROR.
 * Коды: INVALID_INPUT / UNKNOWN_TEMPLATE / RENDER_FAILED / WRITE_FAILED / INTERNAL.
 */
export function codeFromRenderError(renderCode: string): AgentErrorCode {
  switch (renderCode) {
    case "INVALID_INPUT":
    case "UNKNOWN_TEMPLATE":
    case "RENDER_FAILED":
    case "WRITE_FAILED":
      return "REPORT_ERROR";
    default:
      return "UNKNOWN";
  }
}
