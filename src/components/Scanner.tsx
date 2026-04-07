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
import { useScannerStore } from "@/store/useScannerStore";

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

const shellStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100%",
  minHeight: "100dvh",
  zIndex: 100,
};

export default function Scanner() {
  const isScanning = useScannerStore((s) => s.isScanning);
  const setIsScanning = useScannerStore((s) => s.setIsScanning);
  const scanLines = useScannerStore((s) => s.scanLines);
  const setScanLinesFromText = useScannerStore((s) => s.setScanLinesFromText);
  const addValidatedDigitScan = useScannerStore((s) => s.addValidatedDigitScan);

  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (useScannerStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useScannerStore.persist.onFinishHydration(() =>
      setHydrated(true)
    );
    return unsub;
  }, []);

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
      const ok = addValidatedDigitScan(trimmed);
      if (ok) triggerFeedback(trimmed);
    },
    [addValidatedDigitScan, triggerFeedback]
  );

  const handleMockScan = useCallback(() => {
    const code = randomDigits();
    const ok = addValidatedDigitScan(code);
    if (ok) triggerFeedback(code);
  }, [addValidatedDigitScan, triggerFeedback]);

  useEffect(() => {
    if (!isScanning) {
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
  }, [isScanning, handleDecoded]);

  const linesText = scanLines.join("\n");
  const showViewfinder = isScanning && mode === "camera";
  const showMockPanel = isScanning && mode === "mock";
  const showStartOverlay = !isScanning;

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

      {showStartOverlay && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 pt-4 pb-32">
          <button
            type="button"
            onClick={() => setIsScanning(true)}
            className="flex h-[min(4.5rem,18vw)] w-full max-w-sm items-center justify-center rounded-3xl bg-emerald-600 text-xl font-semibold text-white shadow-xl shadow-emerald-950/40 active:bg-emerald-700"
          >
            스캔 시작
          </button>
          <p className="mt-6 max-w-sm text-center text-sm leading-relaxed text-zinc-500">
            버튼을 누른 뒤 카메라를 허용하면 점검을 시작합니다. 숫자만
            인식합니다.
          </p>
        </div>
      )}

      {isScanning && mode === "loading" && !isLikelyDesktop() && (
        <div className="relative z-10 flex flex-1 items-center justify-center pb-36">
          <p className="text-sm text-zinc-500">카메라 준비 중…</p>
        </div>
      )}

      {showMockPanel && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-32 pt-4">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-8 shadow-xl shadow-black/40">
            <h1 className="text-center text-xl font-semibold tracking-tight text-white">
              개발용 테스트 스캔
            </h1>
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

      {isScanning && (mode === "camera" || mode === "mock") && (
        <div className="pointer-events-auto fixed inset-x-0 top-0 z-40 flex justify-end p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => setIsScanning(false)}
            className="rounded-full border border-zinc-600 bg-zinc-900/90 px-4 py-2 text-sm font-medium text-zinc-200 active:bg-zinc-800"
          >
            스캔 중지
          </button>
        </div>
      )}

      <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex max-h-[42dvh] flex-col border-t border-zinc-800 bg-zinc-950/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        {toast && (
          <div
            className="mb-2 rounded-xl border border-emerald-500/40 bg-emerald-950/90 px-3 py-2 text-center text-sm text-emerald-100"
            role="status"
          >
            {toast}
          </div>
        )}
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
          스캔 목록 (줄 단위 · 직접 수정 가능)
        </label>
        {hydrated ? (
          <textarea
            value={linesText}
            onChange={(e) => setScanLinesFromText(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="min-h-[7.5rem] w-full flex-1 resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-base leading-relaxed text-zinc-100 tabular-nums outline-none ring-emerald-500/40 focus:ring-2"
            placeholder="스캔한 숫자가 한 줄씩 표시됩니다."
          />
        ) : (
          <div className="min-h-[7.5rem] w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-500">
            목록 불러오는 중…
          </div>
        )}
      </div>
    </div>
  );
}
