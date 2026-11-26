import type { Lead } from "@prisma/client";
import type { BrowserIds } from "@/lib/line-tracking/browserIds";

export interface SendResult {
  ok: boolean;
  mock: boolean;
  request: unknown;
  response: unknown;
  error?: string;
}

/**
 * What is known about the click a lead was matched to. A lead that came in without a
 * click (Direct) has none. Loaded by clickSignalService when the queue runs.
 */
export interface ClickSignals extends BrowserIds {
  /** When the click was recorded. */
  clickedAt?: Date;
  userAgent?: string;
  landingUrl?: string;
  referrer?: string;
}

export interface SendContext {
  lead: Lead;
  eventName: string;
  value: number;
  currency: string;
  projectId: string;
  projectName: string;
  /** Absent when the lead has no click, or when the click row is gone. */
  click?: ClickSignals;
}
