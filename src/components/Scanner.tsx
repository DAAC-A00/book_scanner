"use client";

import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import AppHeader from "@/components/AppHeader";
import ClipboardIcon from "@/components/ClipboardIcon";
import InstagramIcon from "@/components/InstagramIcon";
import { useScanBeeps } from "@/hooks/useScanBeeps";
import { INSTAGRAM_GARAM_LIB_URL } from "@/lib/brand";
import { countSessionLines, toPlainSessionText } from "@/lib/sessionText";
import { useScannerStore } from "@/store/useScannerStore";

/** html5-qrcode 가 시각·비디오를 붙이는 요소 (요구사항 id) */
const READER_ID = "reader";
const DIGIT_ONLY = /^\d+$/;
/** 카메라가 같은 프레임에서 비숫자를 연속 디코딩할 때 비프 스팸 방지 */
const INVALID_BEEP_COOLDOWN_MS = 900;

/** zoom 기능을 포함한 확장 타입 (표준 MediaTrackCapabilities 에 zoom 미포함) */
interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  zoom?: { min: number; max: number; step: number };
}
interface ExtendedMediaTrackConstraintSet extends MediaTrackConstraintSet {
  zoom?: number;
}

function isLikelyDesktop(): boolean {
  if (typeof window === "undefined") return true;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasTouch =
    "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  return !coarsePointer && !hasTouch;
}

function ViewfinderOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[45] flex flex-col items-center justify-center gap-2"
      aria-hidden
    >
      <div
        className="relative rounded-lg border-2 border-white/70"
        style={{ width: "22vw", aspectRatio: "1 / 1" }}
      >
        <span className="absolute -left-px -top-px h-3 w-3 rounded-tl-lg border-l-2 border-t-2 border-emerald-400" />
        <span className="absolute -right-px -top-px h-3 w-3 rounded-tr-lg border-r-2 border-t-2 border-emerald-400" />
        <span className="absolute -bottom-px -left-px h-3 w-3 rounded-bl-lg border-b-2 border-l-2 border-emerald-400" />
        <span className="absolute -bottom-px -right-px h-3 w-3 rounded-br-lg border-b-2 border-r-2 border-emerald-400" />
      </div>
      <p className="rounded-full bg-black/50 px-3 py-1 text-[11px] font-medium tracking-wide text-white/80 backdrop-blur-sm">
        거리를 조금 띄워주세요
      </p>
    </div>
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100dvh",
  maxHeight: "100dvh",
};

type ScannerProps = {
  onExitSession?: () => void;
};

