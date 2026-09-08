import { getCapabilityStatus } from "../utils/capabilities.js";

/**
 * Provider contracts for future external systems. Real APIs are NOT connected
 * on this phase; every provider below is a NoopProvider that reports the
 * capability as unavailable. Skills must check capability first and never
 * claim a provider succeeded.
 */

export interface ProviderResult {
  ok: boolean;
  error?: string;
}

export interface CalendarProvider {
  readEvents(userId: string): Promise<ProviderResult & { events?: unknown[] }>;
  writeEvent(userId: string, event: unknown): Promise<ProviderResult>;
}

export interface EmailProvider {
  draft(userId: string, draft: { to: string; subject: string; body: string }): Promise<ProviderResult>;
  send(userId: string, message: { to: string; subject: string; body: string }): Promise<ProviderResult>;
}

export interface CRMProvider {
  readContact(userId: string, id: string): Promise<ProviderResult>;
  writeContact(userId: string, contact: unknown): Promise<ProviderResult>;
}

export interface TravelProvider {
  readItinerary(userId: string, tripId: string): Promise<ProviderResult>;
  book(userId: string, request: unknown): Promise<ProviderResult>;
}

export interface AccountingProvider {
  readLedger(userId: string): Promise<ProviderResult>;
  writeEntry(userId: string, entry: unknown): Promise<ProviderResult>;
}

const unavailable = (cap: string): ProviderResult => ({
  ok: false,
  error: `${cap}: ${getCapabilityStatus(cap as never)} — connector не подключён.`,
});

/** Noop providers — honest "not connected" behaviour, never fake success. */
export const noopCalendarProvider: CalendarProvider = {
  readEvents: async () => unavailable("calendar.read"),
  writeEvent: async () => unavailable("calendar.write"),
};

export const noopEmailProvider: EmailProvider = {
  draft: async () => ({ ok: true }), // Local drafting is always possible.
  send: async () => unavailable("email.send"),
};

export const noopCrmProvider: CRMProvider = {
  readContact: async () => unavailable("crm.read"),
  writeContact: async () => unavailable("crm.write"),
};

export const noopTravelProvider: TravelProvider = {
  readItinerary: async () => unavailable("travel.read"),
  book: async () => unavailable("travel.book"),
};

export const noopAccountingProvider: AccountingProvider = {
  readLedger: async () => unavailable("accounting.read"),
  writeEntry: async () => unavailable("accounting.write"),
};

export interface Providers {
  calendar: CalendarProvider;
  email: EmailProvider;
  crm: CRMProvider;
  travel: TravelProvider;
  accounting: AccountingProvider;
}

/** The provider set currently wired (all noop until connectors land). */
export function getProviders(): Providers {
  return {
    calendar: noopCalendarProvider,
    email: noopEmailProvider,
    crm: noopCrmProvider,
    travel: noopTravelProvider,
    accounting: noopAccountingProvider,
  };
}
