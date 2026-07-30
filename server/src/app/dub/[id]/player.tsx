"use client";

import { useEffect, useRef, useState } from "react";

interface Segment {
  idx: number;
  startMs: number;
  endMs: number;
  originalText: string;
  text: string;
  mime: string;
  audioUrl: string;
}

interface DubResponse {
  segments?: Segment[];
}

const INSTALL_KEY = "evoWebInstallId";

function webInstallId(): string {
  const existing = window.localStorage.getItem(INSTALL_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  window.localStorage.setItem(INSTALL_KEY, id);
  return id;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function DubPlayer({ dubId, platform, videoId }: { dubId: string; platform: string; videoId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const eventSentRef = useRef(false);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dubs/${dubId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as DubResponse;
      })
      .then((data) => {
        if (cancelled) return;
        const segs = (data.segments ?? []).slice().sort((a, b) => a.idx - b.idx);
        if (segs.length === 0) throw new Error("no segments");
        setSegments(segs);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [dubId]);

  function reportPlayback() {
    if (eventSentRef.current) return;
    eventSentRef.current = true;
    fetch("/api/v1/events/playback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform, videoId, installId: webInstallId() })
    }).catch(() => undefined);
  }

  async function playCue(index: number) {
    const audio = audioRef.current;
    const segs = segments;
    if (!audio || !segs || index < 0 || index >= segs.length) return;
    setCurrent(index);
    if (!audio.src.startsWith(segs[index].audioUrl)) {
      audio.src = segs[index].audioUrl;
    }
    try {
      await audio.play();
      setPlaying(true);
      reportPlayback();
    } catch {
      setPlaying(false);
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !segments) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (!audio.src) {
      void playCue(current);
      return;
    }
    audio
      .play()
      .then(() => {
        setPlaying(true);
        reportPlayback();
      })
      .catch(() => setPlaying(false));
  }

  function handleEnded() {
    if (segments && current + 1 < segments.length) {
      void playCue(current + 1);
    } else {
      setPlaying(false);
    }
  }

  if (loadError) {
    return (
      <div className="evo-status evo-status--error" data-testid="player-error">
        <span className="evo-i evo-i-alert" aria-hidden="true" />
        Không tải được dub ({loadError}).
      </div>
    );
  }

  if (!segments) {
    return (
      <div className="evo-status" data-testid="player-loading">
        <span className="evo-i evo-i-spinner" aria-hidden="true" />
        Đang tải dub...
      </div>
    );
  }

  const active = segments[current];

  return (
    <div className="player" data-testid="dub-player">
      <audio ref={audioRef} onEnded={handleEnded} preload="none" />
      <div className="player-bar">
        <button
          className="evo-btn evo-btn--solid"
          onClick={togglePlay}
          data-testid="player-toggle"
          aria-label={playing ? "Tạm dừng" : "Phát"}
        >
          <span className={`evo-i ${playing ? "evo-i-pause" : "evo-i-play"}`} aria-hidden="true" />
          {playing ? "Tạm dừng" : "Phát"}
        </button>
        <div className="player-now">
          <div className="player-cue-text" data-testid="player-cue">
            {active.text}
          </div>
          <div className="evo-note evo-num">
            Câu {current + 1}/{segments.length} - {formatMs(active.startMs)} to {formatMs(active.endMs)}
          </div>
        </div>
      </div>
      <ol className="player-cues">
        {segments.map((seg, i) => (
          <li key={seg.idx}>
            <button
              className={`player-cue${i === current ? " player-cue--active" : ""}`}
              onClick={() => void playCue(i)}
            >
              <span className="evo-note evo-num player-cue-time">{formatMs(seg.startMs)}</span>
              <span>{seg.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