export default function Scanner({ onExitSession }: ScannerProps) {
  const activeSessionKey = useScannerStore((s) => s.activeSessionKey);
  const endInventorySession = useScannerStore((s) => s.endInventorySession);
  const liveSessionText = useScannerStore((s) => s.liveSessionText);
  const setLiveSessionText = useScannerStore((s) => s.setLiveSessionText);
  const appendDigitScanToActiveSession = useScannerStore(
    (s) => s.appendDigitScanToActiveSession
  );
  const lastCapturedCode = useScannerStore((s) => s.lastCapturedCode);
  const lastCaptureAt = useScannerStore((s) => s.lastCaptureAt);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastInvalidBeepAt = useRef(0);

  const { playSuccess, playFailure, prime } = useScanBeeps();

  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cameraRetryToken, setCameraRetryToken] = useState(0);
  const [sessionCopyDone, setSessionCopyDone] = useState(false);
  const sessionCopyTimerRef = useRef<number | null>(null);

  const inSession = activeSessionKey !== null;
  const totalBooks = countSessionLines(liveSessionText);

  useEffect(() => {
    if (!inSession) return;
    prime();
  }, [inSession, prime]);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current !== null) {
        window.clearTimeout(sessionCopyTimerRef.current);
      }
    };
  }, []);

  const triggerFeedback = useCallback(
    (digits: string) => {
      playSuccess();
      setFlashKey(Date.now());
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate([100]);
      }
      setToast(`기록했어요: ${digits}`);
      window.setTimeout(() => setToast(null), 1500);
    },
    [playSuccess]
  );

  const handleDecoded = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!DIGIT_ONLY.test(trimmed)) {
        const now = Date.now();
        if (now - lastInvalidBeepAt.current >= INVALID_BEEP_COOLDOWN_MS) {
          lastInvalidBeepAt.current = now;
          playFailure();
        }
        return;
      }
      const ok = appendDigitScanToActiveSession(trimmed);
      if (ok) triggerFeedback(trimmed);
      else playFailure();
    },
    [appendDigitScanToActiveSession, playFailure, triggerFeedback]
  );

  const copyCurrentSession = useCallback(async () => {
    const plain = toPlainSessionText(liveSessionText);
    if (!plain) {
      setToast("복사할 바코드가 없어요.");
      window.setTimeout(() => setToast(null), 1600);
      return;
    }
    try {
      await navigator.clipboard.writeText(plain);
      setSessionCopyDone(true);
      setToast("클립보드에 복사했어요. 민경 선생님께 붙여 넣어내면 돼요.");
      window.setTimeout(() => setToast(null), 2200);
      if (sessionCopyTimerRef.current !== null) {
        window.clearTimeout(sessionCopyTimerRef.current);
      }
      sessionCopyTimerRef.current = window.setTimeout(
        () => setSessionCopyDone(false),
        2000
      );
    } catch {
      window.alert(
        "복사에 실패했습니다. 아래 목록을 길게 눌러 직접 복사해 주세요."
      );
    }
  }, [liveSessionText]);

  const retryCamera = useCallback(() => {
    setCameraRetryToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!inSession || mode !== "mock" || isLikelyDesktop()) return;

    const onVisibilityChange = () => {
      if (!document.hidden) setCameraRetryToken((prev) => prev + 1);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [inSession, mode]);

  useEffect(() => {
    const shouldRunCamera = activeSessionKey !== null;
    if (!shouldRunCamera) {
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

    // 이전 시도에서 남은 DOM 잔재 제거 후 새 인스턴스 생성
    const readerEl = document.getElementById(READER_ID);
    if (readerEl) readerEl.innerHTML = "";

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
        // getCameras() 호출 없이 바로 후면 카메라로 시작
        // (getCameras()는 내부적으로 getUserMedia를 중복 호출해 권한 충돌 유발)
        const scanConfig = { fps: 12 };
        const envConstraints: MediaTrackConstraints = {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
        };

        await scanner.start(
          envConstraints,
          scanConfig,
          handleDecoded,
          () => {}
        );

        if (!cancelled) {
          setMode("camera");

          window.setTimeout(() => {
            try {
              const videoEl = document.querySelector(
                `#${READER_ID} video`
              ) as HTMLVideoElement | null;
              if (!videoEl?.srcObject) return;

              const stream = videoEl.srcObject as MediaStream;
              const track = stream.getVideoTracks()[0];
              if (!track) return;

              const capabilities =
                track.getCapabilities() as ExtendedMediaTrackCapabilities;
              if (capabilities?.zoom) {
                const targetZoom = Math.min(2.0, capabilities.zoom.max);
                const constraintSet: ExtendedMediaTrackConstraintSet = {
                  zoom: targetZoom,
                };
                void track.applyConstraints({ advanced: [constraintSet] });
              }
            } catch {
              /* 미지원 기기에서 조용히 무시 */
            }
          }, 1000);
        }
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
  }, [activeSessionKey, handleDecoded, cameraRetryToken]);

  const showReader = inSession && !isLikelyDesktop() && mode !== "mock";
  const showMockPanel = inSession && mode === "mock";
  const showCameraLoading =
    inSession && !isLikelyDesktop() && mode === "loading";

  const handleExitSession = () => {
    if (
      !window.confirm(
        "점검을 중단하고 첫 화면으로 돌아갈까요?\n이미 찍은 번호는 이 휴대폰(브라우저)에 그대로 남아 있어요."
      )
    )
      return;
    endInventorySession();
    onExitSession?.();
  };

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
        {inSession && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
            <AppHeader
              rightSlot={
                <button
                  type="button"
                  onClick={handleExitSession}
                  className="min-h-14 min-w-[5.5rem] rounded-2xl border border-amber-700/80 bg-zinc-900 px-4 py-3 text-sm font-semibold text-amber-100 active:bg-zinc-800"
                >
                  점검 중단
                </button>
              }
            />

            <div
              className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur-sm"
              aria-live="polite"
            >
              <div className="mb-3 flex flex-col items-center border-b border-zinc-800/50 pb-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  지금까지 점검
                </p>
                {lastCaptureAt > 0 ? (
                  <p
                    key={`total-${lastCaptureAt}`}
                    className="scan-total-hit mt-1 text-2xl font-bold tabular-nums sm:text-3xl"
                  >
                    총 <span className="tabular-nums">{totalBooks}</span>권
                  </p>
                ) : (
                  <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-400 sm:text-3xl">
                    총 <span className="tabular-nums">{totalBooks}</span>권
                  </p>
                )}
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                방금 인식
              </p>
              {lastCapturedCode ? (
                <p
                  key={`code-${lastCaptureAt}`}
                  className="scan-live-code-hit mt-1 break-all text-center text-3xl font-bold tabular-nums tracking-tight text-emerald-300 sm:text-4xl"
                >
                  {lastCapturedCode}
                </p>
              ) : (
                <p className="mt-1 text-center text-sm leading-snug text-zinc-500">
                  아직 없어요. 책등·바코드가{" "}
                  <span className="text-zinc-400">숫자만</span> 보이게 비춰
                  주세요.
                </p>
              )}
            </div>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
              {showReader && (
                <div className="relative z-20 w-full min-w-[60%] min-h-[40dvh] shrink-0">
                  {showCameraLoading && (
                    <div className="pointer-events-none absolute inset-0 z-[50] flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm">
                      <p className="text-sm text-zinc-400">카메라 준비 중…</p>
                    </div>
                  )}
                  <div
                    id={READER_ID}
                    className="relative z-10 h-full min-h-[40dvh] w-full"
                  />
                  {mode === "camera" && <ViewfinderOverlay />}
                </div>
              )}

              {showMockPanel && (
                <div className="relative z-20 flex min-h-[40dvh] flex-col items-center justify-center px-4 py-6">
                  <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
                    <h2 className="text-center text-lg font-semibold text-white">
                      카메라를 켤 수 없어요
                    </h2>
                    <p className="mt-3 text-center text-sm leading-relaxed text-zinc-400">
                      브라우저 주소창 왼쪽의 잠금(🔒) 아이콘을 눌러 카메라
                      권한을 <strong className="text-zinc-200">허용</strong>으로
                      바꾼 뒤, 아래 버튼을 눌러 주세요.
                    </p>
                    <p className="mt-2 text-center text-xs text-zinc-500">
                      설정을 마치고 이 화면으로 돌아오면 자동으로 다시
                      연결합니다.
                    </p>
                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={retryCamera}
                        className="min-h-14 w-full rounded-2xl border border-emerald-700/70 bg-emerald-900/70 px-4 py-3 text-base font-semibold text-emerald-100 transition active:scale-[0.99]"
                      >
                        카메라 다시 연결하기
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
        <div className="relative z-40 shrink-0 border-t border-amber-500/10 bg-zinc-950/98 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => void copyCurrentSession()}
              className={`flex min-h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold transition active:scale-[0.99] ${
                sessionCopyDone
                  ? "bg-emerald-600 text-white"
                  : "border border-emerald-600/50 bg-emerald-950/50 text-emerald-100 active:bg-emerald-950/80"
              }`}
            >
              <ClipboardIcon className="h-5 w-5 shrink-0 opacity-90" />
              {sessionCopyDone ? "복사 완료" : "클립보드 복사"}
            </button>
            <a
              href={INSTAGRAM_GARAM_LIB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-2xl border border-pink-500/35 bg-zinc-900 text-pink-300 active:bg-zinc-800"
              aria-label="가람고 도서관 인스타그램 (새 창)"
            >
              <InstagramIcon className="h-7 w-7" />
            </a>
          </div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            이번 점검에 모은 번호
          </label>
          <textarea
            value={liveSessionText}
            onChange={(e) => setLiveSessionText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="min-h-[12rem] max-h-[45dvh] w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 font-mono text-base leading-relaxed text-zinc-100 tabular-nums outline-none ring-emerald-500/30 focus:ring-2"
          />
        </div>
      )}
    </div>
  );
}
