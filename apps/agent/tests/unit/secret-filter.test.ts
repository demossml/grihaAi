import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSecret } from "../../src/utils/secret-filter.js";

describe("secret filter", () => {
  it("detects API keys", () => {
    assert.equal(detectSecret("api_key: sk-abcdefghijklmnopqrstuvwxyz123456")?.kind, "api key");
  });

  it("detects passwords", () => {
    assert.equal(detectSecret("password = hunter2secret")?.kind, "password");
  });

  it("detects Telegram bot tokens", () => {
    assert.equal(
      detectSecret("токен бота: 123456789:AAHq-abcdefghijklmnopqrstuvwxyz_1234")?.kind,
      "telegram bot token",
    );
  });

  it("detects payment card numbers", () => {
    assert.equal(detectSecret("карта 4111 1111 1111 1111")?.kind, "payment card");
  });

  it("detects private keys", () => {
    assert.equal(
      detectSecret("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")?.kind,
      "private key",
    );
  });

  it("allows ordinary content", () => {
    assert.equal(detectSecret("Предпочитаю короткие ответы и по утрам"), null);
    assert.equal(detectSecret("Встреча в 15:00 с Иваном"), null);
    assert.equal(detectSecret(""), null);
  });
});
