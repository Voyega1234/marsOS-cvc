import type { Lead } from "@prisma/client";

export interface SendResult {
  ok: boolean;
  mock: boolean;
  request: unknown;
  response: unknown;
  error?: string;
}

export interface SendContext {
  lead: Lead;
  eventName: string;
  value: number;
  currency: string;
  projectId: string;
  projectName: string;
}
