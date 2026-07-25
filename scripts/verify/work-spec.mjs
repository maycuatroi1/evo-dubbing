import { exists, read, result, gitShow } from "./_lib.mjs";

const SPEC = "feature_list.json";
const STATUSES = new Set(["not_started", "in_progress", "passing", "blocked"]);

export default function workSpec() {
  const r = result("work-spec", "feature_list.json integrity");
  if (!exists(SPEC)) {
    r.fail(`${SPEC} is missing`, "without a structured spec, 'done' is whatever the agent decides at the end of a long session");
    return r;
  }

  let spec;
  try {
    spec = JSON.parse(read(SPEC));
  } catch (err) {
    r.fail(`${SPEC} is not valid JSON: ${err.message}`, "fix the syntax; this file is the only machine-readable definition of done");
    return r;
  }

  const features = Array.isArray(spec.features) ? spec.features : null;
  if (!features) {
    r.fail(`${SPEC} has no "features" array`, 'keep the shape { "features": [ { "id", "behavior", "verify", "status", "evidence" } ] }');
    return r;
  }

  const seen = new Set();
  for (const f of features) {
    const id = f.id || "(no id)";
    for (const field of ["id", "behavior", "verify", "status"]) {
      if (!f[field]) r.fail(`${SPEC} entry ${id} is missing "${field}"`, `add "${field}"; an entry with no ${field} cannot be checked by anyone`);
    }
    if (seen.has(f.id)) r.fail(`${SPEC} has two entries with id ${id}`, "ids are the stable handle a plan or commit refers to; make them unique");
    seen.add(f.id);
    if (f.status && !STATUSES.has(f.status)) {
      r.fail(`${SPEC} entry ${id} has status "${f.status}"`, `use one of: ${[...STATUSES].join(", ")}`);
    }
    if (f.status === "passing" && !(f.evidence || "").trim()) {
      r.fail(
        `${SPEC} entry ${id} is "passing" with empty evidence`,
        'write what you actually observed into "evidence" (command run, what you saw), or set the status back; a self-graded pass is how a long session declares victory early'
      );
    }
    if (f.behavior && /refactor|implement|add a |create a |wire up/i.test(f.behavior) && !/user|viewer|operator|agent/i.test(f.behavior)) {
      r.note(`entry ${id} reads like an implementation task, not an end-to-end behavior`);
    }
  }

  const previous = gitShow("HEAD", SPEC);
  if (previous === null) {
    r.note(`${SPEC} is not committed yet, so deletions cannot be detected until it is`);
  } else {
    let old;
    try {
      old = JSON.parse(previous);
    } catch {
      old = null;
    }
    for (const f of old?.features || []) {
      if (!seen.has(f.id)) {
        r.fail(
          `${SPEC} entry ${f.id} was in HEAD and is gone from the working tree`,
          "restore it. You may only flip status and write evidence. Deleting a behavior is how a spec quietly becomes achievable"
        );
      }
    }
  }

  const passing = features.filter((f) => f.status === "passing").length;
  r.summary = `${features.length} behavior(s), ${passing} passing`;
  return r;
}
