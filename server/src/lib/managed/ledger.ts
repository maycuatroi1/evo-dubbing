import { sql } from "drizzle-orm";
import { TRIAL_QUOTA_MS } from "../account.ts";
import { ManagedError } from "./catalog.ts";
import type { BudgetSpend } from "./budget.ts";

export type RequestStatus = "reserved" | "settled" | "refunded";
export type InferenceKind = "tts" | "translation";

export interface StoredRequest {
  requestKey: string;
  accountId: string;
  kind: InferenceKind;
  provider: string;
  model: string;
  status: RequestStatus;
  periodId: string | null;
  reservedMs: number;
  costMicrousd: number;
  inputChars: number;
  outputChars: number;
  latencyMs: number;
  result: string;
  createdAt: string;
}

export interface StoredPeriod {
  id: string;
  accountId: string;
  quotaMs: number;
  usedMs: number;
  status: string;
  startAt: string;
  endAt: string;
}

export interface UsageRecordInput {
  accountId: string;
  periodId: string | null;
  sourceMs: number;
  generatedChars: number;
  provider: string;
  model: string;
  costMicrousd: number;
  latencyMs: number;
  status: string;
}

export interface TransitionPatch {
  costMicrousd?: number;
  latencyMs?: number;
  outputChars?: number;
  provider?: string;
  model?: string;
  result?: string;
}

export interface LedgerStore {
  getRequest(requestKey: string): Promise<StoredRequest | null>;
  insertRequest(record: StoredRequest): Promise<boolean>;
  findActivePeriod(accountId: string, nowIso: string): Promise<StoredPeriod | null>;
  tryAddPeriodUsed(periodId: string, deltaMs: number): Promise<boolean>;
  addPeriodUsed(periodId: string, deltaMs: number): Promise<void>;
  tryReserveTrial(
    accountId: string,
    estimateMs: number,
    quotaMs: number,
    record: StoredRequest
  ): Promise<boolean>;
  transitionRequest(
    requestKey: string,
    from: RequestStatus[],
    to: RequestStatus,
    patch: TransitionPatch
  ): Promise<StoredRequest | null>;
  insertUsage(record: UsageRecordInput): Promise<void>;
  monthlySpendMicrousd(sinceIso: string): Promise<BudgetSpend>;
}

export interface ReserveInput {
  requestKey: string;
  accountId: string;
  kind: InferenceKind;
  provider: string;
  model: string;
  estimateMs: number;
  costMicrousd: number;
  inputChars?: number;
}

export interface ReserveResult {
  replay: boolean;
  record: StoredRequest;
}

export interface SettleInput {
  actualMs: number;
  costMicrousd: number;
  generatedChars: number;
  latencyMs: number;
  provider: string;
  model: string;
  result: string;
}

export interface SettleResult {
  replay: boolean;
  record: StoredRequest;
}

export interface RefundResult {
  refunded: boolean;
}

export interface RecordTranslationInput {
  requestKey: string;
  accountId: string;
  periodId: string | null;
  provider: string;
  model: string;
  inputChars: number;
  outputChars: number;
  costMicrousd: number;
  latencyMs: number;
  result: string;
}

export class ManagedLedger {
  private store: LedgerStore;
  private now: () => Date;

  constructor(store: LedgerStore, now: () => Date = () => new Date()) {
    this.store = store;
    this.now = now;
  }

  getRequest(requestKey: string): Promise<StoredRequest | null> {
    return this.store.getRequest(requestKey);
  }

  activePeriod(accountId: string): Promise<StoredPeriod | null> {
    return this.store.findActivePeriod(accountId, this.now().toISOString());
  }

  monthlySpend(since: Date): Promise<BudgetSpend> {
    return this.store.monthlySpendMicrousd(since.toISOString());
  }

  async reserve(input: ReserveInput): Promise<ReserveResult> {
    const existing = await this.store.getRequest(input.requestKey);
    if (existing) {
      return { replay: true, record: existing };
    }
    const period = await this.activePeriod(input.accountId);
    const base: StoredRequest = {
      requestKey: input.requestKey,
      accountId: input.accountId,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      status: "reserved",
      periodId: period?.id ?? null,
      reservedMs: input.estimateMs,
      costMicrousd: input.costMicrousd,
      inputChars: input.inputChars ?? 0,
      outputChars: 0,
      latencyMs: 0,
      result: "",
      createdAt: this.now().toISOString()
    };
    if (period) {
      const reserved = await this.store.tryAddPeriodUsed(period.id, input.estimateMs);
      if (!reserved) {
        throw new ManagedError(
          "quota_exceeded",
          `period ${period.id} has insufficient remaining source_ms for ${input.estimateMs} ms`
        );
      }
      const inserted = await this.store.insertRequest(base);
      if (!inserted) {
        await this.store.addPeriodUsed(period.id, -input.estimateMs);
        const raced = await this.store.getRequest(input.requestKey);
        if (raced) return { replay: true, record: raced };
        throw new ManagedError("reservation_conflict", "request key appeared without a record");
      }
      return { replay: false, record: base };
    }
    const reserved = await this.store.tryReserveTrial(
      input.accountId,
      input.estimateMs,
      TRIAL_QUOTA_MS,
      base
    );
    if (!reserved) {
      const raced = await this.store.getRequest(input.requestKey);
      if (raced) return { replay: true, record: raced };
      throw new ManagedError(
        "quota_exceeded",
        `trial quota ${TRIAL_QUOTA_MS} ms exhausted for ${input.estimateMs} ms`
      );
    }
    return { replay: false, record: base };
  }

