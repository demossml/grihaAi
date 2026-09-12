/**
 * F2/F3: классификация расхода после OCR — свободная категория и позиции.
 * Без хардкода доменов: категорию предлагает лёгкий LLM (или null), подсказки —
 * из chat-scoped памяти (expense_learning). Сбой классификации НЕ блокирует
 * ingest (category=null, честный needsReview).
 */
import type { ExpenseLineItem } from "./types.js";

export interface ClassifyExpenseInput {
  chatId: string;
  rawText: string;
  supplier?: string;
  total?: number;
  /** Подсказки памяти чата (прошлые исправления). */
  memoryHints: string[];
}

export interface ClassifyExpenseResult {
  category?: string;
  lineItems?: ExpenseLineItem[];
  tags?: string[];
}

export type ClassifyLlm = (prompt: string) => Promise<string>;

/** Допустимые ключи JSON-ответа LLM (никаких enum доменов). */
interface LlmClassifyJson {
  category?: string | null;
  line_items?: Array<{
    name?: string;
    qty?: number;
    unit?: string;
    amount?: number;
  }>;
  tags?: string[];
}

function parseLlmJson(raw: string): LlmClassifyJson | null {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as LlmClassifyJson;
  } catch {
    const m = /\{[\s\S]*\}/.exec(cleaned);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as LlmClassifyJson;
    } catch {
      return null;
    }
  }
}

/** Собрать prompt классификации (короткий русский label, свободный текст). */
export function buildClassifyPrompt(input: ClassifyExpenseInput): string {
  const hints = input.memoryHints.length
    ? `Подсказки памяти этой группы (если совпадает поставщик/товар — используй категорию из подсказки):\n${input.memoryHints.map((h) => `- ${h}`).join("\n")}\n`
    : "";
  return [
    "Извлеки категорию расхода и позиции из текста чека. Отвечай ТОЛЬКО JSON.",
    '{"category": "короткий русский ярлык или null", "line_items": [{"name": "...", "qty": число?, "unit": "м|шт|кг|...", "amount": число?}], "tags": ["..."]}',
    "Никогда не выдумывай суммы — amount/qty только если явно есть в тексте.",
    "Если категория неясна — category: null. Никаких enum-доменов: категория свободная.",
    hints,
    `Текст чека:\n${input.rawText.slice(0, 3000)}`,
    input.supplier ? `Поставщик: ${input.supplier}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Классификация: LLM (если есть) → парсинг JSON; сбой → честный null. */
export async function classifyExpense(
  input: ClassifyExpenseInput,
  deps: { llm?: ClassifyLlm } = {},
): Promise<ClassifyExpenseResult> {
  if (!deps.llm || !input.rawText.trim()) return {};
  try {
    const raw = await deps.llm(buildClassifyPrompt(input));
    const parsed = parseLlmJson(raw);
    if (!parsed) return {};
    const mapped = parsed.line_items?.map((l) => ({
      name: l.name?.trim(),
      qty: l.qty,
      unit: l.unit,
      amount: l.amount,
    }));
    const lineItems: ExpenseLineItem[] | undefined = mapped
      ? mapped
          .filter((l) => Boolean(l.name && l.name.length > 0))
          .map((l) => ({ name: l.name as string, qty: l.qty, unit: l.unit, amount: l.amount }))
      : undefined;
    return {
      category:
        typeof parsed.category === "string" && parsed.category.trim() !== ""
          ? parsed.category.trim()
          : undefined,
      lineItems: lineItems?.length ? lineItems : undefined,
      tags: parsed.tags?.length ? parsed.tags.map((t) => t.trim()).filter(Boolean) : undefined,
    };
  } catch (err: unknown) {
    console.error(
      "[expense-classify] failed:",
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

/** Подсказки памяти → строки для prompt («supplier "X" → category "Y"»). */
export function hintsToLines(
  hints: Array<{ patternType: string; pattern: string; category: string }>,
): string[] {
  return hints.map(
    (h) =>
      h.patternType === "supplier"
        ? `поставщик «${h.pattern}» → категория «${h.category}»`
        : `текст содержит «${h.pattern}» → категория «${h.category}»`,
  );
}

/**
 * F4: детерминированная подсказка до LLM — если поставщик/ключевое слово уже
 * встречалось в обучении чата, категория берётся из памяти без вызова LLM.
 */
export function memoryHintMatch(
  input: { supplier?: string; rawText: string },
  hints: Array<{ patternType: string; pattern: string; category: string }>,
): string | undefined {
  const lowerText = input.rawText.toLowerCase();
  for (const h of hints) {
    if (h.patternType === "supplier" && input.supplier) {
      if (input.supplier.toLowerCase() === h.pattern.toLowerCase()) return h.category;
    }
    if (h.patternType === "keyword" && h.pattern && lowerText.includes(h.pattern.toLowerCase())) {
      return h.category;
    }
  }
  return undefined;
}
