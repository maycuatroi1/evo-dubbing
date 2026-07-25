# Gói đánh giá mù TTS tiếng Việt qua web

Gói web tĩnh này phục vụ việc thu điểm mù (blind MOS) từ tối thiểu 5 người Việt cho run `20260725T074812948Z`. Trang không chứa nhãn provider; thứ tự 30 mẫu được xáo trộn ngẫu nhiên cho mỗi người đánh giá.

## Chuẩn bị gói

```powershell
npm run benchmark:review:web
```

Lệnh này đọc blind review đã chuẩn bị trong `benchmarks/tts-vi/artifacts/reviews/`, sao chép audio vào `review-web/audio/` và sinh `manifest.json` không chứa nhãn provider. Audio gốc trong artifacts không bị thay đổi.

## Phục vụ gói cho người đánh giá

```powershell
npm run benchmark:review:web:serve
```

Trang chạy tại `http://localhost:8173/`. Có thể dùng bất kỳ static HTTP server nào khác; không mở trực tiếp bằng `file://` vì trình duyệt chặn tải `manifest.json`.

## Quy trình của người đánh giá

1. Nhận mã người đánh giá từ ban tổ chức (không dùng email).
2. Mở trang, nhập mã, nhấn "Bắt đầu đánh giá".
3. Nghe từng mẫu, chấm MOS 1-5, đánh dấu lỗi phát âm nghiêm trọng nếu có, nhận xét tùy chọn.
4. Tiến trình tự lưu trên trình duyệt, có thể đóng và mở lại.
5. Sau đủ 30 mẫu, nhấn "Xuất kết quả" để tải về một tệp JSON và một tệp CSV, gửi cả hai cho ban tổ chức.

Mỗi bản xuất có checksum SHA-256; trình duyệt chặn xuất trùng cùng một nội dung và pipeline import cũng từ chối checksum đã import.

## Gom kết quả và import

1. Tạo thư mục, ví dụ `benchmarks/tts-vi/artifacts/reviews/<runId>/web-exports/`, đặt toàn bộ tệp JSON export của ít nhất 5 người vào đó.
2. Điền `reviewers.csv` với cột `reviewer_id,confirmed_vietnamese`, đánh `true` cho người đã xác nhận là người Việt.
3. Chạy:

```powershell
npm run benchmark:review:web:import -- --exports <thu-muc-exports> --reviewers <duong-dan-reviewers.csv>
```

Script kiểm tra: đúng runId, mã reviewer hợp lệ và đã xác nhận, đủ 30 mẫu hợp lệ, MOS 1-5, cờ lỗi phát âm, checksum khớp và không trùng. Kết quả ghi vào `ratings.csv` và `reviewers.csv` của review run; cột `pronunciation_score` được suy ra từ MOS vì form web chỉ thu MOS theo quyết định của owner. Import thất bại (exit khác 0) khi chưa đủ 5 người, vì vậy report vẫn fail-closed.
