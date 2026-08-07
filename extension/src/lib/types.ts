export type ProviderId = "openai" | "gemini";

export type BillingMode = "byok" | "managed";

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
  trackId?: string;
  coverage?: number;
}

export interface CaptionTrackOption {
  id: string;
  lang: string;
  name: string;
  auto: boolean;
  primary: boolean;
}

export interface TranscriptInfo {
  lang: string;
  trackId: string;
  coverage: number;
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
  channelId?: string;
  channelName?: string;
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
  showTimelineProgress: boolean;
  holdUntilFirstDub: boolean;
  ttsModel: string;
  translateModel: string;
  shareServerUrl: string;
  autoUpload: boolean;
  defaultVisibility: "public" | "private";
  billingMode: BillingMode;
  managedBaseUrl: string;
  managedVoiceProfileId: string;
  /** Absent on blobs written before the baked-in default server. See lib/config.ts. */
  settingsVersion?: number;
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
  | "holding"
  | "error";

export interface DubbingProgress {
  phase: DubbingPhase;
  current: number;
  total: number;
  message: string;
  status?: number;
}

export type ProgressHandler = (progress: DubbingProgress) => void;

/** A stretch of the source timeline that already has dubbed audio in hand. */
export interface DubCoverageRange {
  startMs: number;
  endMs: number;
}

export interface DubCoverage {
  /** Length of the source video, so a range can be turned into a position on the scrubber. */
  durationMs: number;
  ranges: DubCoverageRange[];
  ready: number;
  total: number;
}

export type CoverageHandler = (coverage: DubCoverage) => void;
