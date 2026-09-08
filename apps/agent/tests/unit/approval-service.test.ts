import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApprovalService } from "../../.pi/extensions/approval-gate/ApprovalService.js";
import { getTestDbPath, cleanTestDb } from "../setup.js";

const DB_NAME = "approval-service-test.sqlite";

function freshService(): ApprovalService {
  cleanTestDb(DB_NAME);
  const svc = new ApprovalService(getTestDbPath(DB_NAME));
  svc.init();
  return svc;
}

describe("approval service", () => {
  it("stores and retrieves policies (chat overrides global)", () => {
    const svc = freshService();
    svc.setPolicy({
      userId: "u1",
      scope: "global",
      financial: { currency: "RUB", autoApproveBelow: 100 },
    });
    svc.setPolicy({
      userId: "u1",
      scope: "chat",
      chatId: "42",
      financial: { currency: "RUB", autoApproveBelow: 500 },
    });

    assert.equal(svc.getPolicy("u1")?.autoApproveBelow, 100);
    assert.equal(svc.getPolicy("u1", "42")?.autoApproveBelow, 500);
    assert.equal(svc.getPolicy("u1", "other")?.autoApproveBelow, 100);
  });

  it("policies are scoped to user", () => {
    const svc = freshService();
    svc.setPolicy({ userId: "u1", scope: "global", financial: { currency: "RUB" } });
    assert.equal(svc.getPolicy("u2"), undefined);
  });

  it("creates, grants and lists pending requests", () => {
    const svc = freshService();
    const req = svc.createRequest({
      userId: "u1",
      sessionId: "s1",
      action: "email.send",
      actionClass: "HIGH_RISK_IRREVERSIBLE",
      target: "ivan@example.com",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });

    assert.equal(svc.get(req.id)?.status, "pending");
    assert.equal(svc.listPending("u1").length, 1);
    assert.equal(svc.listPending("u2").length, 0);

    assert.equal(svc.grant(req.id), true);
    assert.equal(svc.get(req.id)?.status, "granted");
    // Already resolved → cannot grant twice.
    assert.equal(svc.grant(req.id), false);
  });

  it("denies and expires requests", () => {
    const svc = freshService();
    const req = svc.createRequest({
      userId: "u1",
      sessionId: "s1",
      action: "book_flight",
      actionClass: "HIGH_RISK_IRREVERSIBLE",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const pending = svc.createRequest({
      userId: "u1",
      sessionId: "s1",
      action: "invoice.pay",
      actionClass: "HIGH_RISK_IRREVERSIBLE",
    });

    svc.expireOverdue();
    assert.equal(svc.get(req.id)?.status, "expired");
    assert.equal(svc.get(pending.id)?.status, "pending");
  });
});
