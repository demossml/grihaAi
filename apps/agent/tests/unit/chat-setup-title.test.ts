/**
 * getChatTitleSync — чтение title группы из ChatSetupRecord.chatTitle (sync).
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UserRulesService } from "../../.pi/extensions/user-rules/UserRulesService.js";
import { ChatSetupService } from "../../.pi/extensions/chat-setup/ChatSetupService.js";

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeSetup(): ChatSetupService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-title-"));
  tmpDirs.push(dir);
  const rules = { replaceChatManagedRules() {} } as unknown as UserRulesService;
  return new ChatSetupService(path.join(dir, "chat-setup.json"), rules);
}

describe("getChatTitleSync", () => {
  it("возвращает title после save (markPending)", async () => {
    const setup = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "Ремонт", chatType: "group", addedByUserId: "42" });
    assert.equal(setup.getChatTitleSync("-100"), "Ремонт");
  });

  it("undefined если записи нет", () => {
    const setup = makeSetup();
    assert.equal(setup.getChatTitleSync("-999"), undefined);
  });

  it("undefined если title пустой/только пробелы", async () => {
    const setup = makeSetup();
    await setup.markPending({ chatId: "-100", chatTitle: "   ", chatType: "group", addedByUserId: "42" });
    assert.equal(setup.getChatTitleSync("-100"), undefined);
  });
});
