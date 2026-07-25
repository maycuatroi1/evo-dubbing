# Business Model

## Contract status

This document is the source of truth for the managed dubbing MVP. Schema, API, usage accounting, payment handling, and UI copy must implement these terms without redefining pricing, quota, or source-time measurement.

## Customer and product

The initial customer is a Vietnamese-speaking viewer who watches English-language knowledge videos and wants a Vietnamese voice-over. The product keeps the existing bring-your-own-key mode and adds an opt-in managed mode for viewers who do not want to configure provider credentials.

## Service modes

### Bring your own key

Bring-your-own-key, or BYOK, remains available with the settings and workflows that existed before managed mode. A BYOK viewer can continue to call the selected provider directly from the extension without buying a managed plan, consuming a managed trial, or sending a provider key to the server. Managed mode must not overwrite, clear, migrate, or reinterpret existing provider settings.

### Managed dubbing

Managed dubbing uses service-owned provider credentials. Its quota is measured in source milliseconds and is consumed only by successful managed cue generation. Managed mode has one trial offer and one paid plan.

| Term | Contract |
| --- | --- |
| Trial | One lifetime grant of 15 source minutes, equal to 900,000 source milliseconds |
| Trial renewal | Never replenished or granted a second time |
| Paid price | 199,000 VND |
| Paid quota | 300 source minutes, equal to 18,000,000 source milliseconds |
| Paid period | 30 consecutive days from activation |
| Renewal | Manual, through a new user-initiated PayOS payment |
| Rollover | None; unused paid quota expires with its period |
| Local cache hit | Free |
| Shared lookup hit | Free |
| Beta provider budget | Maximum USD 100 per UTC calendar month across managed usage |

## Source-time accounting

One source minute is exactly 60,000 source milliseconds. For a successfully generated managed cue, usage is `max(0, sourceEndMs - sourceStartMs)`. Translation length, generated audio length, playback speed, replays, and wall-clock provider latency do not change this amount.

A cue is charged only after managed generation succeeds and makes its audio result available. Failed, cancelled, or timed-out generation consumes zero quota. A local cache hit or shared lookup hit performs no managed generation and consumes zero quota.

Every managed generation attempt carries a stable usage idempotency key that is reused for retries of the same cue. Within the same trial grant or paid period, that key can create at most one successful debit. Retrying a successful request returns the prior result and cannot debit quota again.

The service must reject generation before a debit that would exceed the remaining trial or paid quota. Usage cannot be borrowed from a future payment or transferred from an expired paid period.

## PayOS activation

Only a verified successful PayOS payment for exactly 199,000 VND activates the paid plan. The first accepted success event for an order creates exactly one entitlement period with 18,000,000 source milliseconds. The period starts at that activation and ends exactly 30 consecutive days later.

The PayOS order identity is the payment idempotency boundary. Duplicate, delayed, or retried webhooks for the same order return the existing activation and never create another period or add quota. A renewal requires a new user-initiated order. The service does not auto-charge. Unused quota from an earlier period is never added to a later period.

## Beta budget cap

Managed provider spend has a global hard cap of USD 100 per UTC calendar month. The service must fail closed and stop new paid provider generation before a call that would make reserved or recorded monthly spend exceed the cap. BYOK calls, local cache hits, and shared lookup hits do not count toward this service-funded budget.

## Managed provider selection and unit economics

Benchmark 2026-07-25 (corpus 30 câu tiếng Việt, `benchmarks/tts-vi/artifacts/latest-report.json`) chốt nhà cung cấp managed:

| Role | Provider | COGS 300 source minutes |
| --- | --- | --- |
| TTS primary | google-gemini-tts (gemini-2.5-flash-preview-tts, giọng Kore) | ~110,700 VND |
| TTS fallback | google-wavenet (vi-VN-Wavenet-A) | ~27,800 VND |
| Translation primary | gemini-flash-lite | ~4,000 VND |

Tổng COGS dự kiến ~114,700 VND cho một gói 300 phút, giá bán 199,000 VND, biên gộp ~84,300 VND (~42%) trước phí PayOS. Ngưỡng acceptance do owner phê duyệt 2026-07-25: MOS tối thiểu 3.0, severe pronunciation error tối đa 5%, p95 first-audio tối đa 8 giây, COGS tối đa 130,000 VND/300 phút, tối thiểu 1 reviewer Việt. Giá bán được điều chỉnh từ 99,000 lên 199,000 VND cùng ngày vì COGS TTS chất lượng cao vượt giá cũ.

## Public sharing and takedown

A dub cannot become public until its uploader explicitly asserts that they have the rights required to publish the derived audio. The assertion must be stored with the publication action. Public listings and playback pages must display that the dub is AI-generated.

A takedown request must carry a valid server-verifiable signature. An accepted signed takedown makes the dub unavailable from public listings, public lookup, and public playback. Repeating the same valid request is safe, while an unsigned or invalidly signed request cannot remove content.
