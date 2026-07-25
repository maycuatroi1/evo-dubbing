export const TRIAL_QUOTA_MS = 900_000;

export interface AccountPeriodInput {
  id: string;
  startAt: Date | string;
  endAt: Date | string;
  quotaMs: number;
  usedMs: number;
  status: string;
}

export interface ManagedFlags {
  inference: boolean;
  trial: boolean;
  checkout: boolean;
}

function flagOn(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function parseManagedFlags(env: Record<string, string | undefined>): ManagedFlags {
  return {
    inference: flagOn(env.MANAGED_INFERENCE_ENABLED),
    trial: flagOn(env.MANAGED_TRIAL_ENABLED),
    checkout: flagOn(env.MANAGED_CHECKOUT_ENABLED)
  };
}

export function managedFlags(): ManagedFlags {
  return parseManagedFlags(process.env);
}

export interface AccountPayloadInput {
  userId: string;
  periods: AccountPeriodInput[];
  trialUsedMs: number;
  flags: ManagedFlags;
  now: Date;
}

export interface AccountPeriodView {
  id: string;
  startAt: string;
  endAt: string;
  quotaMs: number;
  usedMs: number;
  remainingMs: number;
  status: "active" | "queued";
}

export type RenewalStatus =
  | { status: "not_subscribed" }
  | { status: "manual_renewal"; currentPeriodEndAt: string }
  | { status: "renewal_scheduled"; nextPeriodStartAt: string };

export interface AccountPayload {
  userId: string;
  trial: { quotaMs: number; usedMs: number; remainingMs: number; exhausted: boolean };
  periods: AccountPeriodView[];
  remainingSourceMs: number;
  renewal: RenewalStatus;
  flags: { managedInference: boolean; managedTrial: boolean; managedCheckout: boolean };
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function buildAccountPayload(input: AccountPayloadInput): AccountPayload {
  const nowMs = input.now.getTime();
  const trialUsedMs = Math.min(Math.max(0, Math.floor(input.trialUsedMs)), TRIAL_QUOTA_MS);
  const trial = {
    quotaMs: TRIAL_QUOTA_MS,
    usedMs: trialUsedMs,
    remainingMs: TRIAL_QUOTA_MS - trialUsedMs,
    exhausted: trialUsedMs >= TRIAL_QUOTA_MS
  };

  const periods: AccountPeriodView[] = input.periods
    .filter((p) => p.status === "active" || p.status === "queued")
    .map((p) => ({
      id: p.id,
      startAt: new Date(toTime(p.startAt)).toISOString(),
      endAt: new Date(toTime(p.endAt)).toISOString(),
      quotaMs: p.quotaMs,
      usedMs: p.usedMs,
      remainingMs: Math.max(0, p.quotaMs - p.usedMs),
      status: p.status as "active" | "queued"
    }))
    .sort((a, b) => toTime(a.startAt) - toTime(b.startAt));

  const active = periods.filter((p) => p.status === "active" && toTime(p.endAt) > nowMs);
  const queued = periods.filter((p) => p.status === "queued");

  const remainingSourceMs =
    trial.remainingMs + active.reduce((sum, p) => sum + p.remainingMs, 0);

  let renewal: RenewalStatus;
  if (queued.length > 0) {
    renewal = { status: "renewal_scheduled", nextPeriodStartAt: queued[0].startAt };
  } else if (active.length > 0) {
    const lastEnd = active.reduce((max, p) => Math.max(max, toTime(p.endAt)), 0);
    renewal = { status: "manual_renewal", currentPeriodEndAt: new Date(lastEnd).toISOString() };
  } else {
    renewal = { status: "not_subscribed" };
  }

  return {
    userId: input.userId,
    trial,
    periods,
    remainingSourceMs,
    renewal,
    flags: {
      managedInference: input.flags.inference,
      managedTrial: input.flags.trial,
      managedCheckout: input.flags.checkout
    }
  };
}
