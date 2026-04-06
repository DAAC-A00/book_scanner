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

function isLikelyDesktop(): boolean {
  if (typeof window === "undefined") return true;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasTouch =
    "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  return !coarsePointer && !hasTouch;
}

function randomBarcode(): string {
  return Array.from({ length: 13 }, () =>
    String(Math.floor(Math.random() * 10))
  ).join("");
}

function playSuccessBeep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.14);
    osc.onended = () => void ctx.close();
  } catch {
    /* ignore */
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

const shellStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100%",
  minHeight: "100dvh",
  zIndex: 100,
};

export default function Scanner() {
  const scans = useScannerStore((s) => s.scans);
  const addScan = useScannerStore((s) => s.addScan);
  const lastScan = scans[scans.length - 1];

  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [mode, setMode] = useState<"loading" | "camera" | "mock">("loading");
  const [flash, setFlash] = useState(false);

  const triggerFeedback = useCallback(async (barcode: string) => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 220);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(100);
    }
    playSuccessBeep();
    await copyToClipboard(barcode);
  }, []);

  const handleDecoded = useCallback(
    (text: string) => {
      const ok = addScan(text);
      if (ok) void triggerFeedback(text);
    },
    [addScan, triggerFeedback]
  );

  const handleMockScan = useCallback(() => {
    const code = randomBarcode();
    const ok = addScan(code);
    if (ok) void triggerFeedback(code);
  }, [addScan, triggerFeedback]);

  useEffect(() => {
    let cancelled = false;

    if (isLikelyDesktop()) {
      setMode("mock");
      return;
    }

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
  }, [handleDecoded]);

  return (
    <div
      className="isolate flex flex-col bg-zinc-950 text-zinc-100"
      style={shellStyle}
    >
      <div
        className={`pointer-events-none fixed inset-0 z-50 border-[6px] border-emerald-400 transition-opacity duration-100 ${
          flash ? "opacity-95" : "opacity-0"
        }`}
        aria-hidden
      />

      <div
        id={VIEWFINDER_ID}
        className="absolute inset-0 h-full w-full min-w-0 overflow-hidden [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        hidden={mode === "mock"}
      />

      {mode === "mock" && (
        <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center justify-center px-5 py-8">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-8 shadow-xl shadow-black/40">
            <h1 className="text-center text-xl font-semibold tracking-tight text-white">
              개발용 테스트 스캔
            </h1>
            <p className="mt-3 text-center text-base leading-relaxed text-zinc-400">
              PC에서는 카메라 대신 이 버튼으로 한 번에 기록을 쌓을 수 있습니다.
            </p>
            <button
              type="button"
              onClick={handleMockScan}
              className="mt-8 flex h-16 w-full items-center justify-center rounded-2xl bg-emerald-600 text-lg font-semibold text-white shadow-lg shadow-emerald-950/50 active:bg-emerald-700"
            >
              가상 스캔 (13자리)
            </button>
            <p className="mt-6 text-center text-sm text-zinc-500">
              방금 기록{" "}
              <span className="font-mono text-base text-zinc-200 tabular-nums">
                {lastScan?.barcode ?? "—"}
              </span>
            </p>
          </div>
        </div>
      )}

      {mode === "camera" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-linear-to-t from-black/90 via-black/60 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16">
          <p className="text-center text-xs uppercase tracking-wider text-zinc-500">
            최근 스캔
          </p>
          <p className="mt-1 truncate text-center font-mono text-xl text-white tabular-nums">
            {lastScan?.barcode ?? "—"}
          </p>
        </div>
      )}

      {mode === "loading" && (
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <p className="text-sm text-zinc-500">카메라 준비 중…</p>
        </div>
      )}
    </div>
  );
}
