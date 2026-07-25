import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

const PERIOD_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;
const PERIOD_QUOTA_MS = 18_000_000;

let failures = 0;

function pass(name) {
  console.log(`ok - ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`not ok - ${name}: ${error.message}`);
}

async function expectReject(name, queryPromise, match) {
  try {
    await queryPromise;
    fail(name, new Error("expected the statement to fail but it succeeded"));
  } catch (error) {
    if (match && !String(error.message).includes(match)) {
      fail(name, new Error(`unexpected error: ${error.message}`));
    } else {
      pass(name);
    }
  }
}

function check(name, condition) {
  if (condition) {
    pass(name);
  } else {
    fail(name, new Error("assertion failed"));
  }
}

try {
  const t0 = Date.UTC(2026, 0, 1);

  const [payment] = await sql`
    INSERT INTO payments (account_id, provider, order_code, idempotency_key, amount_minor, currency, status)
    VALUES ('acct-int', 'payos', 900001, 'idem-int-1', 199000, 'VND', 'success')
    RETURNING id
  `;
  pass("successful PayOS payment insert");

  await expectReject(
    "duplicate orderCode fails safely",
    sql`INSERT INTO payments (account_id, provider, order_code, idempotency_key, amount_minor)
        VALUES ('acct-int', 'payos', 900001, 'idem-int-2', 199000)`,
    "payments_order_code_idx"
  );

  await expectReject(
    "duplicate idempotency key fails safely",
    sql`INSERT INTO payments (account_id, provider, order_code, idempotency_key, amount_minor)
        VALUES ('acct-int', 'payos', 900002, 'idem-int-1', 199000)`,
    "payments_idempotency_key_idx"
  );

  await expectReject(
    "negative payment amount rejected",
    sql`INSERT INTO payments (account_id, provider, order_code, idempotency_key, amount_minor)
        VALUES ('acct-int', 'payos', 900003, 'idem-int-3', -1)`,
    "payments_amount_minor_positive"
  );

  const startAt = new Date(t0);
  const endAt = new Date(t0 + PERIOD_LENGTH_MS);
  const [period] = await sql`
    INSERT INTO subscription_periods (account_id, payment_id, start_at, end_at, status)
    VALUES ('acct-int', ${payment.id}, ${startAt}, ${endAt}, 'active')
    RETURNING id, quota_ms, used_ms
  `;
  check("period created with 18,000,000 ms quota and zero usage",
    Number(period.quota_ms) === PERIOD_QUOTA_MS && Number(period.used_ms) === 0);

  await expectReject(
    "second active period for the same account rejected",
    sql`INSERT INTO subscription_periods (account_id, start_at, end_at, status)
        VALUES ('acct-int', ${new Date(t0 + 40 * 86400000)}, ${new Date(t0 + 70 * 86400000)}, 'active')`,
    "subscription_periods_one_active_idx"
  );

  const [existing] = await sql`
    SELECT extract(epoch from start_at) * 1000 AS start_ms, extract(epoch from end_at) * 1000 AS end_ms
    FROM subscription_periods
    WHERE account_id = 'acct-int' AND status IN ('active', 'queued')
  `;
  const anchorMs = Math.max(Number(existing.end_ms), t0 + 10 * 86400000);
  const queuedStart = new Date(anchorMs);
  const queuedEnd = new Date(anchorMs + PERIOD_LENGTH_MS);
  const [queued] = await sql`
    INSERT INTO subscription_periods (account_id, start_at, end_at, status)
    VALUES ('acct-int', ${queuedStart}, ${queuedEnd}, 'queued')
    RETURNING start_at, quota_ms
  `;
  check("early renewal queues the next period at the active period end",
    new Date(queued.start_at).getTime() === Number(existing.end_ms));
  check("queued period keeps the full quota with no rollover",
    Number(queued.quota_ms) === PERIOD_QUOTA_MS);

  await expectReject(
    "overlapping period rejected by exclusion constraint",
    sql`INSERT INTO subscription_periods (account_id, start_at, end_at, status)
        VALUES ('acct-int', ${new Date(t0 + 15 * 86400000)}, ${new Date(t0 + 45 * 86400000)}, 'queued')`,
    "subscription_periods_no_overlap"
  );

  await expectReject(
    "overlapping period for another status combination rejected",
    sql`INSERT INTO subscription_periods (account_id, start_at, end_at, status)
        VALUES ('acct-int', ${new Date(t0 + 59 * 86400000)}, ${new Date(t0 + 89 * 86400000)}, 'queued')`,
    "subscription_periods_no_overlap"
  );

  const [otherAccount] = await sql`
    INSERT INTO subscription_periods (account_id, start_at, end_at, status)
    VALUES ('acct-other', ${startAt}, ${endAt}, 'active')
    RETURNING id
  `;
  pass("same window allowed for a different account");

  await expectReject(
    "negative used_ms rejected",
    sql`UPDATE subscription_periods SET used_ms = -1 WHERE id = ${period.id}`,
    "subscription_periods_used_within_quota"
  );

  await expectReject(
    "used_ms above quota rejected",
    sql`UPDATE subscription_periods SET used_ms = ${PERIOD_QUOTA_MS + 1} WHERE id = ${period.id}`,
    "subscription_periods_used_within_quota"
  );

  await sql`UPDATE subscription_periods SET used_ms = ${PERIOD_QUOTA_MS} WHERE id = ${period.id}`;
  pass("used_ms equal to quota accepted");

  await expectReject(
    "unknown period status rejected",
    sql`INSERT INTO subscription_periods (account_id, start_at, end_at, status)
        VALUES ('acct-bad', ${startAt}, ${endAt}, 'bogus')`,
    "subscription_periods_status_known"
  );

  await expectReject(
    "empty window rejected",
    sql`INSERT INTO subscription_periods (account_id, start_at, end_at, status)
        VALUES ('acct-bad', ${endAt}, ${startAt}, 'active')`,
    "subscription_periods_window_ordered"
  );

  const [request] = await sql`
    INSERT INTO inference_requests (request_key, account_id, kind, provider, model, status, input_chars, output_chars, latency_ms, cost_microusd)
    VALUES ('req-int-1', 'acct-int', 'tts', 'openai', 'gpt-4o-mini-tts', 'ok', 120, 340, 850, 4200)
    RETURNING id
  `;
  pass("inference request insert");

  await expectReject(
    "duplicate inference request key fails safely",
    sql`INSERT INTO inference_requests (request_key, account_id, kind, provider, model)
        VALUES ('req-int-1', 'acct-int', 'tts', 'openai', 'gpt-4o-mini-tts')`,
    "inference_requests_request_key_idx"
  );

  await sql`
    INSERT INTO usage_events (account_id, inference_request_id, period_id, source_ms, generated_chars, provider, model, currency, cost_microusd, latency_ms, status)
    VALUES ('acct-int', ${request.id}, ${period.id}, 12000, 340, 'openai', 'gpt-4o-mini-tts', 'USD', 4200, 850, 'ok')
  `;
  pass("usage event insert with integer cost and quota units");

  await expectReject(
    "negative usage source_ms rejected",
    sql`INSERT INTO usage_events (account_id, source_ms, provider, model)
        VALUES ('acct-int', -1, 'openai', 'gpt-4o-mini-tts')`,
    "usage_events_source_non_negative"
  );

  await expectReject(
    "negative usage cost rejected",
    sql`INSERT INTO usage_events (account_id, cost_microusd, provider, model)
        VALUES ('acct-int', -1, 'openai', 'gpt-4o-mini-tts')`,
    "usage_events_cost_non_negative"
  );

  const analyticsColumns = await sql`
    SELECT table_name AS "table", column_name AS "column"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('usage_events', 'inference_requests', 'daily_product_events')
    ORDER BY table_name, ordinal_position
  `;
  const banned = /transcript|original_text|subtitle|caption|raw_text|\btext\b/i;
  const offenders = analyticsColumns.filter((row) => banned.test(row.column));
  check("analytics tables store no raw transcript columns", offenders.length === 0);

  await sql`
    INSERT INTO daily_product_events (account_id, day, kind, requests, source_ms, generated_chars, cost_microusd)
    VALUES ('acct-int', '2026-01-02', 'tts', 3, 36000, 1020, 12600)
    ON CONFLICT (account_id, day, kind) DO UPDATE SET
      requests = daily_product_events.requests + EXCLUDED.requests,
      source_ms = daily_product_events.source_ms + EXCLUDED.source_ms,
      generated_chars = daily_product_events.generated_chars + EXCLUDED.generated_chars,
      cost_microusd = daily_product_events.cost_microusd + EXCLUDED.cost_microusd
  `;
  await sql`
    INSERT INTO daily_product_events (account_id, day, kind, requests, source_ms, generated_chars, cost_microusd)
    VALUES ('acct-int', '2026-01-02', 'tts', 2, 24000, 680, 8400)
    ON CONFLICT (account_id, day, kind) DO UPDATE SET
      requests = daily_product_events.requests + EXCLUDED.requests,
      source_ms = daily_product_events.source_ms + EXCLUDED.source_ms,
      generated_chars = daily_product_events.generated_chars + EXCLUDED.generated_chars,
      cost_microusd = daily_product_events.cost_microusd + EXCLUDED.cost_microusd
  `;
  const [rollup] = await sql`
    SELECT requests, cost_microusd FROM daily_product_events
    WHERE account_id = 'acct-int' AND day = '2026-01-02' AND kind = 'tts'
  `;
  check("daily rollup upsert accumulates integer counters",
    Number(rollup.requests) === 5 && Number(rollup.cost_microusd) === 21000);

  await sql`
    INSERT INTO creator_outreach (platform, handle, channel_url)
    VALUES ('youtube', '@evo-demo', 'https://youtube.com/@evo-demo')
  `;
  await expectReject(
    "duplicate creator outreach fails safely",
    sql`INSERT INTO creator_outreach (platform, handle) VALUES ('youtube', '@evo-demo')`,
    "creator_outreach_creator_idx"
  );

  await sql`
    INSERT INTO takedown_requests (idempotency_key, reporter_email, reason)
    VALUES ('takedown-int-1', 'rights@example.com', 'unauthorized dub')
  `;
  await expectReject(
    "duplicate takedown idempotency key fails safely",
    sql`INSERT INTO takedown_requests (idempotency_key, reporter_email)
        VALUES ('takedown-int-1', 'rights@example.com')`,
    "takedown_requests_idempotency_key_idx"
  );

  const [dubCounts] = await sql`
    SELECT
      (SELECT count(*) FROM dubs) AS dubs,
      (SELECT count(*) FROM dub_segments) AS segments
  `;
  check("dubs and dub_segments untouched by monetization tests",
    String(dubCounts.dubs) === "1" && String(dubCounts.segments) === "1");

  if (failures > 0) {
    throw new Error(`${failures} schema integration assertion(s) failed`);
  }
  console.log("schema integration tests: ok");
} finally {
  await sql.end();
}
