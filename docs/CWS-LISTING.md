# CWS-LISTING - nội dung khai báo khi submit lên Chrome Web Store

Chuẩn bị sẵn để copy vào Developer Dashboard. Khai sai ở phần data usage là lý do bị gỡ, không phải
lỗi nhỏ, nên mỗi dòng dưới đây phải khớp với code và với `web/privacy.html`.

Privacy policy URL: `https://maycuatroi1.github.io/evo-dubbing/privacy.html`

Deploy bằng `.github/workflows/pages.yml` (copy `web/*.html`). URL phải sống được mà không cần đăng
nhập trước khi submit.

## Single purpose

> evo-dubbing reads the captions of the YouTube video you are watching, translates them into a
> language you choose, synthesises speech from the translation, and plays that speech alongside the
> video. That is its only function.

## Justification từng permission

| Permission | Justification để dán vào form |
|---|---|
| `storage` | Stores your settings, your own API keys, and your sign-in session on your device so they persist between sessions. Nothing in storage is transmitted to our servers. |
| `identity` | Used only for `chrome.identity.launchWebAuthFlow` to sign you in with Google when you opt into managed mode. Scopes are limited to openid, email, profile. |
| `https://www.youtube.com/*` | The extension runs on YouTube. It reads the video's caption track and mounts its own playback panel there. This is where the single purpose happens. |
| `https://*.googlevideo.com/*` | YouTube serves caption tracks and media from this domain. Without it the caption fetch fails. |
| `https://api.openai.com/*` | Called directly with your own API key when you use bring-your-own-key mode with OpenAI. |
| `https://generativelanguage.googleapis.com/*` | Called directly with your own API key when you use bring-your-own-key mode with Google Gemini. |
| `https://*.supabase.co/*` | Authentication and session refresh for managed mode. |
| `optional_host_permissions: https://*/*` | Requested at runtime only if you point the extension at your own self-hosted server. The address is chosen by you, so it cannot be declared narrowly in advance. Chrome prompts you and you may decline; the default server never triggers this. |

Không khai `scripting` và `activeTab` - đã gỡ 2026-07-26 vì không có chỗ nào dùng
`chrome.scripting` / `chrome.tabs` / `chrome.action`. Chính sách CWS cấm xin permission để "future
proof".

## Data usage declaration

| Loại dữ liệu trên form | Khai | Vì sao |
|---|---|---|
| Personally identifiable information | **Có** | Email và tên hiển thị Google, chỉ khi user chủ động đăng nhập managed mode |
| Health information | Không | |
| Financial and payment information | Không | PayOS xử lý trên trang của họ; extension và server không bao giờ thấy dữ liệu thẻ |
| Authentication information | **Có** | Khoá API của user và Supabase token - lưu local, không gửi tới server của mình |
| Personal communications | Không | |
| Location | Không | |
| Web history | Không | Chỉ biết video mà user chủ động lồng tiếng, không thu lịch sử duyệt web |
| User activity | **Có** | Playback event: videoId, platform, channel, install ID ngẫu nhiên đã HMAC |
| Website content | **Có** | Nội dung phụ đề của video, gửi đi để dịch và tạo giọng |

Ba certification bắt buộc đều tick được:

- Không bán hay chuyển dữ liệu cho bên thứ ba ngoài các trường hợp đã nêu trong privacy policy
- Không dùng hay chuyển dữ liệu cho mục đích không liên quan tới single purpose ở trên
- Không dùng hay chuyển dữ liệu để xác định khả năng tín dụng hoặc cho mục đích cho vay

## Tuyên bố retention đang treo trên một sự thật có thể đổi

`web/privacy.html` mục 10 nói phụ đề gửi đi dịch "xử lý xong thì bỏ, không lưu thành bản ghi lâu dài".
Kiểm chứng 2026-07-26: đúng. Các bảng thực sự được INSERT là `dubs`, `dub_segments`,
`playback_daily_totals`, `playback_event_dedupe`, `payments`, `subscription_periods`,
`creator_outreach`, `takedown_requests`. Không có bảng nào nhận nội dung phụ đề ngoài luồng share mà
user tự bấm.

**Nhưng** `inference_requests` đã có sẵn trong schema với cột `result text` và unique index trên
`request_key` - đúng hình dạng của một cache kết quả theo idempotency key. Hiện chưa có code nào ghi
vào nó. Ngày ai đó bật dedupe lên, bản dịch sẽ được lưu lâu dài và **câu trong privacy policy thành
sai** mà không có gì báo. Nếu bật, sửa mục 10 của privacy policy trong cùng commit.

Quan sát phụ, không thuộc privacy: `usage_events` cũng chỉ được SELECT, chưa có INSERT nào. Phần tính
hạn mức đang cộng trên một bảng rỗng. Đáng kiểm tra riêng.

## Điểm sẽ bị review kỹ

**Trích phụ đề từ YouTube.** Extension đọc `timedtext` và proxy qua service worker. Nó không tải video
xuống và không lưu media của YouTube; giọng đọc tạo ra phát tại chỗ cùng video đang chạy. CWS đã gỡ
nhiều extension đụng vào luồng dữ liệu YouTube, nên chuẩn bị lập luận này trước, và biết trước đây là
chỗ dễ vướng nhất. Cơ chế takedown cho chủ kênh (`/api/v1/takedown`) là điểm cộng nên nêu.

**`https://*/*` optional.** Reviewer sẽ hỏi. Lý do nằm ở bảng trên: self-host, địa chỉ do user chọn.

**Chính sách mới hiệu lực 01/08/2026.** Limited Use siết lại: mọi dữ liệu thu thập phải *strictly
necessary* cho single purpose. Disclosure Requirements: mọi thu thập phải disclose nổi bật kể cả khi
liên quan chặt tới mục đích chính. Playback event là mục cần chú ý nhất ở đây - nó đã được nêu ở mục 6
của privacy policy, và cần nêu cả trong phần mô tả trên store listing chứ không chỉ trong policy.
