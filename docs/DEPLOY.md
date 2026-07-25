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

## PayOS - CHƯA HOÀN TẤT

Dashboard: https://my.payos.vn (cần đăng ký merchant + KYC trước)

| Biến | Trạng thái |
|------|-----------|
| `PAYOS_CLIENT_ID` | Pending - sau khi tạo payment channel |
| `PAYOS_API_KEY` | Pending |
| `PAYOS_CHECKSUM_KEY` | Pending (verify webhook HMAC) |
| Webhook URL | Pending - cần server production URL (step 18): `POST {server}/api/v1/billing/payos/webhook`, sau đó chạy confirm-webhook |

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
