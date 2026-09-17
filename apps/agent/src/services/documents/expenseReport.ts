/**
 * generate_expense_report — детерминированный текстовый отчёт по расходам.
 *
 * Строго по эталону группы «ремонт»:
 *   Отчёт по расходам — группа "ремонт"
 *   Период: … · Разрез: по типам и позициям
 *   ЗАКУПКА МАТЕРИАЛА
 *     <Поставщик> — <сумма>
 *       • <позиция> — <цена>
 *     Итого — закупка материала <сумма>
 *   УСЛУГИ
 *     Доставка / Грузчик
 *     Итого — услуги <сумма>
 *   ИТОГО ЗА ПЕРИОД <сумма>
 *
 * Правила:
 * - суммы ТОЛЬКО из фактических позиций (total документа);
 * - при отсутствии total у документа — позиция суммируется по items (если есть),
 *   иначе документ помечается как «нужна проверка» и НЕ попадает в сумму;
 * - числа не выдумываются, итоги проверяются по разделам (закупка + услуги =
 *   итого за период).
 */
import type { ExpenseDocument } from "./types.js";

export interface ExpenseReportInputItem {
  name: string;
  qty?: number;
  sum?: number;
}

export interface ExpenseReportInputDoc {
  docDate: string;
  supplier?: string;
  total?: number;
  currency: string;
  items?: ExpenseReportInputItem[];
  needsReview: boolean;
}

export interface ExpenseReportOptions {
  periodLabel?: string;
  groupTitle?: string;
}

/** Является ли поставщик услугой (а не закупкой материала). */
function isService(supplier?: string): boolean {
  if (!supplier) return false;
  return /доставк|грузчик|разгрузк|услуг|монтаж|работа|погруз/i.test(supplier);
}

/** Является ли поставщик закупкой оборудования. */
function isEquipment(supplier?: string): boolean {
  if (!supplier) return false;
  return /оборудован|кондиционер|кофемашин|кофемолк|техник|станок|аппарат|холодильник|стиральн|посудомо/i.test(supplier);
}

function fmt(n: number): string {
  return n
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    .replace(/\./g, ",");
}

function money(n: number, currency: string): string {
  return `${fmt(n)} ${currency || "RUB"}`;
}

function docSum(doc: ExpenseReportInputDoc): number | undefined {
  if (doc.total !== undefined) return doc.total;
  const items = doc.items ?? [];
  if (items.length === 0) return undefined;
  let acc = 0;
  for (const it of items) {
    if (it.sum === undefined) return undefined; // неполная позиция → не выдумываем
    acc += it.sum;
  }
  return acc;
}

/** Собрать отчёт по эталонному формату. Пустые разделы опускаются. */
export function buildExpenseReport(
  docs: ExpenseReportInputDoc[],
  opts: ExpenseReportOptions = {},
): string {
  const groupTitle = opts.groupTitle ?? 'группа "ремонт"';
  const periodLabel = opts.periodLabel ?? "весь период";

  const materials: ExpenseReportInputDoc[] = [];
  const services: ExpenseReportInputDoc[] = [];
  const equipment: ExpenseReportInputDoc[] = [];
  const unresolved: ExpenseReportInputDoc[] = [];

  for (const doc of docs) {
    const s = docSum(doc);
    if (s === undefined) {
      unresolved.push(doc);
      continue;
    }
    if (isService(doc.supplier)) services.push(doc);
    else if (isEquipment(doc.supplier)) equipment.push(doc);
    else materials.push(doc);
  }

  const lines: string[] = [];
  lines.push(`Отчёт по расходам — ${groupTitle}`);
  lines.push(`Период: ${periodLabel} · Разрез: по типам и позициям`);
  lines.push("");

  let materialsTotal = 0;
  if (materials.length > 0) {
    lines.push("ЗАКУПКА МАТЕРИАЛА");
    lines.push("");
    for (const doc of materials) {
      const sum = docSum(doc)!;
      materialsTotal += sum;
      const name = doc.supplier ?? "?";
      lines.push(`${name} — ${money(sum, doc.currency)}`);
      const items = doc.items ?? [];
      for (const it of items) {
        const qty = it.qty !== undefined ? `${it.qty}×` : "";
        const price = it.sum !== undefined ? ` — ${fmt(it.sum)}` : "";
        lines.push(`• ${it.name}${qty ? ` ${qty}` : ""}${price}`);
      }
      lines.push("");
    }
    lines.push(`Итого — закупка материала ${money(materialsTotal, materials[0].currency)}`);
    lines.push("");
  }

  let servicesTotal = 0;
  if (services.length > 0) {
    lines.push("УСЛУГИ");
    lines.push("");
    for (const doc of services) {
      const sum = docSum(doc)!;
      servicesTotal += sum;
      const name = doc.supplier ?? "?";
      lines.push(`${indentServiceName(name)} — ${money(sum, doc.currency)}`);
      const items = doc.items ?? [];
      for (const it of items) {
        const price = it.sum !== undefined ? ` — ${fmt(it.sum)}` : "";
        lines.push(`• ${it.name}${price}`);
      }
      lines.push("");
    }
    lines.push(`Итого — услуги ${money(servicesTotal, services[0].currency)}`);
    lines.push("");
  }

  let equipmentTotal = 0;
  if (equipment.length > 0) {
    lines.push("ЗАКУПКА ОБОРУДОВАНИЯ");
    lines.push("");
    for (const doc of equipment) {
      const sum = docSum(doc)!;
      equipmentTotal += sum;
      const name = doc.supplier ?? "?";
      lines.push(`${name} — ${money(sum, doc.currency)}`);
      const items = doc.items ?? [];
      for (const it of items) {
        const qty = it.qty !== undefined ? `${it.qty}×` : "";
        const price = it.sum !== undefined ? ` — ${fmt(it.sum)}` : "";
        lines.push(`• ${it.name}${qty ? ` ${qty}` : ""}${price}`);
      }
      lines.push("");
    }
    lines.push(`Итого — закупка оборудования ${money(equipmentTotal, equipment[0].currency)}`);
    lines.push("");
  }

  const grand = materialsTotal + servicesTotal + equipmentTotal;
  const currency = materials[0]?.currency ?? services[0]?.currency ?? equipment[0]?.currency ?? "RUB";
  lines.push(`ИТОГО ЗА ПЕРИОД ${money(grand, currency)}`);

  if (unresolved.length > 0) {
    lines.push("");
    lines.push("Нужна проверка (не попали в сумму):");
    for (const doc of unresolved) {
      lines.push(`- ${doc.supplier ?? "?"} (${doc.docDate})`);
    }
  }

  return lines.join("\n");
}

/** Названия услуг в эталоне идут как разделы «Доставка»/«Грузчик». */
function indentServiceName(name: string): string {
  if (/достав/i.test(name)) return "Доставка";
  if (/грузчик|разгруз/i.test(name)) return "Грузчик";
  return name;
}
