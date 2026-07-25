import { exists, read, result, walk, extractStringArray } from "./_lib.mjs";

const PROVIDERS = {
  openai: "extension/src/lib/providers/openai.ts",
  gemini: "extension/src/lib/providers/gemini.ts"
};
const STORAGE = "extension/src/lib/storage.ts";
const MODEL_LITERAL = /"(gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|tts-1(?:-hd)?|whisper-1)"/g;

function voiceIds(source) {
  const at = source.indexOf("voices:");
  if (at === -1) return [];
  const open = source.indexOf("[", at);
  const close = source.indexOf("]", open);
  if (open === -1 || close === -1) return [];
  return [...source.slice(open, close).matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function defaultsBlock(source) {
  const at = source.indexOf("DEFAULT_SETTINGS");
  if (at === -1) return null;
  const end = source.indexOf("};", at);
  return source.slice(at, end === -1 ? source.length : end + 2);
}

export default function modelCatalog() {
  const r = result("model-catalog", "provider catalogs <-> DEFAULT_SETTINGS");
  const catalog = {};
  for (const [id, file] of Object.entries(PROVIDERS)) {
    if (!exists(file)) {
      r.fail(`${file} is missing`, `a provider named in the registry has no adapter; remove it from providers/index.ts or restore ${file}`);
      return r;
    }
    const source = read(file);
    catalog[id] = {
      translateModel: extractStringArray(source, "translateModels") || [],
      ttsModel: extractStringArray(source, "ttsModels") || [],
      sttModel: extractStringArray(source, "sttModels") || [],
      voice: voiceIds(source),
      file
    };
    if (catalog[id].translateModel.length === 0) {
      r.fail(`${file} declares no translateModels`, `add at least one model id to the ${id} provider catalog, or the options dropdown renders empty`);
    }
  }

  if (!exists(STORAGE)) {
    r.fail(`${STORAGE} is missing`, "DEFAULT_SETTINGS has moved; update this check and AGENTS.md");
    return r;
  }
  const storage = read(STORAGE);
  const defaults = defaultsBlock(storage);
  if (!defaults) {
    r.fail(`could not find DEFAULT_SETTINGS in ${STORAGE}`, "keep it as a single object literal ending in }; or update this check");
    return r;
  }

  const value = (key) => (defaults.match(new RegExp(`${key}:\\s*"([^"]*)"`)) || [])[1];
  const pairs = [
    ["translateModel", "translateProvider"],
    ["ttsModel", "ttsProvider"],
    ["voice", "ttsProvider"]
  ];

  for (const [field, providerField] of pairs) {
    const chosen = value(field);
    const provider = value(providerField);
    if (!chosen) continue;
    if (!provider || !catalog[provider]) {
      r.fail(
        `DEFAULT_SETTINGS.${providerField} is "${provider}" which is not a known provider`,
        `set ${providerField} to one of: ${Object.keys(catalog).join(", ")}`
      );
      continue;
    }
    const allowed = catalog[provider][field];
    if (!allowed.includes(chosen)) {
      r.fail(
        `DEFAULT_SETTINGS.${field} is "${chosen}" which is not in the ${provider} catalog (${allowed.join(", ") || "empty"})`,
        `add "${chosen}" to ${catalog[provider].file}, or change the default to one the catalog lists; a default outside the list renders the options dropdown with nothing selected`
      );
    }
  }

  for (const file of walk("extension/src", [".ts"])) {
    if (file.startsWith("extension/src/lib/providers/")) continue;
    const source = read(file);
    const scanned = file === STORAGE ? source.split(defaults).join("") : source;
    for (const m of scanned.matchAll(MODEL_LITERAL)) {
      r.fail(
        `${file} hardcodes the model id ${m[0]}`,
        `model ids belong in the provider catalog under extension/src/lib/providers/; a second copy drifts the next time a provider renames a model`
      );
    }
  }

  const total = Object.values(catalog).reduce((n, c) => n + c.translateModel.length + c.ttsModel.length + c.sttModel.length, 0);
  r.summary = `${Object.keys(catalog).length} provider(s), ${total} model id(s)`;
  return r;
}
