import test from "node:test";
import assert from "node:assert/strict";
import { installChromeMock, flushMicrotasks } from "./helpers.ts";

interface FakeOption {
  value: string;
  textContent: string;
  selected: boolean;
}

class FakeSelect {
  id = "";
  options: FakeOption[] = [];
  selectedIdx = -1;
  checked = false;
  textContent = "";
  listeners: Record<string, ((e: unknown) => void)[]> = {};

  set innerHTML(value: string) {
    if (value === "") {
      this.options = [];
      this.selectedIdx = -1;
    }
  }

  appendChild(option: FakeOption): void {
    this.options.push(option);
    if (option.selected) this.selectedIdx = this.options.length - 1;
    else if (this.selectedIdx === -1) this.selectedIdx = 0;
  }

  append(...nodes: unknown[]): void {
    void nodes;
  }

  set value(v: string) {
    this.selectedIdx = this.options.findIndex((o) => o.value === v);
  }

  get value(): string {
    return this.selectedIdx >= 0 ? this.options[this.selectedIdx].value : "";
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
}

function installDocumentStub() {
  const elements = new Map<string, FakeSelect>();
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) {
        const el = new FakeSelect();
        el.id = id;
        elements.set(id, el);
      }
      return elements.get(id);
    },
    createElement: (tag: string) =>
      tag === "option" ? { value: "", textContent: "", selected: false } : new FakeSelect(),
    querySelectorAll: () => []
  };
  return elements;
}

test("options init restores model and voice selection after filling options", async () => {
  installDocumentStub();
  const mock = installChromeMock(async () => ({ ok: false, status: 401, code: "not_signed_in", error: "no" }));
  mock.storage.local.data["evoDubbingSettings"] = {
    translateProvider: "gemini",
    ttsProvider: "gemini",
    sttProvider: "openai",
    targetLang: "vi",
    voice: "Kore",
    duckVolume: 0.18,
    showSubtitles: true,
    ttsModel: "gemini-2.5-pro-preview-tts",
    translateModel: "gemini-3.1-flash-lite",
    shareServerUrl: "",
    autoUpload: false,
    defaultVisibility: "private",
    billingMode: "byok",
    managedBaseUrl: "",
    managedVoiceProfileId: "vi-standard-female"
  };

  await import("../src/options/options.ts");
  await flushMicrotasks();

  const el = (id: string) =>
    (globalThis as { document: { getElementById(id: string): FakeSelect } }).document.getElementById(id);

  assert.equal(el("translateProvider").value, "gemini");
  assert.equal(el("ttsProvider").value, "gemini");
  assert.equal(el("translateModel").value, "gemini-3.1-flash-lite");
  assert.equal(el("ttsModel").value, "gemini-2.5-pro-preview-tts");
  assert.equal(el("voice").value, "Kore");
  assert.equal(el("modeByok").checked, true);
  assert.equal(el("modeManaged").checked, false);
});
