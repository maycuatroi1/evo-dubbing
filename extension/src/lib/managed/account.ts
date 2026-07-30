import { managedAuthedFetch } from "./client.ts";
import type { RuntimeResponse } from "./protocol.ts";

export interface ManagedAccountPeriod {
  id: string;
  startAt: string;
  endAt: string;
  quotaMs: number;
  usedMs: number;
  remainingMs: number;
  status: "active" | "queued";
}

export type ManagedRenewal =
  | { status: "not_subscribed" }
  | { status: "manual_renewal"; currentPeriodEndAt: string }
  | { status: "renewal_scheduled"; nextPeriodStartAt: string };

export interface ManagedAccount {
  userId: string;
  trial: { quotaMs: number; usedMs: number; remainingMs: number; exhausted: boolean };
  periods: ManagedAccountPeriod[];
  remainingSourceMs: number;
  renewal: ManagedRenewal;
  flags: { managedInference: boolean; managedTrial: boolean; managedCheckout: boolean };
}

export interface ManagedCheckoutResult {
  checkoutUrl: string;
  orderCode: number;
  amountMinor: number;
  currency: string;
  expiresAt: string;
}

export const MANAGED_PLAN_ID = "vi_monthly_300";

export function fetchManagedAccount(baseUrl: string): Promise<RuntimeResponse> {
  return managedAuthedFetch(baseUrl, "/api/v1/account", { method: "GET" });
}

export function createManagedCheckout(baseUrl: string, planId: string = MANAGED_PLAN_ID): Promise<RuntimeResponse> {
  return managedAuthedFetch(baseUrl, "/api/v1/billing/checkout", { method: "POST", body: { planId } });
}
