import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chính sách quyền riêng tư - evo-dubbing",
  description: "evo-dubbing thu thập dữ liệu gì, gửi đi đâu, và giữ trong bao lâu."
};

const content = `
      <h1>Chính sách quyền riêng tư - evo-dubbing</h1>
      <p class="meta">Ngày hiệu lực: 26 tháng 7, 2026. Cập nhật lần cuối: 26 tháng 7, 2026.</p>
      <p class="lede">
        evo-dubbing là tiện ích Chrome lồng tiếng AI cho video trực tuyến, bắt đầu với YouTube. Trang
        này nói chính xác tiện ích thu thập dữ liệu gì, gửi đi đâu, và giữ trong bao lâu.
      </p>

      <h2>1. Ai vận hành</h2>
      <p>
        evo-dubbing do một cá nhân phát triển và vận hành. Liên hệ về quyền riêng tư, yêu cầu truy cập
        hoặc xoá dữ liệu: <a href="mailto:sometimesocrazy@gmail.com">sometimesocrazy@gmail.com</a>.
        Mã nguồn công khai tại
        <a href="https://github.com/maycuatroi1/evo-dubbing">github.com/maycuatroi1/evo-dubbing</a>,
        nên mọi điều mô tả ở đây đều kiểm chứng được trong code.
      </p>

      <h2>2. Mục đích duy nhất</h2>
      <p>
        Tiện ích chỉ làm một việc: đọc phụ đề của video bạn đang xem, dịch sang ngôn ngữ bạn chọn,
        tạo giọng đọc, và phát cùng video. Tiện ích chỉ chạy trên <code>youtube.com</code>. Nó không
        đọc, không theo dõi và không can thiệp bất kỳ trang nào khác.
      </p>

      <h2>3. Dữ liệu chỉ nằm trên máy bạn</h2>
      <p>
        Những mục sau lưu trong <code>chrome.storage.local</code> trên chính máy bạn. Chúng
        <strong>không</strong> được gửi tới máy chủ của chúng tôi.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dữ liệu</th>
              <th>Vì sao cần</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cấu hình: ngôn ngữ đích, nhà cung cấp AI, model, giọng đọc, mức giảm âm gốc, địa chỉ máy chủ</td>
              <td>Để tiện ích ghi nhớ lựa chọn của bạn giữa các lần dùng</td>
            </tr>
            <tr>
              <td>Khoá API của riêng bạn (OpenAI, Google), nếu bạn dùng chế độ tự cấp khoá</td>
              <td>Để gọi nhà cung cấp AI thay bạn. Xem mục 4</td>
            </tr>
            <tr>
              <td>Mã chủ sở hữu của những bản lồng tiếng bạn đã chia sẻ</td>
              <td>Để bạn còn quyền đổi chế độ hiển thị hoặc xoá bản đã chia sẻ</td>
            </tr>
            <tr>
              <td>Phiên đăng nhập (access token, refresh token) nếu bạn dùng chế độ dịch vụ</td>
              <td>Để không phải đăng nhập lại mỗi lần. Chỉ service worker đọc được; script chạy trên trang YouTube không bao giờ đọc được khoá này</td>
            </tr>
            <tr>
              <td>Một mã cài đặt ngẫu nhiên (UUID)</td>
              <td>Xem mục 5. Mã này sinh ngẫu nhiên, không chứa và không liên kết tới danh tính của bạn</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Xoá tiện ích khỏi Chrome sẽ xoá toàn bộ những mục trên. Bạn cũng có thể xoá khoá API bất kỳ
        lúc nào trong trang cài đặt của tiện ích.
      </p>

      <h2>4. Chế độ tự cấp khoá (BYOK)</h2>
      <p>
        Nếu bạn nhập khoá API của riêng mình, tiện ích gửi phụ đề của video
        <strong>trực tiếp</strong> tới nhà cung cấp bạn chọn:
      </p>
      <ul>
        <li><code>api.openai.com</code> - OpenAI</li>
        <li><code>generativelanguage.googleapis.com</code> - Google Gemini</li>
      </ul>
      <p>
        Ở chế độ này, cả phụ đề lẫn khoá API của bạn <strong>không đi qua máy chủ của chúng tôi</strong>.
        Việc nhà cung cấp xử lý và lưu dữ liệu đó thế nào thuộc chính sách của họ, không thuộc chính
        sách này. Vui lòng đọc điều khoản của OpenAI hoặc Google.
      </p>

      <h2>5. Chế độ dịch vụ (managed)</h2>
      <p>
        Nếu bạn đăng nhập và dùng hạ tầng của chúng tôi thay vì khoá riêng, những dữ liệu sau được
        gửi tới máy chủ của chúng tôi:
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gửi đi</th>
              <th>Vì sao</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Nội dung phụ đề của video, ngôn ngữ nguồn và ngôn ngữ đích</td>
              <td>Đây chính là nội dung cần dịch. Không có nó thì không có bản dịch</td>
            </tr>
            <tr>
              <td>Văn bản đã dịch, mã giọng đọc, mốc thời gian từng câu</td>
              <td>Để tạo giọng đọc khớp đúng thời điểm trong video</td>
            </tr>
            <tr>
              <td>Địa chỉ email và tên hiển thị Google của bạn</td>
              <td>Định danh tài khoản, tính hạn mức sử dụng, và liên hệ về đơn hàng. Chỉ lấy khi bạn chủ động đăng nhập</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Chúng tôi chuyển phụ đề tới nhà cung cấp AI (Google) để dịch và tạo giọng đọc, vì đó là cách
        duy nhất tạo ra kết quả bạn yêu cầu. Chúng tôi không dùng nội dung của bạn để huấn luyện mô
        hình nào.
      </p>

      <h3>Đăng nhập Google</h3>
      <p>
        Đăng nhập dùng Google OAuth với ba phạm vi: <code>openid</code>, <code>email</code>,
        <code>profile</code>. Chúng tôi không xin quyền đọc Gmail, Drive, Calendar hay bất kỳ dữ liệu
        Google nào khác. Phiên đăng nhập do Supabase quản lý.
      </p>

      <h3>Thanh toán</h3>
      <p>
        Thanh toán do PayOS xử lý trên trang của họ. Tiện ích và máy chủ của chúng tôi
        <strong>không bao giờ nhìn thấy</strong> số thẻ, số tài khoản hay thông tin thanh toán của
        bạn. Chúng tôi chỉ nhận thông báo đơn hàng đã thanh toán hay chưa.
      </p>

      <h2>6. Số liệu lượt phát</h2>
      <p>
        Khi một bản lồng tiếng bắt đầu phát, tiện ích gửi tới máy chủ: mã video, tên nền tảng, mã và
        tên kênh (thông tin công khai của video), cùng mã cài đặt ngẫu nhiên ở mục 3.
      </p>
      <p>Cách chúng tôi hạn chế dữ liệu này:</p>
      <ul>
        <li>Mã cài đặt được băm (HMAC) bằng khoá đổi theo ngày trước khi lưu, nên không lần lại được qua nhiều ngày</li>
        <li>Chỉ tính một lượt cho mỗi cặp (video, ngày, mã đã băm)</li>
        <li>Chỉ số liệu tổng hợp theo ngày được giữ lâu dài, không giữ bản ghi từng lượt</li>
      </ul>
      <p>
        Số liệu này dùng để biết bản lồng tiếng nào được xem nhiều, và để liên hệ chủ kênh khi một
        video vượt ngưỡng, mời họ hợp tác hoặc yêu cầu chúng tôi ẩn bản lồng tiếng. Nó
        <strong>không</strong> phải lịch sử duyệt web: chúng tôi chỉ biết những video bạn chủ động
        lồng tiếng hoặc mở bản lồng tiếng, không biết bất cứ gì khác bạn xem.
      </p>

      <h2>7. Khi bạn chủ động chia sẻ</h2>
      <p>
        Chia sẻ là hành động bạn tự bấm, không tự động. Khi bạn chia sẻ một bản lồng tiếng, những dữ
        liệu sau được tải lên máy chủ và bộ lưu trữ của chúng tôi:
      </p>
      <ul>
        <li>Thông tin video: nền tảng, mã video, tiêu đề, thời lượng, ngôn ngữ, giọng đọc, nhà cung cấp</li>
        <li>Phụ đề gốc và bản dịch của từng câu</li>
        <li>Tệp âm thanh giọng đọc đã tạo</li>
        <li>Khẳng định của bạn rằng bạn có quyền với nội dung này</li>
        <li>Chế độ hiển thị bạn chọn: công khai hay riêng tư</li>
      </ul>
      <p>
        Bạn có thể đổi chế độ hiển thị hoặc xoá bản đã chia sẻ bất kỳ lúc nào bằng mã chủ sở hữu lưu
        trên máy bạn. Nếu bạn không bấm chia sẻ, không có nội dung nào ở mục này được tải lên.
      </p>

      <h2>8. Những điều chúng tôi không làm</h2>
      <ul>
        <li>Không bán, cho thuê hay đổi dữ liệu của bạn cho bất kỳ ai</li>
        <li>Không đặt quảng cáo và không chia sẻ dữ liệu cho mạng quảng cáo</li>
        <li>Không thu thập lịch sử duyệt web, không theo dõi bạn qua các trang</li>
        <li>Không đọc trang nào ngoài <code>youtube.com</code></li>
        <li>Không dùng nội dung của bạn để huấn luyện mô hình AI</li>
        <li>Không thu thập dữ liệu ngoài phạm vi mục đích nêu ở mục 2</li>
      </ul>

      <h2>9. Quyền truy cập máy chủ tuỳ chọn</h2>
      <p>
        Tiện ích khai một quyền tuỳ chọn cho phép truy cập địa chỉ HTTPS bất kỳ. Quyền này chỉ dùng
        khi bạn tự nhập địa chỉ máy chủ riêng - chúng tôi không thể biết trước địa chỉ đó nên không
        thể khai hẹp hơn. Chrome sẽ hỏi bạn khi nào cần, và bạn có thể từ chối. Nếu bạn dùng máy chủ
        mặc định, quyền này không bao giờ được yêu cầu.
      </p>

      <h2>10. Lưu trong bao lâu</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dữ liệu</th>
              <th>Thời gian giữ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Mọi thứ ở mục 3</td>
              <td>Trên máy bạn, đến khi bạn xoá hoặc gỡ tiện ích</td>
            </tr>
            <tr>
              <td>Phụ đề gửi để dịch, văn bản gửi để tạo giọng</td>
              <td>Xử lý xong thì bỏ, không lưu thành bản ghi lâu dài</td>
            </tr>
            <tr>
              <td>Tài khoản, email, lịch sử hạn mức và đơn hàng</td>
              <td>Đến khi bạn yêu cầu xoá tài khoản</td>
            </tr>
            <tr>
              <td>Bản lồng tiếng bạn đã chia sẻ</td>
              <td>Đến khi bạn xoá, hoặc chủ nội dung yêu cầu hạ</td>
            </tr>
            <tr>
              <td>Số liệu lượt phát</td>
              <td>Chỉ tổng hợp theo ngày, không có bản ghi từng lượt</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>11. Quyền của bạn</h2>
      <p>
        Gửi email tới <a href="mailto:sometimesocrazy@gmail.com">sometimesocrazy@gmail.com</a> để yêu
        cầu bản sao dữ liệu chúng tôi giữ về bạn, sửa dữ liệu sai, hoặc xoá tài khoản và toàn bộ dữ
        liệu liên quan. Chúng tôi phản hồi trong vòng 30 ngày.
      </p>

      <h2>12. Thay đổi chính sách</h2>
      <p>
        Nếu cách xử lý dữ liệu thay đổi, chúng tôi cập nhật trang này và đổi ngày hiệu lực ở đầu
        trang. Với thay đổi làm mở rộng phạm vi dữ liệu thu thập, tiện ích sẽ thông báo rõ trong giao
        diện trước khi thay đổi có hiệu lực, chứ không âm thầm áp dụng.
      </p>

      <hr class="divider" />

      <h1 id="en">Privacy Policy - evo-dubbing</h1>
      <p class="meta">Effective date: July 26, 2026. Last updated: July 26, 2026.</p>
      <p class="lede">
        evo-dubbing is a Chrome extension that produces AI voice-over dubbing for online video,
        starting with YouTube. This page states exactly what data the extension handles, where it
        goes, and how long it is kept.
      </p>

      <h2>1. Who operates this</h2>
      <p>
        evo-dubbing is built and operated by an individual developer. For privacy questions, data
        access requests, or deletion requests, contact
        <a href="mailto:sometimesocrazy@gmail.com">sometimesocrazy@gmail.com</a>. The source code is
        public at
        <a href="https://github.com/maycuatroi1/evo-dubbing">github.com/maycuatroi1/evo-dubbing</a>,
        so every claim on this page can be verified against the code.
      </p>

      <h2>2. Single purpose</h2>
      <p>
        The extension does one thing: read the captions of the video you are watching, translate them
        into a language you choose, synthesise speech, and play it alongside the video. It runs only
        on <code>youtube.com</code>. It does not read, track, or modify any other site.
      </p>

      <h2>3. Data that stays on your device</h2>
      <p>
        The following is stored in <code>chrome.storage.local</code> on your own machine. It is
        <strong>not</strong> transmitted to our servers.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Why it is needed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Settings: target language, AI provider, model, voice, original-audio ducking level, server URL</td>
              <td>So the extension remembers your choices between sessions</td>
            </tr>
            <tr>
              <td>Your own API keys (OpenAI, Google), if you use bring-your-own-key mode</td>
              <td>To call the AI provider on your behalf. See section 4</td>
            </tr>
            <tr>
              <td>Owner tokens for dubs you have shared</td>
              <td>So you retain control to change visibility or delete a shared dub</td>
            </tr>
            <tr>
              <td>Sign-in session (access token, refresh token) if you use managed mode</td>
              <td>So you do not sign in repeatedly. Only the service worker can read it; scripts running on the YouTube page never can</td>
            </tr>
            <tr>
              <td>A random installation identifier (UUID)</td>
              <td>See section 5. It is randomly generated and is not linked to your identity</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Removing the extension from Chrome deletes all of the above. You can also clear your API keys
        at any time from the extension's options page.
      </p>

      <h2>4. Bring-your-own-key mode</h2>
      <p>
        If you supply your own API keys, the extension sends the video's captions
        <strong>directly</strong> to the provider you chose:
      </p>
      <ul>
        <li><code>api.openai.com</code> - OpenAI</li>
        <li><code>generativelanguage.googleapis.com</code> - Google Gemini</li>
      </ul>
      <p>
        In this mode neither the captions nor your API key
        <strong>pass through our servers at all</strong>. How that provider processes and retains the
        data is governed by their policy, not this one. Please read OpenAI's or Google's terms.
      </p>

      <h2>5. Managed mode</h2>
      <p>
        If you sign in and use our infrastructure instead of your own keys, the following is sent to
        our servers:
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sent</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The video's caption text, source language, target language</td>
              <td>This is the content to be translated. There is no translation without it</td>
            </tr>
            <tr>
              <td>Translated text, voice identifier, per-cue timings</td>
              <td>To synthesise speech that lands at the right moment in the video</td>
            </tr>
            <tr>
              <td>Your Google email address and display name</td>
              <td>To identify your account, meter usage, and contact you about orders. Collected only when you actively sign in</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We forward captions to an AI provider (Google) for translation and speech synthesis, because
        that is the only way to produce the result you asked for. We do not use your content to train
        any model.
      </p>

      <h3>Google sign-in</h3>
      <p>
        Sign-in uses Google OAuth with three scopes: <code>openid</code>, <code>email</code>,
        <code>profile</code>. We do not request access to Gmail, Drive, Calendar, or any other Google
        data. Sessions are managed by Supabase.
      </p>

      <h3>Payments</h3>
      <p>
        Payments are handled by PayOS on their own pages. Neither the extension nor our servers ever
        see your card number, bank account, or payment credentials. We only receive whether an order
        was paid.
      </p>

      <h2>6. Playback metrics</h2>
      <p>
        When a dub starts playing, the extension sends our server: the video id, the platform name,
        the channel id and channel name (public metadata of the video), and the random installation
        identifier from section 3.
      </p>
      <p>How this data is constrained:</p>
      <ul>
        <li>The installation id is HMAC-hashed with a key that rotates daily before storage, so it cannot be correlated across days</li>
        <li>Only one playback is counted per (video, day, hashed installation) combination</li>
        <li>Only daily aggregate totals are retained; no per-event rows are kept long term</li>
      </ul>
      <p>
        We use this to see which dubs are watched, and to contact a channel owner once one of their
        videos crosses a threshold, either to work together or to let them have the dub taken down.
        It is <strong>not</strong> browsing history: we learn only about videos you deliberately
        dubbed or whose dub you opened, and nothing else you watch.
      </p>

      <h2>7. When you choose to share</h2>
      <p>
        Sharing is an action you take, never automatic. When you share a dub, the following is
        uploaded to our server and object storage:
      </p>
      <ul>
        <li>Video metadata: platform, video id, title, duration, languages, voice, provider</li>
        <li>Original and translated text of each caption cue</li>
        <li>The generated speech audio files</li>
        <li>Your assertion that you hold the rights to this content</li>
        <li>The visibility you chose: public or private</li>
      </ul>
      <p>
        You can change visibility or delete a shared dub at any time using the owner token held on
        your device. If you never press share, nothing in this section is uploaded.
      </p>

      <h2>8. What we do not do</h2>
      <ul>
        <li>We do not sell, rent, or trade your data to anyone</li>
        <li>We do not serve ads and do not share data with ad networks</li>
        <li>We do not collect browsing history and do not track you across sites</li>
        <li>We do not read any site other than <code>youtube.com</code></li>
        <li>We do not use your content to train AI models</li>
        <li>We do not collect data beyond the single purpose in section 2</li>
      </ul>

      <h2>9. Optional host permission</h2>
      <p>
        The extension declares one optional permission that allows access to an arbitrary HTTPS
        address. It is used only if you point the extension at your own self-hosted server - we
        cannot know that address in advance, so we cannot declare it more narrowly. Chrome will
        prompt you when it is needed, and you may decline. If you use the default server, this
        permission is never requested.
      </p>

      <h2>10. Retention</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Kept for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Everything in section 3</td>
              <td>On your device, until you clear it or uninstall</td>
            </tr>
            <tr>
              <td>Captions sent for translation, text sent for synthesis</td>
              <td>Discarded after processing; not retained as long-term records</td>
            </tr>
            <tr>
              <td>Account, email, usage and order history</td>
              <td>Until you ask us to delete your account</td>
            </tr>
            <tr>
              <td>Dubs you shared</td>
              <td>Until you delete them, or a rights holder requests takedown</td>
            </tr>
            <tr>
              <td>Playback metrics</td>
              <td>Daily aggregates only; no per-event records</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>11. Your rights</h2>
      <p>
        Email <a href="mailto:sometimesocrazy@gmail.com">sometimesocrazy@gmail.com</a> to request a
        copy of the data we hold about you, correct inaccurate data, or delete your account and all
        associated data. We respond within 30 days.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        If our data practices change, we update this page and change the effective date at the top.
        For any change that widens what we collect, the extension will disclose it prominently in its
        interface before the change takes effect, rather than applying it silently.
      </p>
`;

export default function PrivacyPage() {
  return (
    <main className="wrap wrap--narrow legal">
      <article dangerouslySetInnerHTML={{ __html: content }} />
    </main>
  );
}
