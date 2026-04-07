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

const VIEWFINDER_ID = "book-scanner-viewfinder";
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

const shellStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100%",
  minHeight: "100dvh",
  zIndex: 100,
};

export default function Scanner() {
  const activeSessionKey = useScannerStore((s) => s.activeSessionKey);
  const cameraActive = useScannerStore((s) => s.cameraActive);
  const beginInventorySession = useScannerStore((s) => s.beginInventorySession);
  const endInventorySession = useScannerStore((s) => s.endInventorySession);
  const startCameraScan = useScannerStore((s) => s.startCameraScan);
  const stopCameraScan = useScannerStore((s) => s.stopCameraScan);
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
  const cameraShouldRun = cameraActive && activeSessionKey !== null;

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
    if (!cameraShouldRun) {
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

    const scanner = new Html5Qrcode(VIEWFINDER_ID, {
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

        const scanConfig = {
          fps: 12,
          qrbox: (w: number, h: number) => ({ width: w, height: h }),
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
  }, [cameraShouldRun, handleDecoded]);

  const showViewfinder = cameraShouldRun && mode === "camera";
  const showMockPanel = cameraShouldRun && mode === "mock";
  const showBrowseChrome = !inSession;
  const showSessionHub = inSession && !cameraActive;

  const recentTailLines = useMemo(() => {
    const lines = liveSessionText.split("\n").filter((l) => l.length > 0);
    return lines.slice(-6);
  }, [liveSessionText]);

  const openHistory = useCallback(
    (key: string) => {
      setHistoryKey(key);
      setHistoryText(readSessionRaw(key));
    },
    []
  );

  const onHistoryTextChange = useCallback((text: string) => {
    if (!historyKey) return;
    setHistoryText(text);
    writeSessionRaw(historyKey, text);
  }, [historyKey]);

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

  return (
    <div
      className="isolate flex flex-col bg-zinc-950 text-zinc-100"
      style={shellStyle}
    >
      {flashKey != null && (
        <div
          key={flashKey}
          className="pointer-events-none fixed inset-0 z-50 box-border rounded-none border-[6px] border-solid border-transparent scan-success-flash"
          onAnimationEnd={() => setFlashKey(null)}
          aria-hidden
        />
      )}

      <div
        id={VIEWFINDER_ID}
        className="absolute inset-0 h-full w-full min-w-0 overflow-hidden [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        hidden={!showViewfinder}
      />

      {showBrowseChrome && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[min(52dvh,22rem)]">
          <h1 className="text-lg font-semibold tracking-tight text-white">
            장서점검
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            첫 화면에서는 카메라를 켜지 않습니다. 저장된 기록을 확인하거나 새
            점검을 시작하세요.
          </p>

          {mounted && sessionKeys.length > 0 && (
            <div className="mt-4 rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-100/90">
              저장된 점검이 {sessionKeys.length}건 있습니다. 아래 목록에서
              눌러 조회·수정할 수 있습니다.
            </div>
          )}

          <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            저장된 장서점검 기록
          </h2>
          <p className="mt-1 text-xs text-zinc-600">
            항목을 선택하면 내용을 편집하거나 삭제할 수 있습니다.
          </p>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900/50">
            {!mounted ? (
              <p className="p-4 text-sm text-zinc-500">불러오는 중…</p>
            ) : sessionKeys.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">
                저장된 점검 기록이 없습니다.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {sessionKeys.map((key) => {
                  const raw = readSessionRaw(key);
                  const n = lineCount(raw);
                  const active = historyKey === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => openHistory(key)}
                        className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left active:bg-zinc-800/80 ${active ? "bg-zinc-800/60" : ""}`}
                      >
                        <span className="text-sm font-medium text-zinc-100">
                          {formatSessionKeyLabel(key)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          스캔 {n}건
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {historyKey && (
            <div className="mt-3 shrink-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-zinc-500">
                  편집: {formatSessionKeyLabel(historyKey)}
                </span>
                <button
                  type="button"
                  onClick={handleDeleteHistory}
                  className="shrink-0 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-200 active:bg-red-950/70"
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
                className="max-h-36 min-h-[6rem] w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm leading-relaxed text-zinc-100 tabular-nums outline-none ring-emerald-500/30 focus:ring-2"
              />
            </div>
          )}

          <div className="mt-auto flex shrink-0 flex-col items-center pt-4">
            <button
              type="button"
              onClick={handleStartInventory}
              className="flex h-16 w-full max-w-sm items-center justify-center rounded-3xl bg-emerald-600 text-lg font-semibold text-white shadow-xl shadow-emerald-950/40 active:bg-emerald-700"
            >
              장서점검 시작
            </button>
            <p className="mt-3 max-w-sm text-center text-xs leading-relaxed text-zinc-500">
              세션만 열리며 카메라는 켜지지 않습니다. 스캔은 다음 단계의
              「바코드 스캔」에서 시작합니다.
            </p>
          </div>
        </div>
      )}

      {showSessionHub && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[min(52dvh,22rem)]">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => endInventorySession()}
              className="rounded-full border border-zinc-600 bg-zinc-900/90 px-4 py-2 text-sm font-medium text-zinc-200 active:bg-zinc-800"
            >
              점검 종료
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2">
            <p className="text-center text-sm font-medium text-zinc-300">
              이번 점검 세션이 열렸습니다
            </p>
            <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-zinc-500">
              카메라와 마이크(일부 기기) 권한은{" "}
              <span className="text-zinc-300">「바코드 스캔」</span>을 눌렀을
              때만 요청됩니다. 먼저 아래에서 목록을 확인해도 됩니다.
            </p>
            <button
              type="button"
              onClick={() => startCameraScan()}
              className="mt-10 flex h-[min(4.25rem,16vw)] w-full max-w-sm items-center justify-center rounded-3xl bg-emerald-600 text-lg font-semibold text-white shadow-xl shadow-emerald-950/40 active:bg-emerald-700"
            >
              바코드 스캔
            </button>
          </div>
        </div>
      )}

      {cameraShouldRun && mode === "loading" && !isLikelyDesktop() && (
        <div className="relative z-10 flex flex-1 items-center justify-center pb-52">
          <p className="text-sm text-zinc-500">카메라 준비 중…</p>
        </div>
      )}

      {showMockPanel && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-52 pt-4">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-8 shadow-xl shadow-black/40">
            <h2 className="text-center text-xl font-semibold tracking-tight text-white">
              개발용 테스트 스캔
            </h2>
            <p className="mt-3 text-center text-base leading-relaxed text-zinc-400">
              PC에서는 카메라 대신 아래 버튼으로 숫자 기록을 쌓을 수 있습니다.
            </p>
            <button
              type="button"
              onClick={handleMockScan}
              className="mt-8 flex h-16 w-full items-center justify-center rounded-2xl bg-emerald-600 text-lg font-semibold text-white shadow-lg shadow-emerald-950/50 active:bg-emerald-700"
            >
              가상 스캔 (13자리)
            </button>
          </div>
        </div>
      )}

      {cameraShouldRun && (mode === "camera" || mode === "mock") && (
        <>
          <div className="pointer-events-auto fixed inset-x-0 top-0 z-40 flex flex-wrap justify-end gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => stopCameraScan()}
              className="rounded-full border border-zinc-500 bg-zinc-950/90 px-4 py-2.5 text-sm font-semibold text-zinc-100 shadow-lg shadow-black/40 active:bg-zinc-900"
            >
              카메라 끄기
            </button>
            <button
              type="button"
              onClick={() => endInventorySession()}
              className="rounded-full border border-amber-700/80 bg-zinc-950/90 px-4 py-2.5 text-sm font-semibold text-amber-100 shadow-lg shadow-black/40 active:bg-zinc-900"
            >
              점검 종료
            </button>
          </div>

          <div className="pointer-events-none fixed inset-x-0 top-[max(4.5rem,env(safe-area-inset-top)+3rem)] z-30 flex flex-col items-center px-4">
            {lastCapturedCode ? (
              <div
                key={lastCaptureAt}
                className="scan-live-code-hit w-full max-w-lg rounded-2xl border border-emerald-500/50 bg-emerald-950/85 px-4 py-3 text-center shadow-lg shadow-emerald-950/50 backdrop-blur-sm"
              >
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
                  방금 인식
                </p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums tracking-tight text-emerald-50">
                  {lastCapturedCode}
                </p>
                {recentTailLines.length > 1 && (
                  <div className="mt-3 border-t border-emerald-800/60 pt-2 text-left">
                    <p className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-emerald-500/80">
                      최근 스캔
                    </p>
                    <ul className="max-h-24 space-y-1 overflow-y-auto font-mono text-xs leading-snug text-emerald-100/90 tabular-nums">
                      {recentTailLines.map((line, i) => (
                        <li
                          key={`${lastCaptureAt}-${i}-${line}`}
                          className={
                            line === lastCapturedCode
                              ? "font-semibold text-white"
                              : ""
                          }
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-700/80 bg-zinc-950/80 px-4 py-3 text-center backdrop-blur-sm">
                <p className="text-sm text-zinc-400">
                  바코드를 비추면 숫자가 여기에 바로 표시됩니다.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex max-h-[min(48dvh,24rem)] flex-col border-t border-zinc-800 bg-zinc-950/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        {toast && (
          <div
            className="mb-2 rounded-xl border border-emerald-500/40 bg-emerald-950/90 px-3 py-2 text-center text-sm text-emerald-100"
            role="status"
          >
            {toast}
          </div>
        )}
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
          {inSession
            ? "이번 점검 누적 (즉시 저장 · 수정 가능)"
            : "이번 점검 미리보기"}
        </label>
        {inSession ? (
          <textarea
            value={liveSessionText}
            onChange={(e) => setLiveSessionText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="min-h-[6.5rem] w-full flex-1 resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm leading-relaxed text-zinc-100 tabular-nums outline-none ring-emerald-500/40 focus:ring-2"
            placeholder="스캔한 숫자가 한 줄씩 즉시 반영됩니다. 카메라는 「바코드 스캔」에서만 켜집니다."
          />
        ) : (
          <div className="min-h-[6.5rem] w-full rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-3 text-sm text-zinc-600">
            「장서점검 시작」 후 이 영역에 이번 세션 데이터가 표시됩니다.
          </div>
        )}
      </div>
    </div>
  );
}
