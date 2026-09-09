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
 * Фабрика экстрактора: vision только если явно включён в config (ключ проверяет
 * caller через hasVisionKey). Иначе — StubExtractor.
 */
export function createExtractor(config: DocumentsConfig | undefined, hasVisionKey: boolean): DocumentExtractor {
  if (config?.provider === "vision" && hasVisionKey) {
    // VisionExtractor — будущая работа; MVP честно падает на stub.
    return new StubExtractor();
  }
  return new StubExtractor();
}
