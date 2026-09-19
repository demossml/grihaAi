import type { RenderRequest } from "@griha/render-contracts";
import { renderPdfBuffer } from "../pdf.js";
import { buildMeetingMinutesSpec, type MeetingMinutesPayload } from "./spec.js";

export async function renderMeetingMinutes(
  request: RenderRequest,
): Promise<{ buffer: Buffer; warnings: string[]; pages?: number }> {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const payload: MeetingMinutesPayload = {
    title: typeof data.title === "string" ? data.title : request.title,
    date: typeof data.date === "string" ? data.date : "",
    attendees: Array.isArray(data.attendees) ? (data.attendees as string[]) : [],
    agenda: Array.isArray(data.agenda) ? (data.agenda as string[]) : [],
    decisions: Array.isArray(data.decisions)
      ? (data.decisions as MeetingMinutesPayload["decisions"])
      : [],
  };
  const buffer = await renderPdfBuffer(buildMeetingMinutesSpec(payload));
  return { buffer, warnings: [] };
}
