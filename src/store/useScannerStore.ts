import { create } from "zustand";

const DIGIT_ONLY = /^\d+$/;
const DEDUP_WINDOW_MS = 2000;

/** 세션별 본문 저장용 키 접두사 (값: 줄바꿈으로 구분된 스캔 텍스트) */
export const SESSION_STORAGE_PREFIX = "book-scanner:session:";

type Dedup = { at: number; value: string };

type ScannerState = {
  isScanning: boolean;
  activeSessionKey: string | null;
  /** 현재 세션 본문 (localStorage와 동기) */
  liveSessionText: string;
  lastCapturedCode: string | null;
  lastCaptureAt: number;
  sessionsRevision: number;
  _dedup: Dedup | null;

  beginInventorySession: () => string;
  endInventorySession: () => void;
  setLiveSessionText: (text: string) => void;
  appendDigitScanToActiveSession: (raw: string) => boolean;
  bumpSessionsRevision: () => void;
};

function normalizeDigits(raw: string): string | null {
  const t = raw.trim();
  if (!t || !DIGIT_ONLY.test(t)) return null;
  return t;
}

export function makeSessionStorageKey(startedAt: Date = new Date()): string {
  return `${SESSION_STORAGE_PREFIX}${startedAt.toISOString()}`;
}

export function listSessionStorageKeys(): string[] {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(SESSION_STORAGE_PREFIX)) out.push(k);
  }
  return out.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export function readSessionRaw(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) ?? "";
}

export function writeSessionRaw(key: string, text: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, text);
}

/** 기존 값 끝에 한 줄 append 후 저장, 갱신된 전체 문자열 반환 */
function appendLineToLocalStorage(key: string, line: string): string {
  const prev = readSessionRaw(key);
  const next = prev.length === 0 ? line : `${prev}\n${line}`;
  writeSessionRaw(key, next);
  return next;
}

export function deleteSessionKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key);
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  isScanning: false,
  activeSessionKey: null,
  liveSessionText: "",
  lastCapturedCode: null,
  lastCaptureAt: 0,
  sessionsRevision: 0,
  _dedup: null,

  bumpSessionsRevision: () =>
    set((s) => ({ sessionsRevision: s.sessionsRevision + 1 })),

  beginInventorySession: () => {
    const key = makeSessionStorageKey();
    writeSessionRaw(key, "");
    set({
      isScanning: true,
      activeSessionKey: key,
      liveSessionText: "",
      _dedup: null,
      lastCapturedCode: null,
      lastCaptureAt: 0,
    });
    get().bumpSessionsRevision();
    return key;
  },

  endInventorySession: () => {
    set({
      isScanning: false,
      activeSessionKey: null,
      liveSessionText: "",
      _dedup: null,
      lastCapturedCode: null,
      lastCaptureAt: 0,
    });
    get().bumpSessionsRevision();
  },

  setLiveSessionText: (text) => {
    const { activeSessionKey } = get();
    if (!activeSessionKey) return;
    writeSessionRaw(activeSessionKey, text);
    set({ liveSessionText: text });
  },

  appendDigitScanToActiveSession: (raw) => {
    const digits = normalizeDigits(raw);
    if (!digits) return false;
    const { activeSessionKey, _dedup } = get();
    if (!activeSessionKey) return false;

    const now = Date.now();
    if (
      _dedup &&
      _dedup.value === digits &&
      now - _dedup.at < DEDUP_WINDOW_MS
    ) {
      return false;
    }

    const nextText = appendLineToLocalStorage(activeSessionKey, digits);
    set({
      liveSessionText: nextText,
      _dedup: { at: now, value: digits },
      lastCapturedCode: digits,
      lastCaptureAt: now,
    });
    return true;
  },
}));