  async settle(requestKey: string, input: SettleInput): Promise<SettleResult> {
    const updated = await this.store.transitionRequest(requestKey, ["reserved"], "settled", {
      costMicrousd: input.costMicrousd,
      latencyMs: input.latencyMs,
      outputChars: input.generatedChars,
      provider: input.provider,
      model: input.model,
      result: input.result
    });
    if (!updated) {
      const existing = await this.store.getRequest(requestKey);
      if (existing && existing.status === "settled") {
        return { replay: true, record: existing };
      }
      throw new ManagedError(
        "invalid_state",
        `cannot settle request ${requestKey}: not in reserved state`
      );
    }
    if (updated.periodId) {
      await this.store.addPeriodUsed(updated.periodId, input.actualMs - updated.reservedMs);
    }
    await this.store.insertUsage({
      accountId: updated.accountId,
      periodId: updated.periodId,
      sourceMs: input.actualMs,
      generatedChars: input.generatedChars,
      provider: input.provider,
      model: input.model,
      costMicrousd: input.costMicrousd,
      latencyMs: input.latencyMs,
      status: "ok"
    });
    return { replay: false, record: updated };
  }

  async refund(requestKey: string): Promise<RefundResult> {
    const updated = await this.store.transitionRequest(requestKey, ["reserved"], "refunded", {});
    if (!updated) {
      return { refunded: false };
    }
    if (updated.periodId) {
      await this.store.addPeriodUsed(updated.periodId, -updated.reservedMs);
    }
    return { refunded: true };
  }

  async recordTranslation(input: RecordTranslationInput): Promise<{ replay: boolean }> {
    const record: StoredRequest = {
      requestKey: input.requestKey,
      accountId: input.accountId,
      kind: "translation",
      provider: input.provider,
      model: input.model,
      status: "settled",
      periodId: input.periodId,
      reservedMs: 0,
      costMicrousd: input.costMicrousd,
      inputChars: input.inputChars,
      outputChars: input.outputChars,
      latencyMs: input.latencyMs,
      result: input.result,
      createdAt: this.now().toISOString()
    };
    const inserted = await this.store.insertRequest(record);
    if (!inserted) {
      return { replay: true };
    }
    await this.store.insertUsage({
      accountId: input.accountId,
      periodId: input.periodId,
      sourceMs: 0,
      generatedChars: input.outputChars,
      provider: input.provider,
      model: input.model,
      costMicrousd: input.costMicrousd,
      latencyMs: input.latencyMs,
      status: "ok"
    });
    return { replay: false };
  }
}

export class InMemoryLedgerStore implements LedgerStore {
  requests = new Map<string, StoredRequest>();
  periods = new Map<string, StoredPeriod>();
  usages: Array<UsageRecordInput & { createdAt: string }> = [];

  async getRequest(requestKey: string): Promise<StoredRequest | null> {
    return this.requests.get(requestKey) ?? null;
  }

  async insertRequest(record: StoredRequest): Promise<boolean> {
    if (this.requests.has(record.requestKey)) return false;
    this.requests.set(record.requestKey, { ...record });
    return true;
  }

  async findActivePeriod(accountId: string, nowIso: string): Promise<StoredPeriod | null> {
    const candidates = [...this.periods.values()]
      .filter(
        (p) =>
          p.accountId === accountId &&
          p.status === "active" &&
          p.startAt <= nowIso &&
          p.endAt > nowIso
      )
      .sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
    return candidates[0] ?? null;
  }

  async tryAddPeriodUsed(periodId: string, deltaMs: number): Promise<boolean> {
    const period = this.periods.get(periodId);
    if (!period) return false;
    if (period.usedMs + deltaMs < 0 || period.usedMs + deltaMs > period.quotaMs) return false;
    period.usedMs += deltaMs;
    return true;
  }

  async addPeriodUsed(periodId: string, deltaMs: number): Promise<void> {
    const period = this.periods.get(periodId);
    if (!period) return;
    period.usedMs = Math.max(0, period.usedMs + deltaMs);
  }

