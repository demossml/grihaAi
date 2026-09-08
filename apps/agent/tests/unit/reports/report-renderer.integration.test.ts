import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderPdfReport } from "../../../src/utils/reports/report-renderer.js";

/**
 * Integration test with the real @json-render/react-pdf pipeline.
 * Pure Node rendering (@react-pdf/renderer), no headless browser — safe to run
 * in plain CI, unlike the old Playwright test.
 */
describe("report pdf integration (real @json-render/react-pdf)", () => {
  it("renders a real PDF file from the fixed spec", async () => {
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

      assert.ok(existsSync(outputPath));
      const bytes = readFileSync(outputPath);
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "output must be a PDF");
      assert.ok(bytes.length > 500, "PDF should not be empty");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
