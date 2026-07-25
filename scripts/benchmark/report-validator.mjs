function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateReport(report, config) {
  const errors = [];
  if (!report || typeof report !== "object") return ["report:missing"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.priceDate || "")) errors.push("report.priceDate:missing");

  for (const required of config.translation) {
    const provider = report.translationProviders?.find((value) => value.providerId === required.id);
    if (!provider) {
      errors.push(`translation.${required.id}:missing-provider`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(provider.priceDate || "")) errors.push(`translation.${required.id}.priceDate:missing`);
    if (!provider.priceSourceUrl) errors.push(`translation.${required.id}.priceSourceUrl:missing`);
    if (!isNumber(provider.p95LatencyMs)) errors.push(`translation.${required.id}.p95LatencyMs:missing`);
    if (!isNumber(provider.projectedCogs300Vnd)) errors.push(`translation.${required.id}.projectedCogs300Vnd:missing`);
  }

  for (const required of config.tts) {
    const provider = report.ttsProviders?.find((value) => value.providerId === required.id);
    if (!provider) {
      errors.push(`tts.${required.id}:missing-provider`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(provider.priceDate || "")) errors.push(`tts.${required.id}.priceDate:missing`);
    if (!provider.priceSourceUrl) errors.push(`tts.${required.id}.priceSourceUrl:missing`);
    if (!isNumber(provider.listPrice)) errors.push(`tts.${required.id}.listPrice:missing`);
    if (!isNumber(provider.effectivePaidQuotaCharacters)) errors.push(`tts.${required.id}.effectivePaidQuotaCharacters:missing`);
    if (!isNumber(provider.p95FirstAudioMs)) errors.push(`tts.${required.id}.p95FirstAudioMs:missing`);
    if (!isNumber(provider.pronunciationScore)) errors.push(`tts.${required.id}.pronunciationScore:missing`);
    if (!isNumber(provider.projectedCogs300Vnd)) errors.push(`tts.${required.id}.projectedCogs300Vnd:missing`);
  }

  if (!report.selection || report.selection.fallbackTts === "pending" || !report.selection.fallbackTts) {
    errors.push("selection.fallbackTts:pending");
  }
  if (!report.selection || report.selection.ttsPrimary === "pending" || !report.selection.ttsPrimary) {
    errors.push("selection.ttsPrimary:pending");
  }
  return errors;
}
