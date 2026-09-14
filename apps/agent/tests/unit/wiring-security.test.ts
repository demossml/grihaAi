import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRuntimeRisk,
  inferActionKind,
} from "../../.pi/extensions/approval-gate/runtime-risk.js";

/**
 * W8 (матрица K2) — runtime risk-классификация в approval-gate.
 * Flag off → runtime неактивен (старый finance-гейт решает всё).
 * Flag on → только ДОБАВЛЯЕТ требование одобрения, никогда не снимает.
 */

const ON = { GRIHA_AGENT_RUNTIME: "1" };
const OFF = {};

describe("inferActionKind: маппинг действия → ActionKind", () => {
  it("финансовые действия → financial", () => {
    assert.equal(inferActionKind("transfer 100 USD to savings"), "financial");
    assert.equal(inferActionKind("оплатить счёт клиента"), "financial");
  });

  it("системные изменения → system_modification", () => {
    assert.equal(inferActionKind("install system service"), "system_modification");
    assert.equal(inferActionKind("перезагрузить сервер"), "system_modification");
  });

  it("удаление → delete_file", () => {
    assert.equal(inferActionKind("delete old reports"), "delete_file");
    assert.equal(inferActionKind("удалить файл"), "delete_file");
  });

  it("отправка сообщений → send_message", () => {
    assert.equal(inferActionKind("send message to user"), "send_message");
    assert.equal(inferActionKind("отправить уведомление"), "send_message");
  });

  it("запись файлов → write_file", () => {
    assert.equal(inferActionKind("write file report.md"), "write_file");
    assert.equal(inferActionKind("создать файл"), "write_file");
  });

  it("чтение/списки → read_file (safe)", () => {
    assert.equal(inferActionKind("read file config.json"), "read_file");
    assert.equal(inferActionKind("list files"), "read_file");
  });

  it("неизвестные действия → null (решает старый гейт)", () => {
    assert.equal(inferActionKind("look at the weather"), null);
    assert.equal(inferActionKind(""), null);
  });
});

describe("evaluateRuntimeRisk (W8/K2)", () => {
  it("flag off: runtime неактивен для любого действия", () => {
    const v = evaluateRuntimeRisk("transfer money", OFF);
    assert.equal(v.active, false);
    assert.equal(v.required, false);
    assert.equal(v.risk, undefined);
  });

  it("flag on: финансовое действие требует одобрения (high, alwaysRequire)", () => {
    const v = evaluateRuntimeRisk("transfer 500 USD", ON);
    assert.equal(v.active, true);
    assert.equal(v.required, true);
    assert.equal(v.risk?.level, "high");
    assert.equal(v.risk?.action, "financial");
  });

  it("flag on: удаление требует одобрения (high)", () => {
    const v = evaluateRuntimeRisk("delete client database", ON);
    assert.equal(v.required, true);
    assert.equal(v.risk?.action, "delete_file");
  });

  it("flag on: отправка сообщения требует одобрения (medium ≥ threshold)", () => {
    const v = evaluateRuntimeRisk("send message to chat", ON);
    assert.equal(v.required, true);
    assert.equal(v.risk?.level, "medium");
  });

  it("flag on: чтение не требует одобрения (alwaysAllow)", () => {
    const v = evaluateRuntimeRisk("read file report.md", ON);
    assert.equal(v.required, false);
    assert.equal(v.risk?.level, "safe");
  });

  it("flag on: запись в память — low, ниже порога medium", () => {
    const v = evaluateRuntimeRisk("remember client phone", ON);
    assert.equal(v.required, false);
    assert.equal(v.risk?.level, "low");
  });

  it("flag on: неизвестное действие — runtime без мнения (required=false)", () => {
    const v = evaluateRuntimeRisk("check weather forecast", ON);
    assert.equal(v.active, true);
    assert.equal(v.required, false);
    assert.equal(v.risk, undefined);
  });
});
