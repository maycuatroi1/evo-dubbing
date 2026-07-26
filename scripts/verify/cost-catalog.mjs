import { exists, read, result } from "./_lib.mjs";

const CATALOG = "server/src/lib/managed/catalog.ts";
const BUSINESS_MODEL = "docs/BUSINESS_MODEL.md";
const USD_TO_VND = 26_000;
const MIN_GROSS_MARGIN = 0.4;

function parseNumber(text) {
  return Number(text.replace(/[.,\s_]/g, ""));
}

function constant(source, name) {
  const m = source.match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`));
  return m ? Number(m[1].replaceAll("_", "")) : null;
}

function entries(source) {
  const out = [];
  for (const m of source.matchAll(/export const (\w+): CatalogEntry = \{([\s\S]*?)\n\};/g)) {
    const [, name, body] = m;
    const num = (key) => {
      const found = body.match(new RegExp(`${key}:\\s*([\\d_.]+)`));
      return found ? Number(found[1].replaceAll("_", "")) : null;
    };
    out.push({
      name,
      kind: (body.match(/kind:\s*"(\w+)"/) || [])[1],
      role: (body.match(/role:\s*"(\w+)"/) || [])[1],
      timeoutMs: num("timeoutMs"),
      maxAttempts: num("maxAttempts"),
      backoffMs: num("backoffMs"),
      hasRetryStatuses: /retryStatuses:\s*\[[^\]]+\]/.test(body),
      priceDate: /priceDate:\s*CATALOG_PRICE_DATE/.test(body),
      measuredCostPerSourceMsMicrousd: num("measuredCostPerSourceMsMicrousd"),
      perMillionCharsUsd: num("perMillionCharsUsd"),
      inputPerMillionTokensUsd: num("inputPerMillionTokensUsd"),
      outputPerMillionTokensUsd: num("outputPerMillionTokensUsd")
    });
  }
  return out;
}

function vndFromDoc(model, pattern, label) {
  const m = model.match(pattern);
  return m ? parseNumber(m[1]) : null;
}

export default function costCatalog() {
  const r = result("cost-catalog", "managed provider catalog <-> docs/BUSINESS_MODEL.md unit economics");
  if (!exists(CATALOG)) {
    r.fail(`${CATALOG} is missing`, "the managed cost catalog moved; update this check and contracts.yaml");
    return r;
  }
  if (!exists(BUSINESS_MODEL)) {
    r.fail(`${BUSINESS_MODEL} is missing`, "the business model doc is the source of truth for pricing; restore it");
    return r;
  }

  const source = read(CATALOG);
  const model = read(BUSINESS_MODEL);

  if (!/CATALOG_PRICE_DATE\s*=\s*"\d{4}-\d{2}-\d{2}"/.test(source)) {
    r.fail("CATALOG_PRICE_DATE is not an ISO date", 'set CATALOG_PRICE_DATE to "YYYY-MM-DD" so stale pricing is auditable');
  }

  const list = entries(source);
  if (list.length === 0) {
    r.fail("no CatalogEntry literals found", "keep entries as `export const X: CatalogEntry = {...}` literals so this check can audit them");
    return r;
  }

  for (const entry of list) {
    const hasUnitCost =
      entry.measuredCostPerSourceMsMicrousd !== null ||
      entry.perMillionCharsUsd !== null ||
      (entry.inputPerMillionTokensUsd !== null && entry.outputPerMillionTokensUsd !== null);
    if (!hasUnitCost) {
      r.fail(`${entry.name} has no unit cost`, "add measuredCostPerSourceMsMicrousd, perMillionCharsUsd, or token pricing; billing cannot be estimated without it");
    }
    if (!entry.priceDate) {
      r.fail(`${entry.name} pricing has no priceDate`, "set pricing.priceDate so unit costs are auditable against a date");
    }
    if (entry.timeoutMs === null || entry.timeoutMs <= 0) {
      r.fail(`${entry.name} has no positive timeoutMs`, "every managed provider entry must declare a timeout so a hung call cannot burn quota");
    }
    if (entry.maxAttempts === null || entry.maxAttempts < 1 || entry.backoffMs === null || !entry.hasRetryStatuses) {
      r.fail(`${entry.name} has an incomplete retry policy`, "declare retry.maxAttempts, retry.backoffMs and retry.retryStatuses");
    }
  }

  const ttsPrimary = list.find((e) => e.kind === "tts" && e.role === "primary");
  const translationPrimary = list.find((e) => e.kind === "translation" && e.role === "primary");
  if (!ttsPrimary || !translationPrimary) {
    r.fail("catalog lacks a tts primary or translation primary entry", "managed generation needs one primary per kind; add it or fix kind/role");
    return r;
  }

  const speechCharsPerSecond = constant(source, "SPEECH_CHARS_PER_SECOND");
  const charsPerToken = constant(source, "CHARS_PER_TOKEN");
  if (!speechCharsPerSecond || !charsPerToken) {
    r.fail("SPEECH_CHARS_PER_SECOND or CHARS_PER_TOKEN missing", "these constants drive the COGS estimate; restore them or update this check");
    return r;
  }

  const quotaMs = vndFromDoc(model, /300 source minutes, equal to ([\d,]+) source milliseconds/, "quota");
  const priceVnd = vndFromDoc(model, /giá bán ([\d,.]+) VND/, "price");
  const capVnd = vndFromDoc(model, /COGS tối đa ([\d,.]+) VND/, "cap");
  if (!quotaMs || !priceVnd || !capVnd) {
    r.fail(
      "could not parse quota, price, or COGS cap from docs/BUSINESS_MODEL.md",
      "keep the lines `300 source minutes, equal to N source milliseconds`, `giá bán N VND`, and `COGS tối đa N VND/300 phút` or update this check"
    );
    return r;
  }

  const ttsUsd =
    ttsPrimary.measuredCostPerSourceMsMicrousd !== null
      ? (quotaMs * ttsPrimary.measuredCostPerSourceMsMicrousd) / 1_000_000
      : (quotaMs / 1000) * speechCharsPerSecond * ((ttsPrimary.perMillionCharsUsd ?? 0) / 1_000_000);
  const tokens = ((quotaMs / 1000) * speechCharsPerSecond) / charsPerToken;
  const translationUsd =
    (tokens / 1_000_000) * (translationPrimary.inputPerMillionTokensUsd ?? 0) +
    (tokens / 1_000_000) * (translationPrimary.outputPerMillionTokensUsd ?? 0);
  const cogsVnd = Math.round((ttsUsd + translationUsd) * USD_TO_VND);
  const margin = (priceVnd - cogsVnd) / priceVnd;

  if (cogsVnd > capVnd) {
    r.fail(
      `estimated COGS for the 300-minute plan is ${cogsVnd.toLocaleString("en-US")} VND, above the accepted cap ${capVnd.toLocaleString("en-US")} VND`,
      "lower catalog unit costs, renegotiate provider pricing, or update docs/BUSINESS_MODEL.md with owner approval; spend cap cannot rely on the provider dashboard"
    );
  }
  if (margin < MIN_GROSS_MARGIN) {
    r.fail(
      `gross margin ${(margin * 100).toFixed(1)}% is below ${MIN_GROSS_MARGIN * 100}% (doc states ~42%)`,
      "catalog unit costs drifted against the 199,000 VND price; reprice the plan or the catalog before shipping"
    );
  }

  r.summary = `${list.length} entries, COGS ~${cogsVnd.toLocaleString("en-US")} VND/300min vs cap ${capVnd.toLocaleString("en-US")} VND, margin ${(margin * 100).toFixed(1)}%`;
  r.note(`USD_TO_VND fixed at ${USD_TO_VND.toLocaleString("en-US")} inside this check`);
  return r;
}
