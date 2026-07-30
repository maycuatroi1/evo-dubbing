# DEPLOY - external services, credentials, rotation

Mọi secret thật đi qua credential store (`evo cred`, `~/.omelet.d/credentials/`) và deployment env.
Git chỉ chứa tên biến và dashboard location. Owner mọi mục: Bình (sometimesocrazy@gmail.com) trừ khi ghi khác.

## Chrome Extension

| Mục | Giá trị | Ghi chú |
|-----|---------|---------|
| Item ID (hiện tại, chỉ dev) | `ligchebgiheiildjcnndjoalkpiamgko` | Suy ra từ cặp khoá tự tạo 2026-07-26. Dùng cho bản unpacked. **Không phải ID trên store** |
| Item ID (store) | Chưa có | Sinh ra khi tạo item lần đầu trên CWS. Xem quy trình bên dưới |
| Public key | Trong `extension/manifest.config.ts` (field `key`) | Public, an toàn khi open-source |
| Private key | `evo cred get evo_dubbing.chrome_extension_private_key` | PEM, KHÔNG commit; cần khi ký/publish ngoài CWS |

### Item ID đi theo chiều nào

Trước 2026-07-26 mục này ghi "CWS giữ nguyên ID này khi upload vì manifest có `key`". **Sai.** Tài liệu
Chrome (`developer.chrome.com/docs/extensions/reference/manifest/key`) mô tả chiều ngược lại: upload zip
**không có** field `key`, CWS gán cặp khoá và Item ID, rồi bạn vào **Package -> View public key**, copy về
dán vào manifest để bản unpacked dùng chung ID đó. Khoá đi từ store về repo.

Hệ quả: khi tạo item trên store, Item ID sẽ khác `ligchebgiheiildjcnndjoalkpiamgko`, và ba thứ neo vào
ID cũ phải làm lại cùng lúc:

1. OAuth client type Chrome Extension (`GOOGLE_OAUTH_CHROME_CLIENT_ID` bên dưới) - tạo client mới
2. Supabase redirect allowlist `https://<ITEM_ID>.chromiumapp.org/`
3. `PAYOS_RETURN_URL_ALLOWLIST` phần `chrome-extension://<ITEM_ID>`

Thứ tự đúng: tạo item trên CWS trước, lấy Item ID thật, rồi mới cấu hình ba mục trên. Làm ngược sẽ phải
làm hai lần.

### Publish lần đầu (owner-manual, CWS Dashboard không script được)

Chrome chặn mọi automation trên domain Web Store nên các bước này bắt buộc làm tay:

1. Tài khoản developer + bật 2-Step Verification (CWS yêu cầu trước khi publish), trả phí đăng ký một lần
2. `npm run build:ext`, zip **nội dung** `extension/dist`
3. Dashboard -> Add new item -> upload, chưa publish. Lấy public key ở tab Package, dán vào `key`
4. Làm ba mục ở phần trên theo Item ID mới
5. Điền listing: nội dung đã soạn sẵn trong `docs/CWS-LISTING.md` (single purpose, justification từng
   permission, data usage declaration). Privacy policy: `web/privacy.html`, deploy qua Pages tới
   `https://maycuatroi1.github.io/evo-dubbing/privacy.html`
6. Publish tay ít nhất một lần. API không publish được cho tới khi visibility đã được set tay một lần

### CI/CD (`.github/workflows/release.yml`, job `chrome-web-store`)

Chạy khi push tag `v*`. Đổi refresh token lấy access token, `:upload`, rồi `:publish` nếu repo variable
`CWS_AUTO_PUBLISH` = `true` (mặc định không set: upload thành draft).

| Secret (GitHub Environment `chrome-web-store`) | Lấy ở đâu |
|---|---|
| `CWS_CLIENT_ID` | OAuth client "evo-dubbing CWS Deploy", type **Web application**, tạo 2026-07-26 |
| `CWS_CLIENT_SECRET` | Cùng client. Google chỉ cho xem một lần lúc tạo |
| `CWS_REFRESH_TOKEN` | OAuth Playground với credentials trên, scope `https://www.googleapis.com/auth/chromewebstore` |
| `CWS_PUBLISHER_ID` | Dashboard -> Publisher -> Settings |
| `CWS_ITEM_ID` | Item ID trên store (mục trên) |

Chrome Web Store API đã enable trên project `omelet-f0b89` (2026-07-26). OAuth consent screen đã ở
**In production** - quan trọng, vì ở trạng thái Testing thì Google cho refresh token hạn 7 ngày và CI sẽ
chết với `invalid_grant` sau đúng một tuần.

Manifest version chảy từ tag: `EXT_VERSION` được set trong workflow, `manifest.config.ts` cắt tiền tố `v`
và validate định dạng. CWS từ chối upload nếu version không cao hơn bản đã publish.

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

Redirect URLs (Authentication -> Sign In/Providers -> URL Configuration -> Redirect URLs) phải allowlist `https://ligchebgiheiildjcnndjoalkpiamgko.chromiumapp.org/` để flow `chrome.identity.launchWebAuthFlow` của extension (step 12) hoàn tất.

