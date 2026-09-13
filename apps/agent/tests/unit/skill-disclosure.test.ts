/**
 * Item 6.1 (F1): progressive disclosure 0/1/2.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  discloseSkill,
  type SkillDescriptor,
} from "../../src/runtime/skill/disclosure.js";

const skill: SkillDescriptor = {
  name: "calendar",
  description: "Планирование встреч",
  parameters: ["date", "time", "title"],
  body: "Инструкции: 1) спросить дату; 2) создать событие.",
};

describe("Skill disclosure (Item 6.1)", () => {
  it("level 0: имя + описание, без параметров и тела", () => {
    const out = discloseSkill(skill, 0);
    assert.match(out, /calendar: Планирование встреч/);
    assert.ok(!out.includes("date"));
    assert.ok(!out.includes("Инструкции"));
  });

  it("level 1: + параметры, без тела", () => {
    const out = discloseSkill(skill, 1);
    assert.match(out, /date, time, title/);
    assert.ok(!out.includes("Инструкции"));
  });

  it("level 2: полное тело", () => {
    const out = discloseSkill(skill, 2);
    assert.match(out, /Инструкции: 1\) спросить дату/);
    assert.match(out, /date, time, title/);
  });

  it("skill без параметров не ломает уровень 1/2", () => {
    const bare: SkillDescriptor = { ...skill, parameters: [] };
    const out = discloseSkill(bare, 1);
    assert.ok(!out.includes("Параметры: "));
  });

  it("неверный уровень → ошибка", () => {
    assert.throws(() => discloseSkill(skill, 3 as never), /unknown disclosure level/);
  });
});
