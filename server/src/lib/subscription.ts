import { PERIOD_LENGTH_MS, PERIOD_QUOTA_MS } from "../db/schema.ts";

export interface PeriodWindow {
  startMs: number;
  endMs: number;
  status: "active" | "queued" | "expired" | "cancelled";
}

export interface PlannedPeriod {
  startAt: Date;
  endAt: Date;
  status: "active" | "queued";
  quotaMs: number;
  usedMs: number;
}

export function planSubscriptionPeriod(existing: PeriodWindow[], paidAtMs: number): PlannedPeriod {
  let anchorMs = paidAtMs;
  for (const period of existing) {
    if (period.status !== "active" && period.status !== "queued") {
      continue;
    }
    if (period.endMs > anchorMs) {
      anchorMs = period.endMs;
    }
  }
  const status = anchorMs > paidAtMs ? "queued" : "active";
  return {
    startAt: new Date(anchorMs),
    endAt: new Date(anchorMs + PERIOD_LENGTH_MS),
    status,
    quotaMs: PERIOD_QUOTA_MS,
    usedMs: 0
  };
}

export function isEarlyRenewal(existing: PeriodWindow[], paidAtMs: number): boolean {
  return planSubscriptionPeriod(existing, paidAtMs).status === "queued";
}