  async tryReserveTrial(
    accountId: string,
    estimateMs: number,
    quotaMs: number,
    record: StoredRequest
  ): Promise<boolean> {
    const used = this.usages
      .filter((u) => u.accountId === accountId && u.periodId === null)
      .reduce((sum, u) => sum + u.sourceMs, 0);
    const reserved = [...this.requests.values()]
      .filter((r) => r.accountId === accountId && r.periodId === null && r.status === "reserved")
      .reduce((sum, r) => sum + r.reservedMs, 0);
    if (used + reserved + estimateMs > quotaMs) return false;
    if (this.requests.has(record.requestKey)) return false;
    this.requests.set(record.requestKey, { ...record });
    return true;
  }

  async transitionRequest(
    requestKey: string,
    from: RequestStatus[],
    to: RequestStatus,
    patch: TransitionPatch
  ): Promise<StoredRequest | null> {
    const record = this.requests.get(requestKey);
    if (!record || !from.includes(record.status)) return null;
    record.status = to;
    if (patch.costMicrousd !== undefined) record.costMicrousd = patch.costMicrousd;
    if (patch.latencyMs !== undefined) record.latencyMs = patch.latencyMs;
    if (patch.outputChars !== undefined) record.outputChars = patch.outputChars;
    if (patch.provider !== undefined) record.provider = patch.provider;
    if (patch.model !== undefined) record.model = patch.model;
    if (patch.result !== undefined) record.result = patch.result;
    return record;
  }

  async insertUsage(record: UsageRecordInput): Promise<void> {
    this.usages.push({ ...record, createdAt: new Date().toISOString() });
  }

  async monthlySpendMicrousd(sinceIso: string): Promise<BudgetSpend> {
    let total = 0;
    let trial = 0;
    for (const usage of this.usages) {
      if (usage.createdAt < sinceIso) continue;
      total += usage.costMicrousd;
      if (usage.periodId === null) trial += usage.costMicrousd;
    }
    for (const request of this.requests.values()) {
      if (request.status !== "reserved" || request.createdAt < sinceIso) continue;
      total += request.costMicrousd;
      if (request.periodId === null) trial += request.costMicrousd;
    }
    return { totalMicrousd: total, trialMicrousd: trial };
  }
}

interface SqlExecutor {
  execute(query: unknown): Promise<unknown>;
}

