import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FinanceService,
  deriveInvoiceStatus,
} from "../../.pi/extensions/finance/FinanceService.js";
import { getTestDbPath, cleanTestDb } from "../setup.js";

const DB_NAME = "finance-service-test.sqlite";

function freshService(): FinanceService {
  cleanTestDb(DB_NAME);
  const svc = new FinanceService(getTestDbPath(DB_NAME));
  svc.init();
  return svc;
}

describe("invoice status derivation", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("keeps terminal statuses", () => {
    assert.equal(deriveInvoiceStatus("paid", "2026-01-01", now), "paid");
    assert.equal(deriveInvoiceStatus("cancelled", undefined, now), "cancelled");
  });

  it("derives overdue from the due date", () => {
    assert.equal(deriveInvoiceStatus("sent", "2026-09-01", now), "overdue");
    assert.equal(deriveInvoiceStatus("sent", "2026-10-01", now), "sent");
    assert.equal(deriveInvoiceStatus("draft", "2026-09-01", now), "draft");
  });
});

describe("finance service", () => {
  it("stores expenses and builds vendor history", () => {
    const svc = freshService();
    svc.addExpense({
      userId: "u1",
      date: "2026-09-01",
      vendor: "Uber",
      amount: 500,
      currency: "RUB",
      category: "Transport",
    });
    assert.equal(svc.listExpenses("u1").length, 1);
    assert.deepEqual(svc.vendorHistory("u1"), [{ vendor: "Uber", category: "Transport" }]);
  });

  it("isolates expenses per user", () => {
    const svc = freshService();
    svc.addExpense({ userId: "u1", date: "2026-09-01", vendor: "A", amount: 1, currency: "RUB" });
    assert.equal(svc.listExpenses("u2").length, 0);
  });

  it("stores invoices and refreshes overdue statuses", () => {
    const svc = freshService();
    const inv = svc.addInvoice({
      userId: "u1",
      number: "INV-1",
      amount: 1000,
      currency: "RUB",
      dueDate: "2020-01-01",
    });
    assert.equal(inv.status, "draft");

    svc.setInvoiceStatus(inv.id, "sent");
    svc.refreshInvoiceStatuses(new Date("2026-09-08T12:00:00Z"));
    assert.equal(svc.getInvoice(inv.id)?.status, "overdue");
  });
});
