import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "evo-dubbing",
  version: "0.1.0",
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
      css: ["src/content/overlay.css"],
      run_at: "document_idle"
    }
  ],
  permissions: ["storage", "scripting", "activeTab"],
  host_permissions: [
    "https://www.youtube.com/*",
    "https://*.googlevideo.com/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  web_accessible_resources: [
    {
      resources: ["icons/*"],
      matches: ["https://www.youtube.com/*"]
    }
  ]
});
