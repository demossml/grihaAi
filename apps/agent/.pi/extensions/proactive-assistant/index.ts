import path from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";
import {
  AnomalyAckSchema,
  BriefingGenerateSchema,
  ContactBriefingSchema,
  EventAddSchema,
  EventCancelSchema,
  EventListSchema,
  MeetingPrepSchema,
  type AnomalyAckParams,
  type BriefingGenerateParams,
  type CalendarEvent,
  type ContactBriefingParams,
  type EventAddParams,
  type EventCancelParams,
  type EventListParams,
  type MeetingPrepParams,
} from "../../../src/types/index.js";
import { buildBriefing, localDayKey } from "../../../src/utils/briefing/briefing.js";
import { detectCommitmentOverdue } from "../../../src/utils/finance/anomaly-detect.js";
import { CalendarService } from "./CalendarService.js";
import { AnomalyService } from "./AnomalyService.js";
import { BriefingService } from "./BriefingService.js";
import { CommitmentService } from "../commitment-tracking/CommitmentService.js";
import { ApprovalService } from "../approval-gate/ApprovalService.js";
import { ClientNotesService } from "../sqlite-rag-memory/ClientNotesService.js";
import { getSessionContext } from "../user-rules/context.js";
import { ContextBuilder } from "../../../src/context/ContextBuilder.js";

const CALENDAR_DB = path.join(getConfigDir(), "calendar.sqlite");
const ANOMALIES_DB = path.join(getConfigDir(), "anomalies.sqlite");
const BRIEFING_DB = path.join(getConfigDir(), "briefings.sqlite");
const COMMITMENTS_DB = path.join(getConfigDir(), "commitments.sqlite");
const APPROVALS_DB = path.join(getConfigDir(), "approvals.sqlite");
const MEMORY_DB = path.join(homedir(), ".grish-ai", "memory.sqlite");

let calendar: CalendarService | null = null;
let anomalies: AnomalyService | null = null;
let briefings: BriefingService | null = null;
let commitments: CommitmentService | null = null;
let approvals: ApprovalService | null = null;
let clientNotes: ClientNotesService | null = null;

function getCalendar(): CalendarService {
  if (!calendar) {
    calendar = new CalendarService(CALENDAR_DB);
    calendar.init();
  }
  return calendar;
}

function getAnomalies(): AnomalyService {
  if (!anomalies) {
    anomalies = new AnomalyService(ANOMALIES_DB);
    anomalies.init();
  }
  return anomalies;
}

function getBriefings(): BriefingService {
  if (!briefings) {
    briefings = new BriefingService(BRIEFING_DB);
    briefings.init();
  }
  return briefings;
}

function getCommitments(): CommitmentService {
  if (!commitments) {
    commitments = new CommitmentService(COMMITMENTS_DB);
    commitments.init();
  }
  return commitments;
}

function getApprovals(): ApprovalService {
  if (!approvals) {
    approvals = new ApprovalService(APPROVALS_DB);
    approvals.init();
  }
  return approvals;
}

async function getClientNotes(): Promise<ClientNotesService> {
  if (!clientNotes) {
    clientNotes = new ClientNotesService(MEMORY_DB);
    await clientNotes.init();
  }
  return clientNotes;
}

function resolveUserId(ctx: ExtensionContext): string {
  return getSessionContext(ctx.sessionManager.getSessionId())?.userId ?? "owner";
}

/** Single ContextBuilder wired to the domain services (skills do not scan memory themselves). */
function getContextBuilder(): ContextBuilder {
  return new ContextBuilder({
    getEvents: (userId) => getCalendar().list(userId),
    getCommitments: (userId) => getCommitments().list(userId, { limit: 100 }),
    getAnomalies: (userId) => getAnomalies().list(userId),
    getApprovals: (userId) => getApprovals().listPending(userId),
    getClientNotes: async (userId, query) =>
      query ? await (await getClientNotes()).searchNotes(userId, query) : await (await getClientNotes()).listNotes(userId),
    getContacts: () => [],
    getExpenses: () => [],
    getInvoices: () => [],
  });
}

function closeAll(): void {
  for (const s of [calendar, anomalies, briefings, commitments, approvals, clientNotes]) {
    if (s) void s.close();
  }
  calendar = anomalies = briefings = commitments = approvals = clientNotes = null;
}

function formatEvent(e: CalendarEvent): string {
  const tz = e.timezone;
  const day = localDayKey(new Date(e.startsAt), tz);
  return `- ${day} ${e.startsAt.slice(11, 16)} ${e.title} [${e.kind}]`;
}

