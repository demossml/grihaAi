import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApprovalService } from "../../.pi/extensions/approval-gate/ApprovalService.js";

/**
 * Общая функция applyApprovalDecision — единственный путь grant/deny и для
 * текстовых команд /approve//deny, и для Telegram inline-кнопок
 * (callback_query "approve:<id>"/"deny:<id>"). Проверяем, что она реально
 * резолвит запрос в той же БД, которую используют оба пути.
 *
 * GRISH_AI_HOME задаётся ДО импорта approval-gate/index.js, потому что
 * DB_PATH вычисляется на уровне модуля.
 */
describe("applyApprovalDecision (shared approve/deny path)", () => {
  it("grant/deny via the shared function resolve requests in the approval DB", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-approval-decision-"));
    const previousHome = process.env.GRISH_AI_HOME;
    process.env.GRISH_AI_HOME = dir;
    // getConfigDir() = GRISH_AI_HOME/.grish-ai — создаём директорию заранее.
    const configDir = path.join(dir, ".grish-ai");
    fs.mkdirSync(configDir, { recursive: true });
    try {
      const { applyApprovalDecision } = await import(
        "../../.pi/extensions/approval-gate/index.js"
      );

      // Та же БД, которую использует applyApprovalDecision внутри.
      const svc = new ApprovalService(path.join(configDir, "approvals.sqlite"));
      svc.init();

      const approveReq = svc.createRequest({
        userId: "u1",
        sessionId: "s1",
        action: "email.send",
        actionClass: "HIGH_RISK_IRREVERSIBLE",
      });
      const denyReq = svc.createRequest({
        userId: "u1",
        sessionId: "s1",
        action: "payment.send",
        actionClass: "SIDE_EFFECT",
      });

      const approved = applyApprovalDecision("approve", approveReq.id);
      assert.equal(approved.ok, true);
      assert.equal(approved.message, "Одобрено.");
      assert.equal(svc.get(approveReq.id)?.status, "approved");

      const denied = applyApprovalDecision("deny", denyReq.id);
      assert.equal(denied.ok, true);
      assert.equal(denied.message, "Отклонено.");
      assert.equal(svc.get(denyReq.id)?.status, "rejected");

      // Неизвестный id — не падаем, отдаём понятное сообщение.
      const unknown = applyApprovalDecision("approve", "no-such-id");
      assert.equal(unknown.ok, false);
      assert.equal(unknown.message, "Запрос не найден или уже решён.");

      svc.close();
    } finally {
      if (previousHome === undefined) delete process.env.GRISH_AI_HOME;
      else process.env.GRISH_AI_HOME = previousHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
