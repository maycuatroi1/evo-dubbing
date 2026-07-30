import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "https://nghe.omelet.tech").replace(/\/$/, "");
const statePath = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e", ".seed-state.json");

const VIDEO_ID = "e2e_fixture_dub";
const CUES = [
  { idx: 0, startMs: 0, endMs: 4000, text: "Xin chào, đây là bản dub thử nghiệm.", freq: 440 },
  { idx: 1, startMs: 4000, endMs: 8000, text: "Bản dub này do script e2e tạo ra.", freq: 550 },
  { idx: 2, startMs: 8000, endMs: 12000, text: "Bạn có thể xoá nó bằng script cleanup.", freq: 660 }
];

function sineWav(seconds, freq) {
  const rate = 8000;
  const samples = Math.floor(rate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const envelope = Math.min(1, 10 * Math.min(t, seconds - t));
    const value = Math.round(Math.sin(2 * Math.PI * freq * t) * 12000 * Math.max(0, envelope));
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  return buffer;
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const res = await fetch(`${BASE_URL}/api/dubs/${state.dubId}`);
    if (res.ok) {
      console.log(`seed ok: dub ${state.dubId} already exists at ${BASE_URL}/dub/${state.dubId}`);
      return;
    }
  }

  const init = await api("/api/dubs/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      platform: "youtube",
      videoId: VIDEO_ID,
      sourceLang: "en",
      targetLang: "vi",
      voice: "e2e",
      provider: "e2e",
      title: "E2E Fixture Dub - thu vien evo-dubbing",
      durationMs: 12000,
      visibility: "public",
      segments: CUES.map((cue) => ({
        idx: cue.idx,
        startMs: cue.startMs,
        endMs: cue.endMs,
        originalText: "e2e fixture line",
        text: cue.text,
        mime: "audio/wav"
      }))
    })
  });

  for (const [i, upload] of init.uploads.entries()) {
    const wav = sineWav((CUES[i].endMs - CUES[i].startMs) / 1000, CUES[i].freq);
    const res = await fetch(upload.putUrl, {
      method: "PUT",
      headers: { "content-type": "audio/wav" },
      body: wav
    });
    if (!res.ok) throw new Error(`upload segment ${upload.idx} -> ${res.status}`);
  }

  await api(`/api/dubs/${init.id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerToken: init.ownerToken })
  });

  writeFileSync(statePath, JSON.stringify({ dubId: init.id, ownerToken: init.ownerToken }, null, 2));
  console.log(`seed ok: dub ${init.id} ready at ${BASE_URL}/dub/${init.id}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
