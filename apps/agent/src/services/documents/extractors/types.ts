/** Интерфейс извлечения данных из чеков/накладных (MVP: Stub, опц. Vision). */

import type { DocumentKind } from "../types.js";

export interface ExtractorInput {
  filePath: string;
  mimeType?: string;
  fileName?: string;
  caption?: string;
}

export interface ExtractorResult {
  kind: DocumentKind;
  docDate?: string;
  supplier?: string;
  total?: number;
  currency?: string;
  rawText?: string;
  items?: Array<{ name: string; qty?: number; sum?: number }>;
  confidence: number; // 0..1
  needsReview: boolean;
}

export interface DocumentExtractor {
  extract(input: ExtractorInput): Promise<ExtractorResult>;
}

/**
 * MVP-дефолт: парсит caption/подсказки без vision. Честно ставит needsReview.
 */
export class StubExtractor implements DocumentExtractor {
  async extract(input: ExtractorInput): Promise<ExtractorResult> {
    const { parseDateFromText, parseSupplierFromText, parseTotalFromText, todayYmd } =
      await import("./parsers.js");
    const caption = input.caption?.trim() ?? "";
    const total = parseTotalFromText(caption);
    const date = parseDateFromText(caption) ?? todayYmd();
    const supplier = parseSupplierFromText(caption);
    return {
      kind: "unknown",
      docDate: date,
      supplier,
      total,
      currency: "RUB",
      rawText: caption || undefined,
      confidence: total != null ? 0.4 : 0.1,
      needsReview: true,
    };
  }
}

export interface DocumentsConfig {
  provider?: "stub" | "vision";
  defaultCurrency?: string;
  dbPath?: string;
}

/**
 * Фабрика экстрактора: реальная vision-модель (если есть ключ И собран ocr-вызов),
 * иначе — честный StubExtractor (offline/тесты, needsReview).
 */
export function createExtractor(
  config: DocumentsConfig | undefined,
  hasVisionKey: boolean,
  visionOcr?: VisionOcrFn,
): DocumentExtractor {
  if (hasVisionKey && visionOcr) {
    // Реальный vision-backend: личный чат и группы — ОДИНАКОВО.
    return new VisionExtractor(visionOcr);
  }
  // Без vision-ключа — честный stub (прежнее поведение, для тестов/оффлайн).
  return new StubExtractor();
}

/** Готовый OCR-вызов: filePath + mime → распознанный текст (base64 внутри). */
export type VisionOcrFn = (filePath: string, mimeType?: string) => Promise<string>;

/**
 * Реальный OCR: читает файл → vision-модель (через переданный VisionOcrFn) →
 * парсит сумму/дату/поставщика и определяет kind по ключевым словам.
 * Честные confidence/needsReview: сбой OCR/PDF не роняет конвейер — результат
 * «нужна проверка» (caller ставит retry только на download-сбои).
 */
export class VisionExtractor implements DocumentExtractor {
  constructor(private readonly ocr: VisionOcrFn) {}

  async extract(input: ExtractorInput): Promise<ExtractorResult> {
    const { parseDateFromText, parseSupplierFromText, parseTotalFromText, todayYmd, detectKind } =
      await import("./parsers.js");

    // PDF / non-image: attempt only if caller supports; else needsReview
    let rawText = "";
    try {
      rawText = (await this.ocr(input.filePath, input.mimeType)).trim();
    } catch {
      return {
        kind: "unknown",
        docDate: todayYmd(),
        currency: "RUB",
        confidence: 0.1,
        needsReview: true,
        rawText: input.caption?.trim() || undefined,
      };
    }

    const caption = input.caption?.trim() ?? "";
    const combined = [rawText, caption].filter(Boolean).join("\n");
    const total = parseTotalFromText(combined);
    const docDate = parseDateFromText(combined) ?? todayYmd();
    const supplier = parseSupplierFromText(combined);
    const kind = detectKind(combined);

    return {
      kind,
      docDate,
      supplier,
      total,
      currency: "RUB",
      rawText: rawText || caption || undefined,
      confidence: total != null ? 0.85 : rawText ? 0.55 : 0.1,
      needsReview: total == null || !rawText,
    };
  }
}
