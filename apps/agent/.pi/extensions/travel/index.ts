import path from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getConfigDir } from "@griha/config";
import {
  TravelItemAddSchema,
  TravelListSchema,
  type TravelItemAddParams,
  type TravelListParams,
} from "../../../src/types/index.js";
import { TravelService } from "./TravelService.js";
import { getSessionContext } from "../user-rules/context.js";

const TRAVEL_DB = path.join(getConfigDir(), "travel.sqlite");

let travel: TravelService | null = null;

function getTravel(): TravelService {
  if (!travel) {
    travel = new TravelService(TRAVEL_DB);
    travel.init();
  }
  return travel;
}

function resolveUserId(ctx: ExtensionContext): string {
  return getSessionContext(ctx.sessionManager.getSessionId())?.userId ?? "owner";
}

export default function travelExtension(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    getTravel();
  });

  pi.on("session_shutdown", () => {
    if (travel) {
      travel.close();
      travel = null;
    }
  });

  pi.registerTool({
    name: "travel_item_add",
    label: "Add travel item",
    description:
      "Добавить элемент поездки (flight/hotel/transfer) из подтверждения/PDF/скриншота. Бронирование не выполняется.",
    parameters: TravelItemAddSchema,
    async execute(
      _toolCallId: string,
      params: TravelItemAddParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ id: string }>> {
      const item = getTravel().add({ userId: resolveUserId(ctx), ...params });
      return {
        content: [{ type: "text", text: `Travel item "${item.title}" added (${item.id}).` }],
        details: { id: item.id },
      };
    },
  });

  pi.registerTool({
    name: "travel_list",
    label: "List travel items",
    description: "Маршрут поездки: список элементов (по tripId) или upcoming в ближайшие N дней.",
    parameters: TravelListSchema,
    async execute(
      _toolCallId: string,
      params: TravelListParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ items: unknown[]; upcoming?: boolean }>> {
      const userId = resolveUserId(ctx);
      const items = params.days !== undefined
        ? getTravel().upcoming(userId, params.days)
        : getTravel().list(userId, params.tripId);
      const text =
        items.length === 0
          ? "Поездок нет."
          : items
              .map((i) => `- [${i.kind}] ${i.title} (${i.startsAt.slice(0, 16)} — ${i.endsAt.slice(0, 16)})${i.location ? ` ${i.location}` : ""}`)
              .join("\n");
      return { content: [{ type: "text", text }], details: { items, upcoming: params.days !== undefined } };
    },
  });

  pi.registerTool({
    name: "travel_itinerary",
    label: "Build travel itinerary",
    description: "Собрать единый маршрут поездки (trip → flight/hotel/transfer/reminders).",
    parameters: TravelListSchema,
    async execute(
      _toolCallId: string,
      params: TravelListParams,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<{ itinerary: string }>> {
      if (!params.tripId) {
        return {
          content: [{ type: "text", text: "Укажите tripId для маршрута." }],
          details: { itinerary: "" },
        };
      }
      const items = getTravel().list(resolveUserId(ctx), params.tripId);
      const lines = [`trip ${params.tripId}`];
      for (const i of items) {
        lines.push(` ├── ${i.kind}: ${i.title} (${i.startsAt.slice(0, 16)} — ${i.endsAt.slice(0, 16)})`);
      }
      lines.push(" └── reminders: проверять за день до вылета/заезда");
      const itinerary = lines.join("\n");
      return { content: [{ type: "text", text: itinerary }], details: { itinerary } };
    },
  });
}
