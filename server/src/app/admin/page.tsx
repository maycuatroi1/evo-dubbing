"use client";

import { useState } from "react";

interface OutreachItem {
  id: string;
  platform: string;
  handle: string;
  channelUrl: string;
  channelId: string;
  videoId: string;
  creatorEmail: string;
  status: string;
  businessInquiryUrl: string;
}

interface Preview {
  subject: string;
  text: string;
}

const TOKEN_KEY = "evoAdminToken";

export default function AdminOutreachPage() {
  const [token, setToken] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_KEY) ?? ""
  );
  const [items, setItems] = useState<OutreachItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  function saveToken(value: string) {
    setToken(value);
    window.localStorage.setItem(TOKEN_KEY, value);
  }

  async function call(path: string, body?: Record<string, unknown>) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
    }
    return data;
  }

  async function load() {
    setMessage("");
    try {
      const data = (await call("/api/v1/admin/outreach")) as { items: OutreachItem[] };
      setItems(data.items);
      setMessage(`${data.items.length} outreach đang chờ.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function preview(item: OutreachItem) {
    setMessage("");
    try {
      const data = (await call(`/api/v1/admin/outreach/${item.id}`, { action: "preview" })) as Preview;
      setPreviews((prev) => ({ ...prev, [item.id]: data }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveEmail(item: OutreachItem) {
    setMessage("");
    try {
      await call(`/api/v1/admin/outreach/${item.id}`, { action: "setEmail", email: emails[item.id] ?? "" });
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, creatorEmail: emails[item.id] ?? "" } : row))
      );
      setMessage("Đã lưu email creator.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function send(item: OutreachItem) {
    setMessage("");
    try {
      await call(`/api/v1/admin/outreach/${item.id}`, { action: "send" });
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setMessage("Đã gửi email notice cho creator.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="wrap">
      <h1>Creator outreach (admin)</h1>
      <p className="sub">
        Chỉ tài khoản Supabase trong ADMIN_EMAIL_ALLOWLIST dùng được trang này. Dán access token Supabase của
        operator, tải danh sách, tự mở trang Business Inquiry của kênh, nhập email creator đang công khai rồi duyệt
        template trước khi gửi.
      </p>
      <div className="admin-token">
        <input
          className="evo-input"
          type="password"
          placeholder="Supabase access token"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
        />
        <button className="evo-btn evo-btn--solid" onClick={() => void load()}>Tải danh sách</button>
      </div>
      {message && <p>{message}</p>}
      {items.map((item) => (
        <div key={item.id} className="card" style={{ marginBottom: 12 }}>
          <h3>{item.handle}</h3>
          <div className="tags">
            <span className="tag">{item.platform}</span>
            <span className="tag">{item.videoId}</span>
            <span className="tag">{item.status}</span>
          </div>
          <p>
            <a href={`https://www.youtube.com/watch?v=${item.videoId}`} target="_blank" rel="noreferrer">
              Video
            </a>{" "}
            <a href={item.businessInquiryUrl} target="_blank" rel="noreferrer">
              Mở YouTube Business Inquiry
            </a>
          </p>
          <div className="admin-actions">
            <input
              className="evo-input"
              type="email"
              placeholder="Email creator (operator tự nhập từ trang công khai)"
              value={emails[item.id] ?? item.creatorEmail}
              onChange={(e) => setEmails((prev) => ({ ...prev, [item.id]: e.target.value }))}
            />
            <button className="evo-btn evo-btn--outline" onClick={() => void saveEmail(item)}>Lưu email</button>
            <button className="evo-btn evo-btn--outline" onClick={() => void preview(item)}>Xem template</button>
            <button className="evo-btn evo-btn--solid" onClick={() => void send(item)}>Gửi notice</button>
          </div>
          {previews[item.id] && (
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
              {previews[item.id].subject}
              {"\n\n"}
              {previews[item.id].text}
            </pre>
          )}
        </div>
      ))}
    </main>
  );
}
