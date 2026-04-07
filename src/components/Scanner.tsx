"use client";

import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  SESSION_STORAGE_PREFIX,
  deleteSessionKey,
  listSessionStorageKeys,
  readSessionRaw,
  useScannerStore,
  writeSessionRaw,
} from "@/store/useScannerStore";

/** html5-qrcode 가 시각·비디오를 붙이는 요소 (요구사항 id) */
const READER_ID = "reader";
const DIGIT_ONLY = /^\d+$/;

function isLikelyDesktop(): boolean {
  if (typeof window === "undefined") return true;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasTouch =
    "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  return !coarsePointer && !hasTouch;
}

function randomDigits(): string {
  return Array.from({ length: 13 }, () =>
    String(Math.floor(Math.random() * 10))
  ).join("");
}

function formatSessionKeyLabel(key: string): string {
  const iso = key.slice(SESSION_STORAGE_PREFIX.length);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function lineCount(text: string): number {
  return text.split("\n").filter((l) => l.trim().length > 0).length;
}

/** 저격 스코프: 반투명 마스크 + 가는 레이저(터치는 모두 통과) */
function SniperLaserOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[45] flex items-center justify-center"
      aria-hidden
    >
      <div className="pointer-events-none relative aspect-video w-3/4 max-w-sm overflow-hidden rounded-xl shadow-[0_0_0_max(100vmax,120vh)_rgb(0_0_0_/_0.5)]">
        <div className="sniper-laser-ray" />
      </div>
    </div>
  );
}

/** 스캔 줄만 추려 줄바꿈으로 연결한 플레인 텍스트 */
function toClipboardPlainText(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/** Chrome·Safari: Secure Context에서 Clipboard API 우선, 실패 시 사용자 제스처 내 execCommand 폴백 */
function legacyExecCommandCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;padding:0;border:0;margin:0;";
  document.body.appendChild(ta);
  ta.focus();
  const len = text.length;
  try {
    if (typeof ta.setSelectionRange === "function") {
      ta.setSelectionRange(0, len);
    } else {
      ta.select();
    }
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand copy returned false");
  } finally {
    document.body.removeChild(ta);
  }
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof window === "undefined") throw new Error("no window");

  const hasAsyncClipboard =
    typeof navigator !== "undefined" &&
    Boolean(navigator.clipboard?.writeText) &&
    window.isSecureContext;

  if (hasAsyncClipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* Clipboard API 거부·일시 오류 → 폴백 */
    }
  }

  legacyExecCommandCopy(text);
}

