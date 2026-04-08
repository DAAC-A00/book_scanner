"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import AppHeader from "@/components/AppHeader";
import { useScanBeeps } from "@/hooks/useScanBeeps";
import { countSessionLines } from "@/lib/sessionText";
import { useScannerStore } from "@/store/useScannerStore";

const DIGIT_ONLY = /^\d+$/;
/** 카메라가 같은 프레임에서 비숫자를 연속 디코딩할 때 비프 스팸 방지 */
const INVALID_BEEP_COOLDOWN_MS = 900;
const SCAN_INTERVAL_MS = 100;
const UNSUPPORTED_MESSAGE =
  "이 브라우저는 네이티브 바코드 스캔을 지원하지 않습니다. Safari 17 이상이나 최신 Chrome을 사용해주세요.";
const CAMERA_ERROR_TITLE = "카메라를 켤 수 없어요";
const CAMERA_ERROR_HINT =
  "카메라 엑세스 허용 후 이 화면으로 돌아오면 자동으로 다시 연결합니다.";
const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
] as const;

type BarcodeFormatValue = (typeof BARCODE_FORMATS)[number];
type DetectedBarcodeLike = { rawValue?: string | null };
type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcodeLike[]>;
};
type BarcodeDetectorLikeConstructor = new (options?: {
  formats?: BarcodeFormatValue[];
}) => BarcodeDetectorLike;
type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: BarcodeDetectorLikeConstructor;
};


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
  const appendDigitScanToActiveSession = useScannerStore(
    (s) => s.appendDigitScanToActiveSession
  );
  const lastCapturedCode = useScannerStore((s) => s.lastCapturedCode);
  const lastCaptureAt = useScannerStore((s) => s.lastCaptureAt);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const detectBusyRef = useRef(false);
  const lastInvalidBeepAt = useRef(0);

  const { playSuccess, playFailure, prime } = useScanBeeps();

  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [mockTitle, setMockTitle] = useState(CAMERA_ERROR_TITLE);
  const [mockMessage, setMockMessage] = useState(CAMERA_ERROR_HINT);
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cameraRetryToken, setCameraRetryToken] = useState(0);

  const inSession = activeSessionKey !== null;
  const totalBooks = countSessionLines(liveSessionText);

  useEffect(() => {
    if (!inSession) return;
    prime();
  }, [inSession, prime]);

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

  const retryCamera = useCallback(() => {
    setCameraRetryToken((prev) => prev + 1);
  }, []);

  const clearScanTimer = useCallback(() => {
    if (scanTimerRef.current === null) return;
    window.clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
  }, []);

  const stopCameraStream = useCallback(() => {
    const directVideo = videoRef.current;
    const srcObject =
      directVideo?.srcObject instanceof MediaStream ? directVideo.srcObject : null;
    const stream = srcObject ?? streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (directVideo) {
      directVideo.srcObject = null;
    }
    streamRef.current = null;
  }, []);

  const scheduleNextScan = useCallback(
    (run: () => void) => {
      clearScanTimer();
      scanTimerRef.current = window.setTimeout(run, SCAN_INTERVAL_MS);
    },
    [clearScanTimer]
  );

  const startScanLoop = useCallback(() => {
    const run = async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector) return;

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleNextScan(run);
        return;
      }
      if (detectBusyRef.current) {
        scheduleNextScan(run);
        return;
      }

      detectBusyRef.current = true;
      try {
        const result = await detector.detect(video);
        const rawValue = result[0]?.rawValue?.trim();
        if (rawValue && DIGIT_ONLY.test(rawValue)) {
          handleDecoded(rawValue);
        }
      } catch {
        /* ignore detection errors */
      } finally {
        detectBusyRef.current = false;
        scheduleNextScan(run);
      }
    };
    scheduleNextScan(run);
  }, [handleDecoded, scheduleNextScan]);

  useEffect(() => {
    if (!inSession || mode !== "mock") return;

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
      clearScanTimer();
      detectBusyRef.current = false;
      detectorRef.current = null;
      stopCameraStream();
      setMode("idle");
      return;
    }

    let cancelled = false;
    setMode("loading");
    setMockTitle(CAMERA_ERROR_TITLE);
    setMockMessage(CAMERA_ERROR_HINT);

    const start = async () => {
      const videoEl = videoRef.current;
      if (!videoEl) {
        if (!cancelled) {
          setMockTitle(CAMERA_ERROR_TITLE);
          setMockMessage(CAMERA_ERROR_HINT);
          setMode("mock");
        }
        return;
      }

      const BarcodeDetectorCtor = (window as WindowWithBarcodeDetector).BarcodeDetector;
      if (!BarcodeDetectorCtor) {
        if (!cancelled) {
          setMockTitle("지원되지 않는 브라우저");
          setMockMessage(UNSUPPORTED_MESSAGE);
          setMode("mock");
        }
        return;
      }

      try {
        detectorRef.current = new BarcodeDetectorCtor({
          formats: [...BARCODE_FORMATS],
        });
      } catch {
        if (!cancelled) {
          setMockTitle("스캔 엔진 초기화 실패");
          setMockMessage(UNSUPPORTED_MESSAGE);
          setMode("mock");
        }
        detectorRef.current = null;
        return;
      }

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          if (!cancelled) {
            setMockTitle(CAMERA_ERROR_TITLE);
            setMockMessage(CAMERA_ERROR_HINT);
            setMode("mock");
          }
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        videoEl.srcObject = stream;
        await videoEl.play();

        if (cancelled) return;
        setMode("camera");
      } catch {
        if (cancelled) return;
        stopCameraStream();
        setMockTitle(CAMERA_ERROR_TITLE);
        setMockMessage(CAMERA_ERROR_HINT);
        setMode("mock");
      }
    };

    void start();

    return () => {
      cancelled = true;
      clearScanTimer();
      detectBusyRef.current = false;
      detectorRef.current = null;
      stopCameraStream();
    };
  }, [activeSessionKey, cameraRetryToken, clearScanTimer, stopCameraStream]);

  useEffect(() => {
    if (!inSession || mode !== "camera") return;
    startScanLoop();
    return () => {
      clearScanTimer();
      detectBusyRef.current = false;
    };
  }, [clearScanTimer, inSession, mode, startScanLoop]);

  const showCameraArea = inSession;
  const showMockPanel = inSession && mode === "mock";
  const showCameraLoading = showCameraArea && mode === "loading";

  const handleExitSession = () => {
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
              {showCameraArea && (
                <div
                  className="relative z-20 w-full shrink-0"
                  style={{ minHeight: "40dvh", height: "40dvh" }}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="relative z-10 h-full w-full bg-zinc-900 object-cover"
                  />

                  {/* 로딩 오버레이 */}
                  {showCameraLoading && (
                    <div className="pointer-events-none absolute inset-0 z-[50] flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm">
                      <p className="text-sm text-zinc-400">카메라 준비 중…</p>
                    </div>
                  )}

                  {/* 권한 오류 오버레이 — #reader 위에 absolute 로 덮음 */}
                  {showMockPanel && (
                    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-zinc-950 px-4">
                      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
                        <h2 className="text-center text-lg font-semibold text-white">
                          {mockTitle}
                        </h2>
                        <p className="mt-2 text-center text-xs text-zinc-500">
                          {mockMessage}
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
        <div className="relative z-40 shrink-0 border-t border-zinc-800/90 bg-zinc-950 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mb-2">
            <label
              htmlFor="scan-session-textarea"
              className="block text-xs font-semibold uppercase tracking-wide text-zinc-400"
            >
              이번 점검 기록
            </label>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
              찍힌 번호만 아래에 쌓여요. 수정·복사는{" "}
              <span className="text-zinc-400">지난 점검 기록</span>에서 할 수
              있어요.
            </p>
          </div>
          <textarea
            id="scan-session-textarea"
            value={liveSessionText}
            readOnly
            aria-readonly="true"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            tabIndex={-1}
            className="min-h-[13rem] max-h-[45dvh] w-full cursor-default resize-none rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 font-mono text-base leading-relaxed text-zinc-100 tabular-nums outline-none"
          />
        </div>
      )}
    </div>
  );
}
