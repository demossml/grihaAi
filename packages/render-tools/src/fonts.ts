import { existsSync } from "node:fs";

/**
 * Регистрация шрифта с кириллицей вместо стандартных Helvetica-семейств.
 * Перенесено 1:1 из apps/agent/src/utils/reports/report-renderer.ts
 * (apps/agent НЕ изменяется — это копия в render-tools).
 */

/** Font registry subset used by ensureReportFonts (FontStore.clear/register). */
interface FontRegistryLike {
  clear(): void;
  register(data: {
    family: string;
    fonts: Array<{ src: string; fontStyle?: "normal" | "italic" | "oblique"; fontWeight?: number }>;
  }): void;
}

/** System TTF candidates with Cyrillic coverage (regular + bold). */
const CYRILLIC_FONT_CANDIDATES: ReadonlyArray<{ regular: string; bold: string }> = [
  { regular: "/System/Library/Fonts/Supplemental/Arial.ttf", bold: "/System/Library/Fonts/Supplemental/Arial Bold.ttf" },
  { regular: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", bold: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" },
  { regular: "/usr/share/fonts/dejavu/DejaVuSans.ttf", bold: "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf" },
  { regular: "C:\\Windows\\Fonts\\arial.ttf", bold: "C:\\Windows\\Fonts\\arialbd.ttf" },
];

export function resolveCyrillicFontPaths(): { regular: string; bold: string } {
  const envRegular = process.env.GRIHA_PDF_FONT_PATH;
  if (envRegular) {
    if (!existsSync(envRegular)) {
      throw new Error(
        `GRIHA_PDF_FONT_PATH указывает на несуществующий файл: ${envRegular}. ` +
          "Уберите переменную или укажите существующий TTF с поддержкой кириллицы.",
      );
    }
    const envBold = process.env.GRIHA_PDF_FONT_BOLD_PATH;
    const bold = envBold && existsSync(envBold) ? envBold : envRegular;
    return { regular: envRegular, bold };
  }

  for (const candidate of CYRILLIC_FONT_CANDIDATES) {
    if (existsSync(candidate.regular)) {
      return { regular: candidate.regular, bold: existsSync(candidate.bold) ? candidate.bold : candidate.regular };
    }
  }

  throw new Error(
    "Не найден шрифт с поддержкой кириллицы для PDF-отчётов. " +
      "Установите Arial (Windows/macOS) или DejaVu Sans (Linux) либо задайте GRIHA_PDF_FONT_PATH с путём к TTF.",
  );
}

let reportFontsReady = false;

function ensureReportFonts(font: FontRegistryLike): void {
  if (reportFontsReady) return;
  const { regular, bold } = resolveCyrillicFontPaths();
  font.clear();
  font.register({
    family: "Helvetica",
    fonts: [
      { src: regular, fontStyle: "normal", fontWeight: 400 },
      { src: bold, fontStyle: "normal", fontWeight: 700 },
      { src: regular, fontStyle: "italic", fontWeight: 400 },
      { src: bold, fontStyle: "italic", fontWeight: 700 },
    ],
  });
  font.register({ family: "Helvetica-Bold", fonts: [{ src: bold, fontStyle: "normal", fontWeight: 700 }] });
  font.register({ family: "Helvetica-Oblique", fonts: [{ src: regular, fontStyle: "italic", fontWeight: 400 }] });
  font.register({ family: "Helvetica-BoldOblique", fonts: [{ src: bold, fontStyle: "italic", fontWeight: 700 }] });
  reportFontsReady = true;
}

export { ensureReportFonts };