function CopyBarcodeListButton({
  sourceText,
  disabled,
}: {
  sourceText: string;
  disabled: boolean;
}) {
  const [copyDone, setCopyDone] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (disabled) return;
    const plain = toClipboardPlainText(sourceText);
    if (!plain) return;

    try {
      await writeTextToClipboard(plain);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([50]);
      }
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      setCopyDone(true);
      const id = window.setTimeout(() => {
        setCopyDone(false);
        resetTimerRef.current = null;
      }, 2000);
      resetTimerRef.current = id;
    } catch {
      window.alert(
        "클립보드에 복사하지 못했습니다.\n\n" +
          "• Chrome: 주소창 오른쪽 자물쇠/사이트 정보에서 권한을 확인하거나, HTTPS·localhost에서 열었는지 확인하세요.\n" +
          "• Safari: 주소창 aA/자물쇠에서 붙여넣기·클립보드 권한을 허용해 보세요.\n" +
          "• 텍스트 상자에서 길게 눌러 전체 선택 후 복사할 수도 있습니다."
      );
    }
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void handleCopy()}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-tight shadow-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
        copyDone
          ? "bg-emerald-600 text-white shadow-emerald-900/35"
          : "border border-zinc-500/60 bg-zinc-800/95 text-zinc-100 active:bg-zinc-700/95"
      }`}
    >
      {copyDone ? "복사 완료! ✅" : "목록 복사"}
    </button>
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100dvh",
  maxHeight: "100dvh",
};

export default function Scanner() {
  const activeSessionKey = useScannerStore((s) => s.activeSessionKey);
  const beginInventorySession = useScannerStore((s) => s.beginInventorySession);
  const endInventorySession = useScannerStore((s) => s.endInventorySession);
  const liveSessionText = useScannerStore((s) => s.liveSessionText);
  const setLiveSessionText = useScannerStore((s) => s.setLiveSessionText);
  const appendDigitScanToActiveSession = useScannerStore(
    (s) => s.appendDigitScanToActiveSession
  );
  const lastCapturedCode = useScannerStore((s) => s.lastCapturedCode);
  const lastCaptureAt = useScannerStore((s) => s.lastCaptureAt);
  const sessionsRevision = useScannerStore((s) => s.sessionsRevision);
  const bumpSessionsRevision = useScannerStore((s) => s.bumpSessionsRevision);

  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [sessionKeys, setSessionKeys] = useState<string[]>([]);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [historyText, setHistoryText] = useState("");

  const inSession = activeSessionKey !== null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setSessionKeys(listSessionStorageKeys());
  }, [mounted, sessionsRevision]);

  const triggerFeedback = useCallback((digits: string) => {
    setFlashKey(Date.now());
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([100]);
    }
    setToast(`스캔 완료: ${digits}`);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const handleDecoded = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!DIGIT_ONLY.test(trimmed)) return;
      const ok = appendDigitScanToActiveSession(trimmed);
      if (ok) triggerFeedback(trimmed);
    },
    [appendDigitScanToActiveSession, triggerFeedback]
  );

  const handleMockScan = useCallback(() => {
    const code = randomDigits();
    const ok = appendDigitScanToActiveSession(code);
    if (ok) triggerFeedback(code);
  }, [appendDigitScanToActiveSession, triggerFeedback]);

  useEffect(() => {
    if (!activeSessionKey) {
      setMode("idle");
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (instance) {
        const stopPromise = instance.isScanning
          ? instance.stop().catch(() => {})
          : Promise.resolve();
        void stopPromise.finally(() => {
          try {
            instance.clear();
          } catch {
            /* ignore */
          }
        });
      }
      return;
    }

    if (isLikelyDesktop()) {
      setMode("mock");
      return;
    }

    let cancelled = false;
    setMode("loading");

    const scanner = new Html5Qrcode(READER_ID, {
      verbose: false,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
    });
    scannerRef.current = scanner;

    const start = async () => {
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cancelled) return;

        if (cameras.length === 0) {
          try {
            scanner.clear();
          } catch {
            /* ignore */
          }
          scannerRef.current = null;
          setMode("mock");
          return;
        }

        const backCamera = cameras.find((c) =>
          /back|rear|environment|wide/i.test(c.label)
        );

        /* qrbox 생략 → 라이브러리 기본 쉐이딩 비활성화, 전역 프레임 디코딩 + 커스텀 오버레이만 사용 */
        const scanConfig = {
          fps: 12,
        };

        if (backCamera?.id) {
          await scanner.start(
            backCamera.id,
            scanConfig,
            handleDecoded,
            () => {}
          );
        } else {
          await scanner.start(
            { facingMode: "environment" },
            {
              ...scanConfig,
              videoConstraints: { facingMode: "environment" },
            },
            handleDecoded,
            () => {}
          );
        }

        if (!cancelled) setMode("camera");
      } catch {
        if (cancelled) return;
        try {
          if (scanner.isScanning) await scanner.stop();
        } catch {
          /* ignore */
        }
        try {
          scanner.clear();
        } catch {
          /* ignore */
        }
        scannerRef.current = null;
        setMode("mock");
      }
    };

    void start();

    return () => {
      cancelled = true;
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (!instance) return;
      const stop = instance.isScanning
        ? instance.stop().catch(() => {})
        : Promise.resolve();
      void stop.finally(() => {
        try {
          instance.clear();
        } catch {
          /* ignore */
        }
      });
    };
  }, [activeSessionKey, handleDecoded]);

  const showReader =
    inSession && !isLikelyDesktop() && mode !== "mock";
  const showMockPanel = inSession && mode === "mock";
  const showCameraLoading =
    inSession && !isLikelyDesktop() && mode === "loading";

  const recentTailLines = useMemo(() => {
    const lines = liveSessionText.split("\n").filter((l) => l.length > 0);
    return lines.slice(-12);
  }, [liveSessionText]);

  const openHistory = useCallback((key: string) => {
    setHistoryKey(key);
    setHistoryText(readSessionRaw(key));
  }, []);

  const onHistoryTextChange = useCallback(
    (text: string) => {
      if (!historyKey) return;
      setHistoryText(text);
      writeSessionRaw(historyKey, text);
    },
    [historyKey]
  );

  const handleDeleteHistory = useCallback(() => {
    if (!historyKey) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("이 점검 기록을 삭제할까요?")
    ) {
      return;
    }
    deleteSessionKey(historyKey);
    setHistoryKey(null);
    setHistoryText("");
    bumpSessionsRevision();
  }, [historyKey, bumpSessionsRevision]);

  const handleStartInventory = useCallback(() => {
    setHistoryKey(null);
    setHistoryText("");
    beginInventorySession();
  }, [beginInventorySession]);

  const historySection = (
    <section
      className="flex max-h-[min(32vh,280px)] min-h-0 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950"
      aria-label="과거 장서점검 기록"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            저장된 장서점검 기록
          </h2>
          <p className="text-[0.65rem] text-zinc-600">
            항목을 눌러 조회·수정·삭제할 수 있습니다.
          </p>
        </div>
        <CopyBarcodeListButton
          sourceText={historyKey ? historyText : ""}
          disabled={
            !historyKey || lineCount(historyKey ? historyText : "") === 0
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!mounted ? (
          <p className="px-2 py-3 text-sm text-zinc-500">불러오는 중…</p>
        ) : sessionKeys.length === 0 ? (
          <p className="px-2 py-3 text-sm text-zinc-500">
            저장된 점검 기록이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900/40">
            {sessionKeys.map((key) => {
              const raw = readSessionRaw(key);
              const n = lineCount(raw);
              const active = historyKey === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => openHistory(key)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left active:bg-zinc-800/80 ${active ? "bg-zinc-800/50" : ""}`}
                  >
                    <span className="text-sm font-medium text-zinc-100">
                      {formatSessionKeyLabel(key)}
                    </span>
                    <span className="text-xs text-zinc-500">스캔 {n}건</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {historyKey && (
        <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-zinc-500">
              {formatSessionKeyLabel(historyKey)}
            </span>
            <button
              type="button"
              onClick={handleDeleteHistory}
              className="shrink-0 rounded-lg border border-red-900/60 bg-red-950/40 px-2.5 py-1 text-xs font-medium text-red-200 active:bg-red-950/70"
            >
              삭제
            </button>
          </div>
          <textarea
            value={historyText}
            onChange={(e) => onHistoryTextChange(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="max-h-28 min-h-[5rem] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 font-mono text-xs leading-relaxed text-zinc-100 tabular-nums outline-none ring-emerald-500/30 focus:ring-2"
          />
        </div>
      )}
    </section>
  );

  return (
    <div
      className="isolate flex w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      style={shellStyle}
    >
      {flashKey != null && (
        <div
          key={flashKey}
          className="pointer-events-none fixed inset-0 z-[95] box-border rounded-none border-[6px] border-solid border-transparent scan-success-flash"
          onAnimationEnd={() => setFlashKey(null)}
          aria-hidden
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!inSession && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              책찍!
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              바코드만 스윽— 줄줄이 쌓이는 장서점검. 「책찍! 시작」이면 카메라가
              바로 열립니다. 과거 기록은 맨 아래에서 볼 수 있어요.
            </p>
            {mounted && sessionKeys.length > 0 && (
              <p className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/25 px-3 py-2 text-sm text-emerald-100/90">
                저장된 점검 {sessionKeys.length}건 — 아래 목록에서 열 수
                있습니다.
              </p>
            )}
            <div className="mt-8 flex flex-1 flex-col items-center justify-center pb-8">
              <button
                type="button"
                onClick={handleStartInventory}
                className="flex h-16 w-full max-w-sm items-center justify-center rounded-3xl bg-gradient-to-b from-emerald-500 to-emerald-600 text-lg font-semibold text-white shadow-xl shadow-emerald-950/45 ring-1 ring-white/10 active:from-emerald-600 active:to-emerald-700"
              >
                책찍! 시작
              </button>
            </div>
          </div>
        )}

        {inSession && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="relative z-50 flex shrink-0 justify-end border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
              <button
                type="button"
                onClick={() => endInventorySession()}
                className="rounded-full border border-amber-700/80 bg-zinc-900 px-4 py-2 text-sm font-semibold text-amber-100 active:bg-zinc-800"
              >
                점검 종료
              </button>
            </header>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="relative z-30 shrink-0 px-3 pt-3">
                {lastCapturedCode ? (
                  <div
                    key={lastCaptureAt}
                    className="scan-live-code-hit w-full rounded-2xl border border-emerald-500/45 bg-emerald-950/90 px-3 py-2 text-center shadow-lg shadow-emerald-950/40"
                  >
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
                      방금 인식
                    </p>
                    <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-emerald-50">
                      {lastCapturedCode}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center text-sm text-zinc-500">
                    카메라로 바코드를 비추면 숫자가 여기 표시됩니다.
                  </div>
                )}
              </div>

              {showReader && (
                <div className="relative z-20 w-full min-w-[60%] min-h-[60dvh] shrink-0">
                  {showCameraLoading && (
                    <div className="pointer-events-none absolute inset-0 z-[50] flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm">
                      <p className="text-sm text-zinc-400">카메라 준비 중…</p>
                    </div>
                  )}
                  <div
                    id={READER_ID}
                    className="relative z-10 h-full min-h-[60dvh] w-full"
                  />
                  {mode === "camera" && <SniperLaserOverlay />}
                </div>
              )}

              {showMockPanel && (
                <div className="relative z-20 flex min-h-[40dvh] flex-col items-center justify-center px-4 py-6">
                  <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
                    <h2 className="text-center text-lg font-semibold text-white">
                      개발용 테스트 스캔
                    </h2>
                    <p className="mt-2 text-center text-sm text-zinc-400">
                      PC에서는 가상 스캔으로 숫자를 쌓을 수 있습니다.
                    </p>
                    <button
                      type="button"
                      onClick={handleMockScan}
                      className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-emerald-600 text-base font-semibold text-white active:bg-emerald-700"
                    >
                      가상 스캔 (13자리)
                    </button>
                  </div>
                </div>
              )}

              <div className="relative z-30 shrink-0 border-t border-zinc-800/80 bg-zinc-950 px-3 py-2">
                <p className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-zinc-500">
                  이번 세션 스캔 목록
                </p>
                {recentTailLines.length === 0 ? (
                  <p className="py-2 text-sm text-zinc-600">아직 스캔 없음</p>
                ) : (
                  <ul className="max-h-28 overflow-y-auto font-mono text-sm leading-snug text-zinc-200 tabular-nums">
                    {recentTailLines.map((line, i) => (
                      <li
                        key={`${line}-${i}`}
                        className={
                          line === lastCapturedCode
                            ? "font-semibold text-emerald-300"
                            : ""
                        }
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div
          className="pointer-events-none fixed bottom-[min(34vh,300px)] left-2 right-2 z-[90] mx-auto max-w-md rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-3 py-2 text-center text-sm text-emerald-100 shadow-lg"
          role="status"
        >
          {toast}
        </div>
      )}

      {inSession && (
        <div className="relative z-40 shrink-0 border-t border-zinc-800 bg-zinc-950/98 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              이번 점검 누적 (즉시 저장)
            </label>
            <CopyBarcodeListButton
              sourceText={liveSessionText}
              disabled={lineCount(liveSessionText) === 0}
            />
          </div>
          <textarea
            value={liveSessionText}
            onChange={(e) => setLiveSessionText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="min-h-[5.5rem] w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 tabular-nums outline-none ring-emerald-500/30 focus:ring-2"
          />
        </div>
      )}

      {historySection}
    </div>
  );
}
