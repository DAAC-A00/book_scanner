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
import { useScanBeeps } from "@/hooks/useScanBeeps";
import { countSessionLines } from "@/lib/sessionText";
import { useScannerStore } from "@/store/useScannerStore";

/** html5-qrcode 가 시각·비디오를 붙이는 요소 (요구사항 id) */
const READER_ID = "reader";
const DIGIT_ONLY = /^\d+$/;
/** 카메라가 같은 프레임에서 비숫자를 연속 디코딩할 때 비프 스팸 방지 */
const INVALID_BEEP_COOLDOWN_MS = 900;


function isLikelyDesktop(): boolean {
  if (typeof window === "undefined") return true;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasTouch =
    "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  return !coarsePointer && !hasTouch;
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

    const start = async () => {
      // 이전 시도 DOM 잔재 제거 (#reader는 항상 마운트되어 있으므로 안전)
      try {
        const readerEl = document.getElementById(READER_ID);
        if (readerEl) readerEl.innerHTML = "";
      } catch { /* ignore */ }

      // Html5Qrcode 생성자도 throw 가능 → async 함수 안에서 try/catch로 감쌈
      let scanner: Html5Qrcode;
      try {
        scanner = new Html5Qrcode(READER_ID, {
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
      } catch {
        if (!cancelled) setMode("mock");
        return;
      }
      scannerRef.current = scanner;

      try {
        const scanConfig = { fps: 12 };

        // getCameras()는 iOS Safari에서 카메라 권한 팝업을 띄우는 트리거
        // 반드시 호출해야 iOS 권한 다이얼로그가 표시됨
        let cameras: Array<{ id: string; label: string }> = [];
        try {
          cameras = await Html5Qrcode.getCameras();
        } catch {
          // 권한 거부 또는 API 미지원 → cameras 빈 배열 유지
        }
        if (cancelled) return;

        if (cameras.length === 0) {
          // 카메라 없음 (권한 거부 등)
          if (!cancelled) setMode("mock");
          return;
        }

        // facingMode: "environment" 로 시작 — iOS가 주력 1x 후면 렌즈를 자동 선택
        // 카메라 ID 직접 지정 시 라벨이 빈 문자열로 오면 엉뚱한 렌즈가 선택될 수 있음
        await scanner.start(
          { facingMode: "environment" },
          scanConfig,
          handleDecoded,
          () => {}
        );

        if (!cancelled) {
          setMode("camera");
        }
      } catch {
        if (cancelled) return;
        try {
          if (scanner.isScanning) await scanner.stop();
        } catch { /* ignore */ }
        try {
          scanner.clear();
        } catch { /* ignore */ }
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

  // #reader 는 inSession + 모바일 조건에서 항상 DOM에 유지 (unmount 시 Html5Qrcode 생성자 실패 방지)
  const showCameraArea = inSession && !isLikelyDesktop();
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
              {/* #reader 는 inSession 모바일에서 항상 DOM에 존재 — unmount 하면 재시도 시 생성자가 throw 함 */}
              {showCameraArea && (
                <div className="relative z-20 w-full shrink-0" style={{ minHeight: "40dvh" }}>
                  {/* 카메라 피드를 받는 엘리먼트 — 항상 마운트 유지 */}
                  <div
                    id={READER_ID}
                    className="relative z-10 w-full"
                    style={{ minHeight: "40dvh" }}
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
                          카메라를 켤 수 없어요
                        </h2>
                        <p className="mt-2 text-center text-xs text-zinc-500">
                          카메라 엑세스 허용 후 이 화면으로 돌아오면 자동으로 다시 연결합니다.
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