interface SqlDatabase extends SqlExecutor {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return result as unknown as Array<Record<string, unknown>>;
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

function mapRequestRow(row: Record<string, unknown>): StoredRequest {
  return {
    requestKey: String(row.request_key),
    accountId: String(row.account_id),
    kind: String(row.kind) as InferenceKind,
    provider: String(row.provider),
    model: String(row.model),
    status: String(row.status) as RequestStatus,
    periodId: row.period_id === null || row.period_id === undefined ? null : String(row.period_id),
    reservedMs: num(row.reserved_ms),
    costMicrousd: num(row.cost_microusd),
    inputChars: num(row.input_chars),
    outputChars: num(row.output_chars),
    latencyMs: num(row.latency_ms),
    result: String(row.result ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

const REQUEST_COLUMNS = sql.raw(
  "request_key, account_id, kind, provider, model, status, period_id, reserved_ms, cost_microusd, input_chars, output_chars, latency_ms, result, created_at"
);

export class PgLedgerStore implements LedgerStore {
  private db: SqlDatabase;

  constructor(db: SqlDatabase) {
    this.db = db;
  }

  async getRequest(requestKey: string): Promise<StoredRequest | null> {
    const rows = rowsOf(
      await this.db.execute(
        sql`select ${REQUEST_COLUMNS} from inference_requests where request_key = ${requestKey} limit 1`
      )
    );
    return rows[0] ? mapRequestRow(rows[0]) : null;
  }

  async insertRequest(record: StoredRequest): Promise<boolean> {
    const rows = rowsOf(
      await this.db.execute(sql`
        insert into inference_requests
          (request_key, account_id, kind, provider, model, status, period_id, reserved_ms, cost_microusd, input_chars, output_chars, latency_ms, result)
        values
          (${record.requestKey}, ${record.accountId}, ${record.kind}, ${record.provider}, ${record.model},
           ${record.status}, ${record.periodId}, ${record.reservedMs}, ${record.costMicrousd},
           ${record.inputChars}, ${record.outputChars}, ${record.latencyMs}, ${record.result})
        on conflict (request_key) do nothing
        returning request_key
      `)
    );
    return rows.length === 1;
  }

  async findActivePeriod(accountId: string, nowIso: string): Promise<StoredPeriod | null> {
    const rows = rowsOf(
      await this.db.execute(sql`
        select id, account_id, quota_ms, used_ms, status, start_at, end_at
        from subscription_periods
        where account_id = ${accountId} and status = 'active' and start_at <= ${nowIso} and end_at > ${nowIso}
        order by start_at asc
        limit 1
      `)
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      quotaMs: num(row.quota_ms),
      usedMs: num(row.used_ms),
      status: String(row.status),
      startAt: new Date(String(row.start_at)).toISOString(),
      endAt: new Date(String(row.end_at)).toISOString()
    };
  }

  async tryAddPeriodUsed(periodId: string, deltaMs: number): Promise<boolean> {
    const rows = rowsOf(
      await this.db.execute(sql`
        update subscription_periods
        set used_ms = used_ms + ${deltaMs}, updated_at = now()
        where id = ${periodId} and used_ms + ${deltaMs} >= 0 and used_ms + ${deltaMs} <= quota_ms
        returning id
      `)
    );
    return rows.length === 1;
  }

  async addPeriodUsed(periodId: string, deltaMs: number): Promise<void> {
    await this.db.execute(sql`
      update subscription_periods
      set used_ms = greatest(0, used_ms + ${deltaMs}), updated_at = now()
      where id = ${periodId}
    `);
  }

  async tryReserveTrial(
    accountId: string,
    estimateMs: number,
    quotaMs: number,
    record: StoredRequest
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${accountId}))`);
      const usedRows = rowsOf(
        await tx.execute(sql`
          select coalesce(sum(source_ms), 0) as total
          from usage_events
          where account_id = ${accountId} and period_id is null
        `)
      );
      const reservedRows = rowsOf(
        await tx.execute(sql`
          select coalesce(sum(reserved_ms), 0) as total
          from inference_requests
          where account_id = ${accountId} and period_id is null and status = 'reserved'
        `)
      );
      const used = num(usedRows[0]?.total);
      const reserved = num(reservedRows[0]?.total);
      if (used + reserved + estimateMs > quotaMs) return false;
      const inserted = rowsOf(
        await tx.execute(sql`
          insert into inference_requests
            (request_key, account_id, kind, provider, model, status, period_id, reserved_ms, cost_microusd, input_chars, output_chars, latency_ms, result)
          values
            (${record.requestKey}, ${record.accountId}, ${record.kind}, ${record.provider}, ${record.model},
             ${record.status}, null, ${record.reservedMs}, ${record.costMicrousd},
             ${record.inputChars}, ${record.outputChars}, ${record.latencyMs}, ${record.result})
          on conflict (request_key) do nothing
          returning request_key
        `)
      );
      return inserted.length === 1;
    });
  }

  async transitionRequest(
    requestKey: string,
    from: RequestStatus[],
    to: RequestStatus,
    patch: TransitionPatch
  ): Promise<StoredRequest | null> {
    const rows = rowsOf(
      await this.db.execute(sql`
        update inference_requests
        set status = ${to},
            cost_microusd = coalesce(${patch.costMicrousd ?? null}, cost_microusd),
            latency_ms = coalesce(${patch.latencyMs ?? null}, latency_ms),
            output_chars = coalesce(${patch.outputChars ?? null}, output_chars),
            provider = coalesce(${patch.provider ?? null}, provider),
            model = coalesce(${patch.model ?? null}, model),
            result = coalesce(${patch.result ?? null}, result)
        where request_key = ${requestKey} and status in (${sql.join(from.map((s) => sql`${s}`), sql`, `)})
        returning ${REQUEST_COLUMNS}
      `)
    );
    return rows[0] ? mapRequestRow(rows[0]) : null;
  }

  async insertUsage(record: UsageRecordInput): Promise<void> {
    await this.db.execute(sql`
      insert into usage_events
        (account_id, period_id, source_ms, generated_chars, provider, model, cost_microusd, latency_ms, status)
      values
        (${record.accountId}, ${record.periodId}, ${record.sourceMs}, ${record.generatedChars},
         ${record.provider}, ${record.model}, ${record.costMicrousd}, ${record.latencyMs}, ${record.status})
    `);
  }

  async monthlySpendMicrousd(sinceIso: string): Promise<BudgetSpend> {
    const usageRows = rowsOf(
      await this.db.execute(sql`
        select coalesce(sum(cost_microusd), 0) as total,
               coalesce(sum(cost_microusd) filter (where period_id is null), 0) as trial
        from usage_events
        where created_at >= ${sinceIso}
      `)
    );
    const reservedRows = rowsOf(
      await this.db.execute(sql`
        select coalesce(sum(cost_microusd), 0) as total,
               coalesce(sum(cost_microusd) filter (where period_id is null), 0) as trial
        from inference_requests
        where status = 'reserved' and created_at >= ${sinceIso}
      `)
    );
    return {
      totalMicrousd: num(usageRows[0]?.total) + num(reservedRows[0]?.total),
      trialMicrousd: num(usageRows[0]?.trial) + num(reservedRows[0]?.trial)
    };
  }
}
