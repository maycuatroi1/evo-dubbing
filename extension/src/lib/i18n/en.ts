import type { StringTable } from "./vi.ts";

export const en: StringTable = {
  "app.name": "evo-dubbing",

  "overlay.open": "Open the evo-dubbing panel",
  "overlay.collapse": "Collapse the panel",
  "overlay.settings": "Open settings",
  "overlay.noVideo": "No video detected on this page.",
  "overlay.sourceMeta": "{duration} · {platform}",
  "overlay.targetLabel": "Translate to",
  "overlay.trackLabel": "Caption source",
  "overlay.trackAuto": "Automatic (recommended)",
  "overlay.trackForeign": "not the spoken language",
  "overlay.trackLowCoverage":
    "The current captions only cover {percent}% of the video. Pick another caption source if the dub has gaps.",
  "overlay.dub": "Dub this video",
  "overlay.pause": "Pause",
  "overlay.resume": "Resume",
  "overlay.redub": "Re-dub",
  "overlay.shareLabel": "Share",
  "overlay.share": "Share this dub",
  "overlay.visibility": "Visibility",
  "overlay.visibilityPublic": "Public",
  "overlay.visibilityPrivate": "Private",
  "overlay.progressLabel": "Dubbing progress",

  "status.holdingForFirstDub": "Waiting for the first dubbed line",
  "status.videoElementMissing": "Could not find the video element.",
  "status.checkingLibrary": "Checking the shared library",
  "status.lookupFailed":
    "Shared library lookup failed ({reason}). Not generating a new dub to avoid unexpected charges. Try again later.",
  "status.playingShared": "Playing a shared dub (free)",
  "status.uploading": "Uploading dub...",
  "status.shared": "Shared ({visibility})",
  "status.alreadyShared": "This dub is already shared.",
  "status.updatingVisibility": "Updating visibility...",
  "status.visibilitySet": "Visibility set to {visibility}",
  "status.needShareServer": "The shared library is turned off in settings, so this dub cannot be shared.",
  "status.payosCreating": "Creating a PayOS checkout link...",
  "status.payosOpened": "PayOS checkout opened in a new tab. After paying, press Re-dub.",
  "status.signedInAgain": "Signed in again. Press Re-dub to retry.",

  "popup.tagline": "Open a YouTube video, then use the floating panel to dub it.",
  "popup.stateHeading": "Status",
  "popup.mode": "Mode",
  "popup.modeByok": "BYOK",
  "popup.modeManaged": "Managed",
  "popup.openaiKey": "OpenAI key",
  "popup.geminiKey": "Gemini key",
  "popup.targetLang": "Target language",
  "popup.shareServer": "Share server",
  "popup.keySet": "Set",
  "popup.keyMissing": "Missing",
  "popup.serverCustom": "custom",
  "popup.serverOff": "Off",
  "popup.openSettings": "Open settings",

  "options.title": "Settings",
  "options.subtitle": "Your API keys stay in this browser and are never sent to the share server.",
  "options.save": "Save changes",
  "options.saved": "Saved",

  "options.mode.heading": "Billing mode",
  "options.mode.byok": "BYOK - free, no sign-in",
  "options.mode.byokHint":
    "Use your own API keys from the section below. No account required, and no key is sent to the managed server.",
  "options.mode.managed": "Managed - no API key needed",
  "options.mode.managedHint":
    "199,000 VND for roughly 300 source minutes over 30 days. Optional, never required for BYOK users.",

  "options.managed.heading": "Managed dubbing",

  "options.keys.heading": "API keys",
  "options.keys.hint": "Only needed for BYOK mode. Keys are stored in this browser's local storage.",
  "options.keys.openai": "OpenAI key",
  "options.keys.gemini": "Gemini key",
  "options.keys.autoSwitch": "Picked {provider} for translation and voice, from the key you just entered.",

  "options.dubbing.heading": "Dubbing",
  "options.dubbing.targetLang": "Target language",
  "options.dubbing.duck": "Original volume while dubbing",
  "options.dubbing.duckValue": "{percent}% original volume",
  "options.dubbing.translateProvider": "Translate provider",
  "options.dubbing.translateModel": "Translate model",
  "options.dubbing.ttsProvider": "TTS provider",
  "options.dubbing.ttsModel": "TTS model",
  "options.dubbing.voice": "Voice",
  "options.dubbing.sttProvider": "STT provider (fallback)",
  "options.dubbing.sttHint": "Used when the video has no captions to extract.",
  "options.dubbing.subtitles": "Show translated subtitles on the video",
  "options.dubbing.timeline": "Show dubbing progress on the video timeline",
  "options.dubbing.timelineHint":
    "A thin lane under the scrubber marks the stretches that already have dubbed audio.",
  "options.dubbing.hold": "Hold the video until the first dubbed line is ready",
  "options.dubbing.holdHint":
    "Pressing Dub pauses the video immediately and resumes it once the first dubbed line is ready, so you never hear an un-dubbed opening. Pressing play skips the wait.",

  "options.sharing.heading": "Sharing",
  "options.sharing.autoUpload": "Upload finished dubs automatically",
  "options.sharing.visibility": "Default visibility",
  "options.sharing.public": "Public",
  "options.sharing.private": "Private",

  "options.server.heading": "Server",
  "options.server.lede": "The extension uses our server for the paid plan and the shared library.",
  "options.server.default": "Default",
  "options.server.custom": "Custom",
  "options.server.off": "Off",
  "options.server.checking": "Checking the connection...",
  "options.server.online": "Server is reachable",
  "options.server.offline": "Could not reach this server",
  "options.server.offNote": "No shared-library lookups, and nothing is uploaded.",
  "options.server.needsPermission": "Press Test the connection to grant access to this domain.",
  "options.server.advanced": "Advanced",
  "options.server.warnTitle": "The fields below are for people running their own build of the evo-dubbing server.",
  "options.server.warnManaged":
    "The 199,000 VND plan, your quota and your payment history belong to the default server. Switching gives all of that up.",
  "options.server.warnLibrary":
    "A new server has an empty shared library, so every video is dubbed from scratch on your own API budget.",
  "options.server.warnPermission":
    "Chrome will ask for access to the new domain, and we cannot support what happens on that server.",
  "options.server.unlock": "I run my own server",
  "options.server.managedUrl": "Managed server",
  "options.server.shareUrl": "Share server",
  "options.server.shareHint": "Leave empty to skip shared-library lookups and uploads.",
  "options.server.test": "Test the connection",
  "options.server.reset": "Back to the default server",
  "options.server.bannerCustom":
    "Using a custom server ({host}). The paid plan and shared library of the default server do not apply here.",
  "options.server.bannerOff":
    "The share server is off. Every video is dubbed from scratch and nothing can be shared."
};
