import type { Miniflare } from "miniflare";
export function createBookingMechanism(options?: {
  respond?: (call: {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
  }) => Promise<Response | undefined>;
}): Promise<{
  mf: Miniflare;
  db: Awaited<ReturnType<Miniflare["getD1Database"]>>;
  origin: string;
  date: string;
  startMs: number;
  checkoutUrl: string;
  calls: {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
  }[];
  unexpected: string[];
  completePayment(): Promise<{ status: number }>;
  recover(): Promise<unknown>;
  close(): Promise<void>;
}>;
