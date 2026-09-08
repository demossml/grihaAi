import path from "node:path";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";
import {
  ContactUpsertSchema,
  type ContactUpsertParams,
} from "../../../src/types/index.js";
import { ContactService } from "./ContactService.js";
import { getSessionContext } from "../user-rules/context.js";

const CRM_DB = path.join(getConfigDir(), "contacts.sqlite");

let contacts: ContactService | null = null;

function getContacts(): ContactService {
  if (!contacts) {
    contacts = new ContactService(CRM_DB);
    contacts.init();
  }
  return contacts;
}

function resolveUserId(ctx: ExtensionContext): string {
  return getSessionContext(ctx.sessionManager.getSessionId())?.userId ?? "owner";
}

export default function crmExtension(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    getContacts();
  });

  pi.on("session_shutdown", () => {
    if (contacts) {
      contacts.close();
      contacts = null;
    }
  });

  pi.registerTool({
    name: "contact_upsert",
    label: "Upsert contact",
    description: "Создать/обновить контакт (имя, теги). Заметки о клиенте хранятся отдельно (client notes).",
    parameters: ContactUpsertSchema,
    async execute(
      _toolCallId: string,
      params: ContactUpsertParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string }>> {
      const contact = getContacts().upsert(resolveUserId(ctx), params.name, params.tags);
      return {
        content: [{ type: "text", text: `Contact ${contact.name} saved (${contact.id}).` }],
        details: { id: contact.id },
      };
    },
  });

  pi.registerTool({
    name: "contact_list",
    label: "List contacts",
    description: "Список контактов с тегами и последним взаимодействием.",
    parameters: Type.Object({}),
    async execute(
      _toolCallId: string,
      _params: Record<string, unknown>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ contacts: unknown[] }>> {
      const list = getContacts().list(resolveUserId(ctx));
      const text =
        list.length === 0
          ? "Контактов нет."
          : list
              .map((c) => `- ${c.name}${c.tags.length ? ` [${c.tags.join(", ")}]` : ""}${c.lastInteractionAt ? ` (последнее: ${c.lastInteractionAt.slice(0, 10)})` : ""}`)
              .join("\n");
      return { content: [{ type: "text", text }], details: { contacts: list } };
    },
  });

  pi.registerTool({
    name: "contact_touch",
    label: "Record contact interaction",
    description: "Отметить взаимодействие с контактом (обновить last interaction).",
    parameters: Type.Object({ name: Type.String({ minLength: 1 }) }),
    async execute(
      _toolCallId: string,
      params: { name: string },
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ updated: boolean }>> {
      const list = getContacts().list(resolveUserId(ctx));
      const target = list.find((c) => c.name.toLowerCase() === params.name.toLowerCase());
      if (!target) {
        return { content: [{ type: "text", text: "Contact not found." }], details: { updated: false } };
      }
      getContacts().touch(target.id);
      return { content: [{ type: "text", text: "Interaction recorded." }], details: { updated: true } };
    },
  });
}
