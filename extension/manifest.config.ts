import { readFileSync } from "node:fs";
import { defineManifest } from "@crxjs/vite-plugin";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

const version = (process.env.EXT_VERSION || pkg.version).replace(/^v/, "");

if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  throw new Error(
    `EXT_VERSION "${version}" is not a valid Chrome extension version (1-4 dot-separated integers).`
  );
}

export default defineManifest({
  manifest_version: 3,
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsB3y5hbaGvB31aBfHB+Ytrut6uHJ5Jxk04+pZ0NbePsYir7ZDMlZzDMPUEq63vIURbUJ2snXMa50fifd7rlrD6JRhxiuLBXk5L0J1Q6yzoh1caK2po/6tlYO9WQ9N8mnqabpaEGTA+bwwRsjx77OLAzWghsl6rhpj/+gtZM2fTQysVu4pkRZ2RuZ/wl9c9GXlcTiN25Ww6revKraClRsesr72S7YJuHKwKWEdoyRb2mquLlCqsZiFXqzdKLb+DkrpNJ4Q0SpjAleYslnu6Q7Jr2VBG6l9NE1Fxz+yh36T2M4HBif/oEXhSwl+ZDJ3ZZKuBcq31FWsqSDOQYKSJkcuwIDAQAB",
  name: "evo-dubbing",
  version,
  description: "AI voice-over dubbing for online videos, starting with YouTube.",
  icons: {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module"
  },
  content_scripts: [
    {
      matches: ["https://www.youtube.com/*", "https://youtube.com/*"],
      js: ["src/content/page-bridge.ts"],
      run_at: "document_start",
      world: "MAIN"
    },
    {
      matches: ["https://www.youtube.com/*", "https://youtube.com/*"],
      js: ["src/content/youtube.content.ts"],
      css: ["src/styles/tokens.css", "src/styles/base.css", "src/content/overlay.css"],
      run_at: "document_idle"
    }
  ],
  permissions: ["storage", "identity"],
  oauth2: {
    client_id: "401458936175-sofsattbm8g3t3qcjjgb1c333eo97k9h.apps.googleusercontent.com",
    scopes: ["openid", "email", "profile"]
  },
  host_permissions: [
    "https://www.youtube.com/*",
    "https://*.googlevideo.com/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://*.supabase.co/*"
  ],
  optional_host_permissions: ["https://*/*"],
  web_accessible_resources: [
    {
      resources: ["icons/*"],
      matches: ["https://www.youtube.com/*"]
    }
  ]
});
