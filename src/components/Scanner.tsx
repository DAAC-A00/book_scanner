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

/**
 * EAN-13(13자리) 체크섬 검증.
 * 앞 12자리에 대해 (홀 번째 자리 합×1 + 짝 번째 자리 합×3)의 mod 10 보완값이 13번째 자리와 일치하는지 확인한다.
 */
function isValidEAN13(code: string): boolean {
  if (code.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = code.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    sum += d * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  const last = code.charCodeAt(12) - 48;
  if (last < 0 || last > 9) return false;
  return last === checkDigit;
}

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
type BarcodeDetectorLikeConstructor = {
  new (options?: {
    formats?: string[];
  }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};
type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: BarcodeDetectorLikeConstructor;
};
type ClientInfo = {
  browser: string;
  os: string;
};
type QuaggaResultLike = {
  codeResult?: {
    code?: string | null;
  } | null;
} | null;
type QuaggaLike = {
  decodeSingle: (
    config: Record<string, unknown>,
    callback?: (result: QuaggaResultLike) => void
  ) => Promise<QuaggaResultLike>;
  stop?: () => void;
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
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const quaggaRef = useRef<QuaggaLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const detectBusyRef = useRef(false);
  const lastInvalidBeepAt = useRef(0);
  const activeEngineRef = useRef<"native" | "quagga" | null>(null);
  const scanBufferRef = useRef<string[]>([]);

  const { playSuccess, playFailure, prime } = useScanBeeps();

  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [mockTitle, setMockTitle] = useState(CAMERA_ERROR_TITLE);
  const [mockMessage, setMockMessage] = useState(CAMERA_ERROR_HINT);
  const [clientInfo, setClientInfo] = useState<ClientInfo>({
    browser: "확인 중...",
    os: "확인 중...",
  });
  const [detectorEngine, setDetectorEngine] = useState("초기화 전");
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cameraRetryToken, setCameraRetryToken] = useState(0);
  const [debugInfoOpen, setDebugInfoOpen] = useState(false);

  const inSession = activeSessionKey !== null;
  const totalBooks = countSessionLines(liveSessionText);

  useEffect(() => {
    if (!inSession) return;
    prime();
  }, [inSession, prime]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;

    const browser = (() => {
      const edge = ua.match(/Edg\/([\d.]+)/);
      if (edge) return `Edge ${edge[1]}`;
      const crios = ua.match(/CriOS\/([\d.]+)/);
      if (crios) return `Chrome ${crios[1]}`;
      const chrome = ua.match(/Chrome\/([\d.]+)/);
      if (chrome) return `Chrome ${chrome[1]}`;
      const firefox = ua.match(/FxiOS\/([\d.]+)|Firefox\/([\d.]+)/);
      if (firefox) return `Firefox ${firefox[1] ?? firefox[2]}`;
      const safari = ua.match(/Version\/([\d.]+).*Safari/);
      if (safari) return `Safari ${safari[1]}`;
      return "알 수 없는 브라우저";
    })();

    const os = (() => {
      const ios = ua.match(/OS (\d+[_\d]*) like Mac OS X/);
      if (ios) return `iOS ${ios[1].replaceAll("_", ".")}`;
      const android = ua.match(/Android ([\d.]+)/);
      if (android) return `Android ${android[1]}`;
      const mac = ua.match(/Mac OS X ([\d_]+)/);
      if (mac) return `macOS ${mac[1].replaceAll("_", ".")}`;
      const windows = ua.match(/Windows NT ([\d.]+)/);
      if (windows) return `Windows NT ${windows[1]}`;
      return navigator.platform || "알 수 없는 OS";
    })();

    setClientInfo({ browser, os });
  }, []);

  useEffect(() => {
    if (!debugInfoOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDebugInfoOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [debugInfoOpen]);

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
    window.clearInterval(scanTimerRef.current);
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
      activeEngineRef.current = null;
      detectorRef.current = null;
      quaggaRef.current = null;
      stopCameraStream();
      setMode("idle");
      setDetectorEngine("초기화 전");
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

      try {
        const nativeCtor = (window as WindowWithBarcodeDetector).BarcodeDetector;
        let useNative = false;
        let nativeFormats: string[] = [];

        if (nativeCtor && typeof nativeCtor.getSupportedFormats === "function") {
          try {
            const supported = await nativeCtor.getSupportedFormats();
            if (supported.includes("ean_13")) {
              nativeFormats = BARCODE_FORMATS.filter((fmt) => supported.includes(fmt));
              useNative = nativeFormats.length > 0;
            }
          } catch {
            useNative = false;
          }
        }

        if (useNative && nativeCtor) {
          detectorRef.current = new nativeCtor({ formats: nativeFormats });
          quaggaRef.current = null;
          activeEngineRef.current = "native";
          setDetectorEngine("Native BarcodeDetector");
        } else {
          const module = (await import("@ericblade/quagga2")) as {
            default: QuaggaLike;
          };
          quaggaRef.current = module.default;
          detectorRef.current = null;
          activeEngineRef.current = "quagga";
          setDetectorEngine("Quagga2 Fallback");
        }
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
      activeEngineRef.current = null;
      detectorRef.current = null;
      scanBufferRef.current = [];
      if (quaggaRef.current?.stop) {
        try {
          quaggaRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      quaggaRef.current = null;
      stopCameraStream();
    };
  }, [activeSessionKey, cameraRetryToken, clearScanTimer, stopCameraStream]);

  useEffect(() => {
    if (!inSession || mode !== "camera") return;

    const pushEan13Consensus = (code: string) => {
      const buf = scanBufferRef.current;
      buf.push(code);
      while (buf.length > 3) buf.shift();
      if (
        buf.length === 3 &&
        buf[0] === buf[1] &&
        buf[1] === buf[2]
      ) {
        handleDecoded(buf[0]);
        scanBufferRef.current = [];
      }
    };

    const tick = async () => {
      if (detectBusyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      detectBusyRef.current = true;
      try {
        const engine = activeEngineRef.current;
        if (engine === "native") {
          const detector = detectorRef.current;
          if (!detector) return;
          const result = await detector.detect(video);
          const rawValue = result[0]?.rawValue?.trim();
          if (
            rawValue &&
            DIGIT_ONLY.test(rawValue) &&
            isValidEAN13(rawValue)
          ) {
            pushEan13Consensus(rawValue);
          }
          return;
        }

        if (engine === "quagga") {
          const quagga = quaggaRef.current;
          const canvas = frameCanvasRef.current;
          if (!quagga || !canvas) return;
          const vw = video.videoWidth || 1280;
          const vh = video.videoHeight || 720;
          const cropW = Math.max(1, Math.floor(vw * 0.6));
          const cropH = Math.max(1, Math.floor(vh * 0.6));
          const sx = Math.floor((vw - cropW) / 2);
          const sy = Math.floor((vh - cropH) / 2);
          if (canvas.width !== cropW) canvas.width = cropW;
          if (canvas.height !== cropH) canvas.height = cropH;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

          const frameDataUrl = canvas.toDataURL("image/jpeg", 0.92);
          const result = await quagga.decodeSingle({
            src: frameDataUrl,
            locate: true,
            numOfWorkers: 0,
            inputStream: {
              type: "ImageStream",
              size: 960,
            },
            locator: {
              patchSize: "medium",
              halfSample: true,
            },
            decoder: {
              readers: ["ean_reader", "ean_8_reader"],
            },
          });
          const rawValue = result?.codeResult?.code?.trim();
          if (
            rawValue &&
            DIGIT_ONLY.test(rawValue) &&
            isValidEAN13(rawValue)
          ) {
            pushEan13Consensus(rawValue);
          }
        }
      } catch {
        /* ignore decode errors */
      } finally {
        detectBusyRef.current = false;
      }
    };

    clearScanTimer();
    scanTimerRef.current = window.setInterval(() => {
      void tick();
    }, SCAN_INTERVAL_MS);

    return () => {
      clearScanTimer();
      detectBusyRef.current = false;
      scanBufferRef.current = [];
      if (quaggaRef.current?.stop) {
        try {
          quaggaRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      const canvas = frameCanvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [clearScanTimer, handleDecoded, inSession, mode]);

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
                <>
                  <button
                    type="button"
                    id="scan-debug-info-trigger"
                    aria-haspopup="dialog"
                    aria-expanded={debugInfoOpen}
                    aria-controls="scan-debug-info-dialog"
                    onClick={() => setDebugInfoOpen(true)}
                    className="flex min-h-14 min-w-14 items-center justify-center rounded-2xl border border-zinc-600/90 bg-zinc-900 text-base font-bold italic text-zinc-300 active:bg-zinc-800"
                  >
                    i
                  </button>
                  <button
                    type="button"
                    onClick={handleExitSession}
                    className="min-h-14 min-w-[5.5rem] rounded-2xl border border-amber-700/80 bg-zinc-900 px-4 py-3 text-sm font-semibold text-amber-100 active:bg-zinc-800"
                  >
                    점검 중단
                  </button>
                </>
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

            <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {showCameraArea && (
                <div className="relative z-20 min-h-[48dvh] w-full min-w-0 flex-1">
                  <canvas ref={frameCanvasRef} className="hidden" aria-hidden />
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
        <div className="relative z-40 shrink-0 border-t border-zinc-800/90 bg-zinc-950 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
          <div className="mb-1.5">
            <label
              htmlFor="scan-session-textarea"
              className="block text-xs font-semibold uppercase tracking-wide text-zinc-400"
            >
              이번 점검 기록
            </label>
            <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
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
            className="min-h-[6.5rem] max-h-[22dvh] w-full cursor-default resize-none rounded-xl border border-zinc-700 bg-zinc-900/80 px-2.5 py-2 font-mono text-sm leading-relaxed text-zinc-100 tabular-nums outline-none sm:min-h-[7rem] sm:text-base"
          />
        </div>
      )}

      {inSession && debugInfoOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-6"
          role="presentation"
          onClick={() => setDebugInfoOpen(false)}
        >
          <div
            id="scan-debug-info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-debug-info-title"
            className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/95 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="scan-debug-info-title"
              className="text-center text-lg font-semibold text-white"
            >
              디버그 정보
            </h2>
            <p className="mt-3 text-[11px] text-zinc-300">
              브라우저: {clientInfo.browser}
            </p>
            <p className="mt-1 text-[11px] text-zinc-300">OS: {clientInfo.os}</p>
            <p className="mt-1 text-[11px] text-zinc-400">
              스캔 엔진: {detectorEngine}
            </p>
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setDebugInfoOpen(false)}
                className="min-h-14 w-full rounded-2xl border border-zinc-600 bg-zinc-800 px-4 py-3 text-base font-semibold text-zinc-100 active:bg-zinc-700"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
