import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Điều khoản dịch vụ - evo-dubbing",
  description: "Điều khoản sử dụng dịch vụ lồng tiếng AI evo-dubbing."
};

const content = `
      <h1>Điều khoản dịch vụ - evo-dubbing</h1>
      <p class="meta">Ngày hiệu lực: 30 tháng 7, 2026.</p>
      <p class="lede">
        Trang này là điều khoản sử dụng evo-dubbing: tiện ích Chrome và trang nghe.omelet.tech, do
        một cá nhân vận hành. Dùng dịch vụ nghĩa là bạn đồng ý với các điều khoản dưới đây.
      </p>

      <h2>1. Dịch vụ</h2>
      <p>
        evo-dubbing đọc phụ đề video YouTube, dịch sang tiếng Việt và tạo giọng đọc phát cùng video.
        <strong>Giọng đọc do AI tạo ra</strong>, không phải giọng người thật. Dịch vụ có hai chế độ:
        tự cấp khoá (BYOK, miễn phí) và dịch vụ managed trả phí.
      </p>

      <h2>2. Gói managed và thanh toán</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Điều khoản</th>
              <th>Nội dung</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Dùng thử</td>
              <td>15 phút nguồn miễn phí, cấp đúng một lần cho mỗi tài khoản, không cấp lại</td>
            </tr>
            <tr>
              <td>Giá</td>
              <td>199.000 VND cho một kỳ</td>
            </tr>
            <tr>
              <td>Quota</td>
              <td>300 phút nguồn mỗi kỳ</td>
            </tr>
            <tr>
              <td>Chu kỳ</td>
              <td>30 ngày liên tục kể từ lúc kích hoạt</td>
            </tr>
            <tr>
              <td>Gia hạn</td>
              <td>Thủ công: bạn chủ động tạo một thanh toán PayOS mới mỗi lần gia hạn. Dịch vụ không tự trừ tiền</td>
            </tr>
            <tr>
              <td>Cộng dồn</td>
              <td>Không. Quota chưa dùng hết kỳ sẽ mất, không chuyển sang kỳ sau</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Quota đo bằng phút nguồn của video và chỉ trừ khi một câu được tạo giọng thành công. Nội dung
        đã tạo nghe lại, cache trên máy bạn và bản dub có sẵn trong thư viện không trừ quota.
        Thanh toán do PayOS xử lý trên trang của họ; chúng tôi không thấy thông tin thẻ hay tài
        khoản ngân hàng của bạn.
      </p>

      <h2>3. Tài khoản</h2>
      <p>
        Đăng nhập bằng Google (phạm vi openid, email, profile). Bạn chịu trách nhiệm giữ phiên đăng
        nhập của mình. Yêu cầu xoá tài khoản và dữ liệu gửi tới
        <a href="mailto:sometimesocrazy@gmail.com">sometimesocrazy@gmail.com</a>.
      </p>

      <h2>4. Nội dung do người dùng chia sẻ</h2>
      <p>
        Khi chia sẻ một bản dub, bạn phải khẳng định có quyền cần thiết với nội dung đó. Bạn chịu
        trách nhiệm pháp lý về nội dung mình tải lên; chúng tôi không kiểm duyệt trước và không chịu
        trách nhiệm cho nội dung do người dùng chia sẻ. Không được dùng dịch vụ để phát tán nội dung
        vi phạm pháp luật hoặc quyền của bên thứ ba.
      </p>

      <h2>5. Quyền của creator và takedown</h2>
      <p>
        Chủ kênh YouTube có thể yêu cầu gỡ mọi bản dub của video mình bất kỳ lúc nào. Mỗi email
        outreach gửi tới creator đều kèm một đường link takedown có chữ ký; bấm vào link sẽ gỡ ngay
        các bản dub công khai của video đó khỏi thư viện và trang nghe thử. Creator cũng có thể yêu
        cầu takedown trực tiếp qua
        <a href="mailto:sometimesocrazy@gmail.com">sometimesocrazy@gmail.com</a>. Video gốc luôn phát
        bình thường trên YouTube; dịch vụ không tải lại hay lưu video của creator.
      </p>

      <h2>6. Giới hạn trách nhiệm</h2>
      <ul>
        <li>Dịch vụ cung cấp "nguyên trạng", không bảo đảm chất lượng bản dịch hay giọng đọc cho một mục đích cụ thể</li>
        <li>Chúng tôi có thể tạm dừng managed mode khi vượt ngân sách vận hành hoặc có sự cố nhà cung cấp AI; khi đó BYOK vẫn dùng được</li>
        <li>Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm cho thiệt hại gián tiếp phát sinh từ việc dùng hoặc không dùng được dịch vụ</li>
      </ul>

      <h2>7. Thay đổi điều khoản</h2>
      <p>
        Khi điều khoản thay đổi, trang này được cập nhật kèm ngày hiệu lực mới. Thay đổi về giá hoặc
        quota chỉ áp dụng cho kỳ thanh toán sau, không ảnh hưởng kỳ đã kích hoạt.
      </p>
`;

export default function TermsPage() {
  return (
    <main className="wrap wrap--narrow legal">
      <article dangerouslySetInnerHTML={{ __html: content }} />
    </main>
  );
}
