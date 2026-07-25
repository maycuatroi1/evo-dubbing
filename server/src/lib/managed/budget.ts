import { parseManagedFlags } from "../account.ts";
import { ManagedError } from "./catalog.ts";

export const DEFAULT_MONTHLY_BUDGET_USD = 100;
export const DEFAULT_TRIAL_BUDGET_USD = 10;
export const ALERT_THRESHOLD_FRACTION = 0.8;
export const MICROUSD_PER_USD = 1_000_000;

export interface BudgetConfig {
  enabled: boolean;
  monthlyBudgetMicrousd: number;
  trialBudgetMicrousd: number;
  alertFraction: number;
}

export type TrafficClass = "trial" | "paid";
export type BudgetDenial = "kill_switch" | "monthly_budget" | "trial_budget";

export interface BudgetSpend {
  totalMicrousd: number;
  trialMicrousd: number;
}

export interface BudgetDecision {
  allowed: boolean;
  denial?: BudgetDenial;
  alerts: string[];
}

function usdToMicrousd(value: string | undefined, fallbackUsd: number): number {
  const parsed = Number(value);
  const usd = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackUsd;
  return Math.round(usd * MICROUSD_PER_USD);
}

export function parseBudgetConfig(env: Record<string, string | undefined>): BudgetConfig {
  return {
    enabled: parseManagedFlags(env).inference,
    monthlyBudgetMicrousd: usdToMicrousd(env.MANAGED_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD),
    trialBudgetMicrousd: usdToMicrousd(env.MANAGED_TRIAL_BUDGET_USD, DEFAULT_TRIAL_BUDGET_USD),
    alertFraction: ALERT_THRESHOLD_FRACTION
  };
}

export function budgetConfig(): BudgetConfig {
  return parseBudgetConfig(process.env);
}

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function evaluateBudget(
  config: BudgetConfig,
  spend: BudgetSpend,
  trafficClass: TrafficClass,
  estimatedCostMicrousd: number
): BudgetDecision {
  if (!config.enabled) {
    return { allowed: false, denial: "kill_switch", alerts: [] };
  }
  const alerts: string[] = [];
  if (spend.totalMicrousd >= config.monthlyBudgetMicrousd * config.alertFraction) {
    alerts.push(
      `monthly managed spend ${spend.totalMicrousd} microusd reached ${Math.round(
        config.alertFraction * 100
      )}% of cap ${config.monthlyBudgetMicrousd}`
    );
  }
  if (spend.trialMicrousd >= config.trialBudgetMicrousd * config.alertFraction) {
    alerts.push(
      `trial managed spend ${spend.trialMicrousd} microusd reached ${Math.round(
        config.alertFraction * 100
      )}% of cap ${config.trialBudgetMicrousd}`
    );
  }
  if (spend.totalMicrousd + estimatedCostMicrousd > config.monthlyBudgetMicrousd) {
    return { allowed: false, denial: "monthly_budget", alerts };
  }
  if (
    trafficClass === "trial" &&
    spend.trialMicrousd + estimatedCostMicrousd > config.trialBudgetMicrousd
  ) {
    return { allowed: false, denial: "trial_budget", alerts };
  }
  return { allowed: true, alerts };
}

export function assertBudgetAllowed(
  config: BudgetConfig,
  spend: BudgetSpend,
  trafficClass: TrafficClass,
  estimatedCostMicrousd: number
): BudgetDecision {
  const decision = evaluateBudget(config, spend, trafficClass, estimatedCostMicrousd);
  for (const alert of decision.alerts) {
    console.warn(`[managed-budget] ${alert}`);
  }
  if (!decision.allowed) {
    const code = decision.denial === "kill_switch" ? "inference_disabled" : "budget_exceeded";
    throw new ManagedError(code, `managed inference blocked: ${decision.denial}`);
  }
  return decision;
}