export default function proactiveAssistant(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    getCalendar();
    getAnomalies();
    getBriefings();
    getCommitments();
    getApprovals();
    void getClientNotes();
  });

  pi.on("session_shutdown", () => {
    closeAll();
  });

  pi.registerTool({
    name: "event_add",
    label: "Add calendar event",
    description:
      "Добавить событие во внутренний календарь (connector-ready: внешний календарь не изменяется).",
    parameters: EventAddSchema,
    async execute(
      _toolCallId: string,
      params: EventAddParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ event: CalendarEvent }>> {
      const event = getCalendar().add({ userId: resolveUserId(ctx), ...params });
      return {
        content: [{ type: "text", text: `Event "${event.title}" added (${event.id}).` }],
        details: { event },
      };
    },
  });

  pi.registerTool({
    name: "event_list",
    label: "List calendar events",
    description: "Показать события внутреннего календаря.",
    parameters: EventListSchema,
    async execute(
      _toolCallId: string,
      params: EventListParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ events: CalendarEvent[] }>> {
      const events = getCalendar().list(resolveUserId(ctx), {
        from: params.from,
        to: params.to,
        kind: params.kind,
      });
      const text = events.length === 0 ? "Событий нет." : events.map(formatEvent).join("\n");
      return { content: [{ type: "text", text }], details: { events } };
    },
  });

  pi.registerTool({
    name: "event_cancel",
    label: "Cancel calendar event",
    description: "Отменить событие внутреннего календаря.",
    parameters: EventCancelSchema,
    async execute(
      _toolCallId: string,
      params: EventCancelParams,
    ): Promise<AgentToolResult<{ updated: boolean }>> {
      const updated = Boolean(getCalendar().cancel(params.id));
      return {
        content: [{ type: "text", text: updated ? "Event cancelled." : "Event not found." }],
        details: { updated },
      };
    },
  });

  pi.registerTool({
    name: "briefing_generate",
    label: "Generate daily briefing",
    description:
      "Собрать утренний брифинг: события, встречи, просроченные обязательства, follow-ups, аномалии, ожидающие подтверждения, заметки о клиентах. Пустые секции опускаются; один брифинг в день.",
    parameters: BriefingGenerateSchema,
    async execute(
      _toolCallId: string,
      params: BriefingGenerateParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ text: string; alreadySent?: boolean }>> {
      const userId = resolveUserId(ctx);
      const timezone = params.timezone ?? "UTC";
      const now = new Date();
      const dayKey = localDayKey(now, timezone);

      const existing = params.force ? undefined : getBriefings().getRun(userId, dayKey);
      if (existing) {
        return {
          content: [{ type: "text", text: existing.text }],
          details: { text: existing.text, alreadySent: true },
        };
      }

      const cs = getCommitments();
      cs.refreshStatuses();
      const allCommitments = cs.list(userId, { limit: 100 });
      // Surface overdue commitments as anomalies (idempotent — duplicates skipped).
      getAnomalies().record(detectCommitmentOverdue(allCommitments));

      const { text } = buildBriefing({
        events: getCalendar().list(userId),
        commitments: allCommitments,
        anomalies: getAnomalies().list(userId, { status: "new" }),
        approvals: getApprovals().listPending(userId),
        clientNotes: await (await getClientNotes()).listNotes(userId),
        now,
        timezone,
      });

      getBriefings().recordRun(userId, dayKey, text, Boolean(params.force));
      return { content: [{ type: "text", text }], details: { text, alreadySent: false } };
    },
  });

  pi.registerTool({
    name: "anomaly_list",
    label: "List anomalies",
    description: "Список зафиксированных аномалий.",
    parameters: Type.Object({}),
    async execute(
      _toolCallId: string,
      _params: Record<string, unknown>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ anomalies: unknown[] }>> {
      const list = getAnomalies().list(resolveUserId(ctx));
      const text =
        list.length === 0
          ? "Аномалий нет."
          : list.map((a) => `- [${a.status}] [${a.severity}] ${a.explanation}`).join("\n");
      return { content: [{ type: "text", text }], details: { anomalies: list } };
    },
  });

  pi.registerTool({
    name: "anomaly_ack",
    label: "Acknowledge anomaly",
    description: "Отметить аномалию как acknowledged или resolved.",
    parameters: AnomalyAckSchema,
    async execute(
      _toolCallId: string,
      params: AnomalyAckParams,
    ): Promise<AgentToolResult<{ updated: boolean }>> {
      const updated = getAnomalies().setStatus(params.id, params.status);
      return {
        content: [{ type: "text", text: updated ? `Anomaly ${params.status}.` : "Anomaly not found." }],
        details: { updated },
      };
    },
  });

  pi.registerTool({
    name: "meeting_prep",
    label: "Prepare meeting context",
    description:
      "Собрать контекст перед встречей: само событие, связанные обязательства и заметки о клиентах. Не выдумывает участников/время.",
    parameters: MeetingPrepSchema,
    async execute(
      _toolCallId: string,
      params: MeetingPrepParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ context: string }>> {
      const userId = resolveUserId(ctx);
      const { text: context } = await getContextBuilder().getMeetingContext(userId, params.eventId);
      return { content: [{ type: "text", text: context }], details: { context } };
    },
  });

  pi.registerTool({
    name: "contact_briefing",
    label: "Contact context briefing",
    description:
      "Собрать контекст по известному контакту: заметки и связанные обязательства. Для критичных действий подтверди личность контакта.",
    parameters: ContactBriefingSchema,
    async execute(
      _toolCallId: string,
      params: ContactBriefingParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ context: string }>> {
      const userId = resolveUserId(ctx);
      const { text: context } = await getContextBuilder().getContactContext(userId, params.contactName);
      return { content: [{ type: "text", text: context }], details: { context } };
    },
  });
}
