# DEPLOY - external services, credentials, rotation

Mọi secret thật đi qua credential store (`evo cred`, `~/.omelet.d/credentials/`) và deployment env.
Git chỉ chứa tên biến và dashboard location. Owner mọi mục: Bình (sometimesocrazy@gmail.com) trừ khi ghi khác.

## Chrome Extension

| Mục | Giá trị | Ghi chú |
|-----|---------|---------|
| Item ID | `ligchebgiheiildjcnndjoalkpiamgko` | Suy ra từ public key nhúng trong `extension/manifest.config.ts`; CWS giữ nguyên ID này khi upload vì manifest có `key` |
| Public key | Trong `extension/manifest.config.ts` (field `key`) | Public, an toàn khi open-source |
| Private key | `evo cred get evo_dubbing.chrome_extension_private_key` | PEM, KHÔNG commit; cần khi ký/publish ngoài CWS |
| Rotation | Nếu mất private key: tạo cặp mới -> Item ID đổi -> phải tạo OAuth client mới và update CWS item (tránh bằng mọi giá) | Tạo lần đầu 2026-07-26 |

## Google Cloud (project `omelet-f0b89`)

Dashboard: https://console.cloud.google.com/auth/clients?project=omelet-f0b89

| Biến | Giá trị / vị trí | Rotation |
|------|------------------|----------|
| `GOOGLE_OAUTH_CHROME_CLIENT_ID` | `401458936175-sofsattbm8g3t3qcjjgb1c333eo97k9h.apps.googleusercontent.com` (OAuth client "evo-dubbing Chrome Extension", type Chrome Extension, Item ID trên) | Console -> Clients -> tạo mới, update Supabase Google provider Client IDs |
| OAuth client secret | Không có (Chrome Extension type không cấp secret) | - |
| `GOOGLE_API_KEY` (Gemini, translation + gemini-tts) | `evo cred get google_api_key` | AI Studio / GCP Credentials |
| `GOOGLE_TTS_API_KEY` (Cloud TTS WaveNet fallback) | `evo cred get google_tts_api_key` (key "Evo Dubbing TTS", restricted Cloud Text-to-Speech API) | GCP Credentials -> regenerate |

Scopes consent screen: openid, email, profile (non-sensitive, không cần verify).

## Supabase (project `lrypactuodbguwncoomc`)

Dashboard: https://supabase.com/dashboard/project/lrypactuodbguwncoomc

| Biến | Giá trị / vị trí | Rotation |
|------|------------------|----------|
| `SUPABASE_URL` | https://lrypactuodbguwncoomc.supabase.co | - |
| `SUPABASE_PUBLISHABLE_KEY` | `evo cred get evo_dubbing.supabase_publishable_key` (`sb_publishable_...`) | Settings -> API Keys -> roll |
| `SUPABASE_SECRET_KEY` | `evo cred get supabase.evo_dubbing.secret_key` (`sb_secret_...`, server-only) | Settings -> API Keys -> roll |
| `DATABASE_URL` | `evo cred get supabase.evo_dubbing.database_url` (pooler 6543) | Settings -> Database -> reset password |
| Google provider | Authentication -> Sign In/Providers -> Google: Enabled, Client IDs = OAuth client ID trên | Update khi OAuth client đổi |

## PayOS - CHƯA HOÀN TẤT (external setup thuộc step 9, owner-only)

Dashboard: https://my.payos.vn (cần đăng ký merchant + KYC trước)

Code đã xong (step 9): `POST /api/v1/billing/checkout` (tạo payment link, chỉ plan `vi_monthly_300` = 199.000 VND) và `POST /api/v1/billing/webhooks/payos` (verify HMAC_SHA256 bằng checksum key, activate 1 subscription period 30 ngày, dedupe retry). Subscription MVP là entitlement 30 ngày theo payment-link model, KHÔNG phải auto-debit; Options UI (step 13) tạo payment link mới mỗi lần ngưới dùng chủ động gia hạn.

| Biến | Trạng thái |
|------|-----------|
| `PAYOS_CLIENT_ID` | Pending - sau khi tạo payment channel; nạp vào `evo cred` rồi deployment env |
| `PAYOS_API_KEY` | Pending |
| `PAYOS_CHECKSUM_KEY` | Pending (ký create-payment-link + verify webhook HMAC) |
| `PAYOS_RETURN_URL_ALLOWLIST` | Đặt khi có production URL, dạng CSV origin/path, ví dụ `https://<domain>/billing,chrome-extension://ligchebgiheiildjcnndjoalkpiamgko` |
| `PAYOS_CHECKOUT_EXPIRY_SEC` | Mặc định 900 (15 phút) |
| Webhook URL | Pending - cần server production URL (step 18): `POST {server}/api/v1/billing/webhooks/payos` |

Các bước owner còn phải làm (không làm được từ repo):

1. Đăng ký merchant PayOS + hoàn tất KYC tại https://my.payos.vn.
2. Tạo payment channel (kênh thanh toán), lấy `PAYOS_CLIENT_ID` / `PAYOS_API_KEY` / `PAYOS_CHECKSUM_KEY` vào credential store (`evo cred`) và deployment env. KHÔNG commit giá trị thật.
3. Sau khi server có production URL: đăng ký webhook `https://<domain>/api/v1/billing/webhooks/payos` trong PayOS dashboard rồi gọi confirm-webhook để PayOS chấp nhận URL.
4. Bật `MANAGED_CHECKOUT_ENABLED=1` và đặt `PAYOS_RETURN_URL_ALLOWLIST` đúng domain production trước khi mở checkout.
5. Verify bằng một live payment do owner kiểm soát: đối chiếu PayOS dashboard, webhook log server và `GET /api/v1/account` (periods phải có đúng 1 period 30 ngày).

## Mailgun - HOÃN ĐẾN STEP 15

Dashboard: https://app.mailgun.com (chưa có tài khoản). Chỉ phục vụ creator outreach (step 15), không chặn auth/billing.

| Biến | Trạng thái |
|------|-----------|
| `MAILGUN_API_KEY` | Pending |
| `MAILGUN_DOMAIN` | Pending |
| `MAILGUN_FROM` | Pending |

## Provider thắng benchmark (server credentials, nạp qua deployment env ở step 18)

| Vai trò | Provider | Biến env server |
|---------|----------|-----------------|
| TTS primary | google-gemini-tts (gemini-2.5-flash-preview-tts, voice Kore) | `GOOGLE_API_KEY` |
| TTS fallback | google-wavenet (vi-VN-Wavenet-A) | `GOOGLE_TTS_API_KEY` |
| Translation primary | gemini-3.1-flash-lite | `GOOGLE_API_KEY` |

Quyết định benchmark: docs/PROGRESS.md mục 2026-07-25 step 4.
