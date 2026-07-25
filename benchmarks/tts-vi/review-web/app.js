const state = {
  manifest: null,
  reviewerId: "",
  order: [],
  responses: new Map()
};

const regionLabels = { north: "Miền Bắc", central: "Miền Trung", south: "Miền Nam" };
const reviewerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

const elements = {
  gate: document.getElementById("reviewer-gate"),
  reviewerId: document.getElementById("reviewer-id"),
  reviewerError: document.getElementById("reviewer-error"),
  startButton: document.getElementById("start-button"),
  reviewArea: document.getElementById("review-area"),
  samples: document.getElementById("samples"),
  progressText: document.getElementById("progress-text"),
  exportButton: document.getElementById("export-button"),
  resetButton: document.getElementById("reset-button"),
  exportStatus: document.getElementById("export-status")
};

function storageKey() {
  return `evoReviewWeb:${state.reviewerId}`;
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function saveProgress() {
  localStorage.setItem(storageKey(), JSON.stringify({
    order: state.order,
    responses: [...state.responses.entries()],
    updatedAt: new Date().toISOString()
  }));
}

function restoreProgress() {
  const raw = localStorage.getItem(storageKey());
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.order) || saved.order.length !== state.manifest.samples.length) return false;
    state.order = saved.order;
    state.responses = new Map(saved.responses);
    return true;
  } catch {
    return false;
  }
}

function canonicalRatings() {
  return [...state.responses.entries()]
    .map(([sampleId, value]) => ({
      sample_id: sampleId,
      mos: value.mos,
      severe_pronunciation_error: value.severe,
      notes: value.notes || ""
    }))
    .sort((left, right) => left.sample_id.localeCompare(right.sample_id));
}

