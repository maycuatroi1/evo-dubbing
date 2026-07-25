import shareApi from "./share-api.mjs";
import bridgeProtocol from "./bridge-protocol.mjs";
import envContract from "./env-contract.mjs";
import modelCatalog from "./model-catalog.mjs";
import workSpec from "./work-spec.mjs";
import map from "./map.mjs";

const CHECKS = {
  "share-api": shareApi,
  "bridge-protocol": bridgeProtocol,
  "env-contract": envContract,
  "model-catalog": modelCatalog,
  "work-spec": workSpec,
  map
};

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const quiet = process.argv.includes("--quiet");
const names = requested.length ? requested : Object.keys(CHECKS);

for (const name of names) {
  if (!CHECKS[name]) {
    console.error(`unknown check: ${name}`);
    console.error(`available: ${Object.keys(CHECKS).join(", ")}`);
    process.exit(2);
  }
}

let failed = 0;
const width = Math.max(...names.map((n) => n.length)) + 2;

for (const name of names) {
  const r = CHECKS[name]();
  const label = name.padEnd(width);
  if (r.failures.length) {
    failed += r.failures.length;
    console.log(`${label}FAIL  ${r.seam}`);
    for (const f of r.failures) {
      console.log(`  - ${f.what}`);
      console.log(`    fix: ${f.fix}`);
    }
  } else {
    console.log(`${label}ok    ${r.summary}`);
  }
  if (!quiet) {
    for (const note of r.notes) console.log(`  note: ${note}`);
  }
}

console.log("");
if (failed) {
  console.log(`${failed} failure(s). Seams registered in ../evo-dubbing-harness/contracts.yaml.`);
  process.exit(1);
}
console.log(`${names.length} check(s) passed. This does not prove a video dubs: see "What is not verified" in AGENTS.md.`);
