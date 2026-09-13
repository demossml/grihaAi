// Бэкфилл line_items в expense_documents для группы «ремонт» (-5400215325).
// Разовый прогон: кладёт разобранные позиции (name, qty, unit, amount, category)
// в колонку line_items, чтобы отчёты читали из БД, а не парсили raw_text.
import Database from "better-sqlite3";

const db = new Database("/home/admingimolost/.grish-ai/documents.sqlite");

const data = [
  {
    id: "4858c373-5a9e-456d-82e7-192cf6eb892f", // Ленино 30.05
    items: [
      { name: "Сантек влажные антибактериальные, 72 шт", qty: 1, unit: "шт", amount: 96.0, category: "материалы" },
      { name: "Набор перчаток х/б (10 пар)", qty: 1, unit: "шт", amount: 98.0, category: "материалы" },
      { name: "Плита гипсовая пазогребневая КППГ 80 мм, 667×500×80", qty: 50, unit: "шт", amount: 15899.5, category: "материалы" },
      { name: "Перфорированная лента 12×0,5, 25 м, оцинкованная", qty: 1, unit: "шт", amount: 498.0, category: "материалы" },
      { name: "Грунтовка глубокого проникновения Ceresit CT17, 10 л", qty: 1, unit: "шт", amount: 1090.0, category: "материалы" },
      { name: "Клей гипсовый монтажный Knauf Perlfix 30 кг", qty: 2, unit: "шт", amount: 1286.0, category: "материалы" },
      { name: "Ножовка по гипсокартону Delta Premium 500 мм", qty: 1, unit: "шт", amount: 688.0, category: "материалы" },
      { name: "Скоба для пазогребневой плиты 0,9 мм", qty: 15, unit: "шт", amount: 160.5, category: "материалы" },
      { name: "Дюбель-гвоздь потайной 6×80 мм (100 шт)", qty: 1, unit: "уп", amount: 398.0, category: "материалы" },
      { name: "Лента уплотнительная Knauf 30 мм × 30 м", qty: 1, unit: "шт", amount: 301.0, category: "материалы" },
    ],
  },
  {
    id: "3378160a-8595-4215-a6b8-3171ccab45c0", // Электрик 10.09
    items: [
      { name: "Кабель ВВГ-ПНГ(А)-LS 3×2,5 ГОСТ", qty: 10, unit: "м", amount: 2179.0, category: "материалы" },
      { name: "Дюбель-хомут ДХП 12-6 (уп. 100 шт)", qty: 2, unit: "уп", amount: 258.0, category: "материалы" },
    ],
  },
  {
    id: "11f7678e-e7a8-47ee-b0dd-9941911266d6", // ИП Николаевский 10.09
    items: [
      { name: "Мешки 55×95 см полипропиленовые", qty: 2, unit: "шт", amount: 228.0, category: "материалы" },
      { name: "Подрозетник STEKKER EBX20-01-1", qty: 30, unit: "шт", amount: 480.0, category: "материалы" },
      { name: "Кабель ВВГПнг(А)-LS 3×2,5 (уп. 100 м)", qty: 25, unit: "м", amount: 3225.0, category: "материалы" },
      { name: "Кабель ВВГПнг(А)-LS 3×1,5 (уп. 100 м)", qty: 30, unit: "м", amount: 2820.0, category: "материалы" },
      { name: "Пакет «майка»", qty: 1, unit: "шт", amount: 14.0, category: "материалы" },
    ],
  },
  {
    id: "83b854f2-cc0d-4fd4-b06d-7ba1dc64b853", // Электрик 12.09
    items: [
      { name: "Кабель ВВГ-ПНГ(А)-LS 3×1,5 ГОСТ", qty: 15, unit: "м", amount: 2085.0, category: "материалы" },
      { name: "Кабель ВВГ-ПНГ(А)-LS 3×2,5 ГОСТ", qty: 25, unit: "м", amount: 5447.5, category: "материалы" },
      { name: "Пакет «майка»", qty: 1, unit: "шт", amount: 6.0, category: "материалы" },
      { name: "Дюбель-хомут ДХП 12-6 (уп. 100 шт)", qty: 1, unit: "уп", amount: 129.0, category: "материалы" },
    ],
  },
  {
    id: "f8247c3a-aff4-4fec-bf44-4441f5463a68", // ЭлектрикПрофи 12.09
    items: [
      { name: "Дюбель-хомут нейлон ДХП 10-5 белый (100 шт)", qty: 1, unit: "уп", amount: 175.0, category: "материалы" },
    ],
  },
];

const upd = db.prepare(
  "UPDATE expense_documents SET line_items = ? WHERE id = ?",
);

let n = 0;
for (const d of data) {
  const r = upd.run(JSON.stringify(d.items), d.id);
  n += r.changes;
}
db.close();
console.log("backfilled line_items for", n, "documents");