async function checksumPayload() {
  const canonical = JSON.stringify({
    runId: state.manifest.runId,
    reviewerId: state.reviewerId,
    ratings: canonicalRatings()
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function download(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function completedCount() {
  return [...state.responses.values()].filter((value) => value.mos !== null && value.severe !== null).length;
}

function updateProgress() {
  const total = state.manifest.samples.length;
  const done = completedCount();
  elements.progressText.textContent = `${done}/${total}`;
  elements.exportButton.disabled = done !== total;
}

function responseFor(sampleId) {
  return state.responses.get(sampleId) || { mos: null, severe: null, notes: "" };
}

function setResponse(sampleId, patch) {
  const current = state.responses.get(sampleId) || { mos: null, severe: null, notes: "" };
  const next = { ...current, ...patch };
  state.responses.set(sampleId, next);
  saveProgress();
  updateProgress();
}

function renderSamples() {
  elements.samples.textContent = "";
  state.order.forEach((sampleIndex, position) => {
    const sample = state.manifest.samples[sampleIndex];
    const saved = responseFor(sample.sample_id);
    const card = document.createElement("article");
    card.className = "sample-card";
    card.dataset.sampleId = sample.sample_id;

    const heading = document.createElement("h3");
    heading.textContent = `Mẫu ${position + 1} / ${state.manifest.samples.length}`;
    card.appendChild(heading);

    const region = document.createElement("p");
    region.className = "region";
    region.textContent = `Vùng miền: ${regionLabels[sample.region] || sample.region}`;
    card.appendChild(region);

    const text = document.createElement("p");
    text.className = "sample-text";
    text.textContent = sample.text;
    card.appendChild(text);

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = sample.audio;
    card.appendChild(audio);

    const mosGroup = document.createElement("fieldset");
    const mosLegend = document.createElement("legend");
    mosLegend.textContent = "Mức độ tự nhiên (MOS 1-5)";
    mosGroup.appendChild(mosLegend);
    for (let score = 1; score <= 5; score += 1) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `mos-${sample.sample_id}`;
      input.value = String(score);
      input.checked = saved.mos === score;
      input.addEventListener("change", () => setResponse(sample.sample_id, { mos: score }));
      label.appendChild(input);
      label.append(` ${score}`);
      mosGroup.appendChild(label);
    }
    card.appendChild(mosGroup);

    const severeGroup = document.createElement("fieldset");
    const severeLegend = document.createElement("legend");
    severeLegend.textContent = "Có lỗi phát âm nghiêm trọng không?";
    severeGroup.appendChild(severeLegend);
    for (const [value, labelText] of [["false", "Không"], ["true", "Có"]]) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `severe-${sample.sample_id}`;
      input.value = value;
      input.checked = saved.severe === value;
      input.addEventListener("change", () => setResponse(sample.sample_id, { severe: value }));
      label.appendChild(input);
      label.append(` ${labelText}`);
      severeGroup.appendChild(label);
    }
    card.appendChild(severeGroup);

    const notesLabel = document.createElement("label");
    notesLabel.textContent = "Nhận xét (tùy chọn)";
    const notes = document.createElement("textarea");
    notes.rows = 2;
    notes.maxLength = 500;
    notes.value = saved.notes || "";
    notes.addEventListener("input", () => setResponse(sample.sample_id, { notes: notes.value }));
    notesLabel.appendChild(notes);
    card.appendChild(notesLabel);

    elements.samples.appendChild(card);
  });
}

async function startReview() {
  const reviewerId = elements.reviewerId.value.trim();
  elements.reviewerError.textContent = "";
  if (reviewerId.includes("@")) {
    elements.reviewerError.textContent = "Mã người đánh giá không được là địa chỉ email.";
    return;
  }
  if (!reviewerPattern.test(reviewerId)) {
    elements.reviewerError.textContent = "Mã chỉ gồm chữ cái, số, dấu gạch ngang hoặc gạch dưới, dài 2-40 ký tự.";
    return;
  }
  state.reviewerId = reviewerId;
  if (!restoreProgress()) {
    state.order = shuffle(state.manifest.samples.map((value, index) => index));
    state.responses = new Map();
    saveProgress();
  }
  elements.gate.hidden = true;
  elements.reviewArea.hidden = false;
  renderSamples();
  updateProgress();
}

async function exportResults() {
  elements.exportStatus.textContent = "";
  const total = state.manifest.samples.length;
  const done = completedCount();
  if (done !== total) {
    elements.exportStatus.textContent = `Bạn mới chấm ${done}/${total} mẫu.`;
    return;
  }
  const checksum = await checksumPayload();
  const submitted = JSON.parse(localStorage.getItem("evoReviewWebSubmitted") || "[]");
  if (submitted.includes(checksum)) {
    elements.exportStatus.textContent = "Bản nộp trùng lặp: kết quả này đã được xuất trước đó trên trình duyệt này.";
    return;
  }
  submitted.push(checksum);
  localStorage.setItem("evoReviewWebSubmitted", JSON.stringify(submitted));
  const payload = {
    schemaVersion: 1,
    runId: state.manifest.runId,
    reviewer_id: state.reviewerId,
    createdAt: new Date().toISOString(),
    sampleCount: total,
    ratings: canonicalRatings(),
    checksum
  };
  const stamp = payload.createdAt.replace(/[-:.]/g, "").slice(0, 15);
  const base = `review-export-${state.reviewerId}-${stamp}`;
  const csvRows = ["reviewer_id,sample_id,mos,pronunciation_score,severe_pronunciation_error,notes"];
  for (const rating of payload.ratings) {
    csvRows.push([
      state.reviewerId,
      rating.sample_id,
      rating.mos,
      rating.mos,
      rating.severe_pronunciation_error,
      rating.notes
    ].map(csvEscape).join(","));
  }
  download(`${base}.json`, `${JSON.stringify(payload, null, 2)}\n`, "application/json");
  download(`${base}.csv`, `${csvRows.join("\n")}\n`, "text/csv");
  elements.exportStatus.textContent = `Đã xuất kết quả, mã kiểm tra: ${checksum.slice(0, 12)}. Hãy gửi cả hai tệp cho ban tổ chức.`;
}

function resetProgress() {
  if (!state.reviewerId) return;
  localStorage.removeItem(storageKey());
  state.responses = new Map();
  renderSamples();
  updateProgress();
  elements.exportStatus.textContent = "Đã xóa dữ liệu tạm trên trình duyệt.";
}

async function boot() {
  const response = await fetch("manifest.json");
  if (!response.ok) {
    elements.reviewerError.textContent = "Không tải được manifest.json, hãy chạy trang qua HTTP server.";
    return;
  }
  state.manifest = await response.json();
  document.querySelectorAll(".sample-count").forEach((element) => {
    element.textContent = String(state.manifest.samples.length);
  });
  elements.startButton.addEventListener("click", startReview);
  elements.exportButton.addEventListener("click", exportResults);
  elements.resetButton.addEventListener("click", resetProgress);
}

boot().catch(() => {
  elements.reviewerError.textContent = "Không khởi tạo được trang đánh giá, hãy chạy qua HTTP server.";
});
