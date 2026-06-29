export type ProviderId = "openai" | "gemini";

export type TranscriptSource = "captions" | "stt";

export interface TranscriptSegment {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface Transcript {
  source: TranscriptSource;
  lang: string;
  segments: TranscriptSegment[];
}

export interface DubSegment {
  idx: number;
  startMs: number;
  endMs: number;
  originalText: string;
  text: string;
  audio?: ArrayBuffer;
  audioUrl?: string;
  audioMime: string;
}

export interface DubMeta {
  platform: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  voice: string;
  provider: ProviderId;
  title: string;
  durationMs: number;
}

export interface Dub extends DubMeta {
  id?: string;
  visibility: "public" | "private";
  segments: DubSegment[];
}

export interface VideoContext {
  platform: string;
  videoId: string;
  title: string;
  url: string;
  durationMs: number;
}

export interface ProviderKeys {
  openai?: string;
  gemini?: string;
}

export interface DubbingSettings {
  translateProvider: ProviderId;
  ttsProvider: ProviderId;
  sttProvider: ProviderId;
  targetLang: string;
  voice: string;
  duckVolume: number;
  showSubtitles: boolean;
  ttsModel: string;
  translateModel: string;
  shareServerUrl: string;
  autoUpload: boolean;
  defaultVisibility: "public" | "private";
}

export interface Settings extends DubbingSettings {
  keys: ProviderKeys;
}

export type DubbingPhase =
  | "idle"
  | "transcript"
  | "translating"
  | "synthesizing"
  | "ready"
  | "playing"
  | "error";

export interface DubbingProgress {
  phase: DubbingPhase;
  current: number;
  total: number;
  message: string;
}

export type ProgressHandler = (progress: DubbingProgress) => void;
