import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderPdfReport } from "../../src/utils/report-renderer.js";

/**
 * Integration test with real Playwright headless Chromium.
 * Skipped unless `RUN_REPORT_INTEGRATION=1` AND a Chromium binary is installed
 * (`npx playwright install chromium`). Never runs in plain CI.
 */
const RUN = process.env.RUN_REPORT_INTEGRATION === "1";

let browserAvailable = false;
if (RUN) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    browserAvailable = true;
  } catch {
    browserAvailable = false;
  }
}

describe("report pdf integration (real Playwright)", { skip: !RUN || !browserAvailable }, () => {
  it("renders a real PDF file from the fixed template", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "report-int-"));
    try {
      const outputPath = await renderPdfReport(
        "sales-report",
        {
          period: "Q1 2026",
          totalRevenue: 150000,
          categories: [{ name: "Консалтинг", revenue: 150000 }],
          topDeals: [{ title: "Корпорация А", amount: 150000 }],
        },
        { outputDir: dir },
      );

      assert.ok(outputPath.endsWith(".pdf"));
      assert.ok(existsSync(outputPath), "PDF file should exist on disk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
