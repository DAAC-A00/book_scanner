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
import { useScannerStore } from "@/store/useScannerStore";

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

  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const inSession = activeSessionKey !== null;

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

  const showReader = inSession && !isLikelyDesktop() && mode !== "mock";
  const showMockPanel = inSession && mode === "mock";
  const showCameraLoading =
    inSession && !isLikelyDesktop() && mode === "loading";

  const handleStartInventory = useCallback(() => {
    beginInventorySession();
  }, [beginInventorySession]);

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
              빛나래 장서점검
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              바코드만 스윽— 줄줄이 쌓이는 장서점검. 시작하면 카메라가 바로
              열립니다.
            </p>
            <div className="mt-8 flex flex-1 flex-col items-center justify-center pb-8">
              <button
                type="button"
                onClick={handleStartInventory}
                className="flex h-16 w-full max-w-sm items-center justify-center rounded-3xl bg-gradient-to-b from-emerald-500 to-emerald-600 text-lg font-semibold text-white shadow-xl shadow-emerald-950/45 ring-1 ring-white/10 active:from-emerald-600 active:to-emerald-700"
              >
                장서점검 시작
              </button>
            </div>
          </div>
        )}

        {inSession && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="relative z-50 flex shrink-0 items-center justify-end gap-2 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
              <button
                type="button"
                onClick={() => endInventorySession()}
                className="rounded-full border border-amber-700/80 bg-zinc-900 px-4 py-2 text-sm font-semibold text-amber-100 active:bg-zinc-800"
              >
                점검 종료
              </button>
            </header>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
              {showReader && (
                <div className="relative z-20 w-full min-w-[60%] min-h-[72dvh] shrink-0">
                  {showCameraLoading && (
                    <div className="pointer-events-none absolute inset-0 z-[50] flex items-center justify-center bg-zinc-950/85 backdrop-blur-sm">
                      <p className="text-sm text-zinc-400">카메라 준비 중…</p>
                    </div>
                  )}
                  <div
                    id={READER_ID}
                    className="relative z-10 h-full min-h-[72dvh] w-full"
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
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            점검 목록
          </label>
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
    </div>
  );
}