Extension đọc publishable key lúc build qua env `VITE_SUPABASE_PUBLISHABLE_KEY` (xem `extension/src/lib/managed/config.ts`), KHÔNG commit giá trị thật:

```powershell
$env:VITE_SUPABASE_PUBLISHABLE_KEY = (evo cred get evo_dubbing.supabase_publishable_key); npm run build:ext
```

### Live auth check (owner-only, manual, step 12 verify)

Chỉ owner chạy được vì cần Chrome profile thật + tài khoản Google + Supabase project. Điều kiện: redirect URL đã allowlist ở trên, extension build có publishable key.

1. Build extension với publishable key như trên, load unpacked `extension/dist` vào `chrome://extensions` (Developer mode). Kiểm tra Item ID dưới tên extension phải là `ligchebgiheiildjcnndjoalkpiamgko`.
2. Mở service worker console (chrome://extensions -> evo-dubbing -> "Service worker" -> Inspect) và chạy: `chrome.runtime.sendMessage({ type: "auth.signIn" }, console.log)`.
3. Popup Google sign-in mở ra; đăng nhập bằng tài khoản Google của owner. Kỳ vọng: `launchWebAuthFlow` redirect về `https://ligchebgiheiildjcnndjoalkpiamgko.chromiumapp.org/#access_token=...`, response `{ ok: true, data: { signedIn: true, expiresAt: ... } }`.
4. Verify Google ID token đúng Item ID: trong tab Network của service worker, request tới `accounts.google.com` phải mang `client_id=401458936175-sofsattbm8g3t3qcjjgb1c333eo97k9h.apps.googleusercontent.com` (OAuth client gắn với Item ID trên).
5. Verify Supabase tạo session: `chrome.storage.local.get("evoDubbingManagedSession", console.log)` trong service worker console phải thấy `accessToken`/`refreshToken`/`expiresAt`. Supabase dashboard -> Authentication -> Users phải có user mới (hoặc sign-in mới) với provider `google`.
6. Verify refresh: chạy `chrome.runtime.sendMessage({ type: "auth.refresh" }, console.log)` -> `{ ok: true, data: { signedIn: true } }` và `expiresAt` tăng.
7. Verify sign-out: `chrome.runtime.sendMessage({ type: "auth.signOut" }, console.log)` rồi `chrome.storage.local.get("evoDubbingManagedSession", console.log)` phải rỗng.
8. Boundary: mở youtube.com bất kỳ, DevTools của trang (không phải service worker) chạy `chrome.storage.local.get("evoDubbingManagedSession", console.log)` phải trả về rỗng/undefined vì content script không bao giờ đọc key này (secret-boundary check ép ở mức source).

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

## Manual UX matrix (owner-only, step 13 verify)

Chỉ owner chạy được vì cần Chrome profile thật + Supabase + PayOS. Điều kiện: extension build có publishable key, server có `MANAGED_INFERENCE_ENABLED=1`, `MANAGED_TRIAL_ENABLED=1`, `MANAGED_CHECKOUT_ENABLED=1` (trừ case kiểm tra flag tắt). Mọi state phải hiển thị tiếng Việt đúng commercial contract (docs/BUSINESS_MODEL.md) và TUYỆT ĐỐI không có chữ auto-renew / tự động gia hạn / tự động trừ tiền.

| # | State | Cách dựng | Kỳ vọng |
|---|-------|-----------|---------|
| 1 | Fresh install | Load unpacked lần đầu | Options mở, mặc định BYOK, managed card hiển thị nút "Đăng nhập bằng Google" + note BYOK không cần tài khoản |
| 2 | Existing BYOK settings | Cài đè lên profile đã có API key + provider settings | API key, provider, model, voice giữ nguyên; managed card chỉ là tùy chọn, không ép đăng nhập |
| 3 | Trial | Sign in Google, chưa mua gói | Managed card: "Đang dùng thử miễn phí", còn X/15 phút nguồn, nút PayOS |
| 4 | Active | Tài khoản có period active | Card hiển thị phút còn lại, ngày kết thúc chu kỳ, copy gia hạn thủ công |
| 5 | Queued renewal | Tài khoản đã trả thêm 1 lần khi còn active | Card hiển thị "Đã xếp lịch gia hạn", ngày bắt đầu chu kỳ mới, note không cộng dồn |
| 6 | Expired | Trial hết + không còn period | Card hiển thị "Đã hết quota managed" + CTA PayOS + gợi ý BYOK |
| 7 | Insufficient quota | Tài khoản sắp hết phút, Share full dub dài | Overlay chặn completeAll với ước tính phút nguồn cần vs còn, CTA PayOS + BYOK |
| 8 | Budget disabled | Tắt `MANAGED_INFERENCE_ENABLED` | Card hiển thị "Managed đang tạm tắt" + hướng dẫn dùng BYOK; overlay lỗi 503 có nút mở cài đặt BYOK |
| 9 | Provider outage | Server trả 503 cho inference | Overlay hiển thị "Dịch vụ managed tạm thời gián đoạn" + nút mở cài đặt BYOK |
| 10 | Session expired | Token hết hạn, dub managed | Overlay lỗi 401 + nút "Đăng nhập lại", đăng nhập xong Re-dub được |
| 11 | PayOS checkout | Bấm "Tạo link thanh toán PayOS" | Tab mới mở checkoutUrl PayOS, amount 199.000 VND; sau thanh toán "Làm mới trạng thái" phản ánh period mới |

Mọi màn hình managed phải có: giá 199.000 VND, khoảng 300 phút nguồn / 30 ngày, gia hạn thủ công, không cộng dồn, đo theo phút nguồn, disclosure "Giọng đọc do AI tạo ra".

## Mailgun - creator outreach (step 15, owner-only)

Dashboard: https://app.mailgun.com. Chỉ phục vụ creator outreach, không chặn auth/billing.

Code đã xong (step 15): extension gửi `POST /api/v1/events/playback` (không auth, chỉ random installation ID; server HMAC install ID với key xoay theo ngày `PRODUCT_EVENT_HMAC_SECRET`, dedupe per (video, day, hashed install), chỉ giữ daily aggregate `playback_daily_totals` lâu dài). Video đạt 1.000 deduped playback starts tạo đúng 1 `creator_outreach` pending. Admin page `/admin` (yêu cầu Supabase access token có email trong `ADMIN_EMAIL_ALLOWLIST`) cho operator tự mở trang Business Inquiry của kênh, nhập email creator đang công khai (YouTube Data API không cung cấp email và plan cấm scrape), duyệt template rồi gửi qua Mailgun; email notice nói rõ video vẫn phát bình thường trên YouTube kèm signed takedown URL (HMAC `TAKEDOWN_TOKEN_SECRET`, TTL `TAKEDOWN_TOKEN_TTL_HOURS`). `GET /api/v1/takedown?token=...` unpublish ngay mọi public dub của source video + ghi audit `takedown_requests`; restore thủ công qua `POST /api/v1/admin/takedown/restore` (admin, audited).

| Biến | Trạng thái |
|------|-----------|
| `MAILGUN_API_KEY` | Pending |
| `MAILGUN_DOMAIN` | Pending |
| `MAILGUN_FROM` | Pending |
| `PRODUCT_EVENT_HMAC_SECRET` | Pending - random 32+ bytes, `evo cred` + deployment env |
| `TAKEDOWN_TOKEN_SECRET` | Pending - random 32+ bytes, `evo cred` + deployment env |
| `TAKEDOWN_TOKEN_TTL_HOURS` | Mặc định 720 (30 ngày) |
| `ADMIN_EMAIL_ALLOWLIST` | CSV email admin, ví dụ `sometimesocrazy@gmail.com` |
| `OUTREACH_BASE_URL` | Production URL của server (dùng build takedown link trong email) |

Các bước owner còn phải làm (không làm được từ repo):

1. Tạo tài khoản Mailgun tại https://signup.mailgun.com (free tier đủ cho outreach volume thấp).
2. Thêm sending domain (khuyến nghị subdomain dạng `mg.<domain>`), trỏ DNS records (TXT/MX/CNAME) theo Mailgun dashboard và chờ verify xanh.
3. Lấy `MAILGUN_API_KEY` (Settings -> API Keys -> Private API key), đặt `MAILGUN_DOMAIN` và `MAILGUN_FROM` (ví dụ `evo-dubbing <outreach@mg.<domain>>`) vào credential store (`evo cred`) và deployment env. KHÔNG commit giá trị thật.
4. Sinh `PRODUCT_EVENT_HMAC_SECRET` và `TAKEDOWN_TOKEN_SECRET` (ví dụ `openssl rand -hex 32`), nạp vào credential store và deployment env.
5. Đặt `ADMIN_EMAIL_ALLOWLIST` = email Google của owner (khớp claim `email` trong Supabase access token) và `OUTREACH_BASE_URL` = production URL.
6. Gửi test tới owner để verify DNS + key trước khi outreach thật:

```powershell
$key = evo cred get evo_dubbing.mailgun_api_key
curl.exe -s --user "api:$key" https://api.mailgun.net/v3/<MAILGUN_DOMAIN>/messages -F from="evo-dubbing <outreach@<MAILGUN_DOMAIN>>" -F to="sometimesocrazy@gmail.com" -F subject="evo-dubbing mailgun test" -F text="Mailgun sending domain OK."
```

Kỳ vọng: response JSON có `id`, email tới hộp thư owner (kiểm tra cả spam), Mailgun dashboard -> Logs hiện delivered.

## Provider thắng benchmark (server credentials, nạp qua deployment env ở step 18)

| Vai trò | Provider | Biến env server |
|---------|----------|-----------------|
| TTS primary | google-gemini-tts (gemini-2.5-flash-preview-tts, voice Kore) | `GOOGLE_API_KEY` |
| TTS fallback | google-wavenet (vi-VN-Wavenet-A) | `GOOGLE_TTS_API_KEY` |
| Translation primary | gemini-3.1-flash-lite | `GOOGLE_API_KEY` |

Quyết định benchmark: docs/PROGRESS.md mục 2026-07-25 step 4.
