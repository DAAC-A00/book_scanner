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

function getCameraSettingsUrl(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent.toLowerCase();

  // Chromium 계열(안드로이드 포함)
  if (ua.includes("chrome") && !ua.includes("edg") && !ua.includes("opr")) {
    return "chrome://settings/content/camera";
  }

  // Firefox
  if (ua.includes("firefox")) {
    return "about:preferences#privacy";
  }

  // Edge
  if (ua.includes("edg")) {
    return "edge://settings/content/camera";
  }

  // Safari(iOS/macOS)는 웹에서 시스템 설정 페이지 직접 오픈이 제한적임
  return null;
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

  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cameraRetryToken, setCameraRetryToken] = useState(0);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [permissionHint, setPermissionHint] = useState<string | null>(null);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);

  const inSession = activeSessionKey !== null;

  const triggerFeedback = useCallback((digits: string) => {
    setFlashKey(Date.now());
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([100]);
    }
    setToast(`스캔 완료: ${digits}`);
    window.setTimeout(() => setToast(null), 1500);
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

  const handleRequestCameraPermission = useCallback(async () => {
    if (isRequestingPermission) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setToast("이 기기에서는 카메라 권한 요청을 지원하지 않습니다.");
      window.setTimeout(() => setToast(null), 1200);
      setPermissionHint("이 기기/브라우저에서는 카메라 권한 요청이 지원되지 않습니다.");
      return;
    }

    setIsRequestingPermission(true);
    setPermissionHint("카메라 권한을 확인하는 중입니다...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      stream.getTracks().forEach((track) => track.stop());
      setToast("카메라 권한이 확인되었습니다. 스캔을 다시 시작합니다.");
      window.setTimeout(() => setToast(null), 1200);
      setPermissionHint("권한 허용이 확인되었습니다. 카메라를 다시 시작합니다.");
      setCameraRetryToken((prev) => prev + 1);
    } catch (error) {
      const deniedByBrowser =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as DOMException).name === "NotAllowedError";
      setToast("카메라 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.");
      window.setTimeout(() => setToast(null), 1400);
      setPermissionHint(
        deniedByBrowser
          ? "권한이 차단되어 재요청 팝업이 뜨지 않을 수 있습니다. 주소창의 사이트 설정에서 카메라를 '허용'으로 변경한 뒤 아래 버튼을 다시 눌러주세요."
          : "카메라 권한을 확인하지 못했습니다. 설정에서 허용 후 다시 시도해 주세요."
      );
    } finally {
      setIsRequestingPermission(false);
    }
  }, [isRequestingPermission]);

  const handleOpenCameraSettings = useCallback(() => {
    if (isOpeningSettings) return;
    setIsOpeningSettings(true);

    const settingsUrl = getCameraSettingsUrl();
    if (!settingsUrl) {
      setPermissionHint(
        "이 브라우저는 보안 정책상 설정 화면 자동 이동을 지원하지 않습니다. 주소창 좌측 자물쇠 아이콘 > 카메라 허용으로 변경해 주세요."
      );
      setToast("설정 자동 열기를 지원하지 않는 브라우저입니다.");
      window.setTimeout(() => setToast(null), 1400);
      setIsOpeningSettings(false);
      return;
    }

    // 브라우저 설정 탭으로 직접 이동 시도
    window.location.assign(settingsUrl);
    window.setTimeout(() => {
      setIsOpeningSettings(false);
    }, 500);
  }, [isOpeningSettings]);

  useEffect(() => {
    if (!inSession || mode !== "mock" || isLikelyDesktop()) return;

    const recheck = () => {
      void handleRequestCameraPermission();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) recheck();
    };

    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [handleRequestCameraPermission, inSession, mode]);

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
        setPermissionHint(
          "카메라에 접근할 수 없습니다. 권한을 허용한 뒤 아래 버튼으로 다시 연결해 주세요."
        );
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
    if (!window.confirm("점검을 종료하고 메인 화면으로 이동할까요?")) return;
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
            <header className="relative z-50 flex shrink-0 items-center justify-start gap-2 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
              <button
                type="button"
                onClick={handleExitSession}
                className="rounded-full border border-amber-700/80 bg-zinc-900 px-4 py-2 text-sm font-semibold text-amber-100 active:bg-zinc-800"
              >
                종료
              </button>
            </header>

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
                  {mode === "camera" && <SniperLaserOverlay />}
                </div>
              )}

              {showMockPanel && (
                <div className="relative z-20 flex min-h-[40dvh] flex-col items-center justify-center px-4 py-6">
                  <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
                    <h2 className="text-center text-lg font-semibold text-white">
                      카메라 접근을 허용해주세요
                    </h2>
                    <p className="mt-3 text-center text-sm leading-relaxed text-zinc-400">
                      브라우저의 카메라 권한이 차단되어 스캔을 시작할 수 없습니다.
                      권한을 허용한 뒤 다시 시도해 주세요.
                    </p>
                    {permissionHint && (
                      <p className="mt-3 rounded-lg border border-zinc-700/80 bg-zinc-950/70 px-3 py-2 text-xs leading-relaxed text-zinc-300">
                        {permissionHint}
                      </p>
                    )}
                    {!isLikelyDesktop() && (
                      <div className="mt-5 grid grid-cols-1 gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRequestCameraPermission()}
                          disabled={isRequestingPermission}
                          className="w-full rounded-xl border border-emerald-700/70 bg-emerald-900/70 px-4 py-3 text-sm font-semibold text-emerald-100 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRequestingPermission
                            ? "카메라 권한 확인 중..."
                            : "카메라 접근 허용하기"}
                        </button>
                        <button
                          type="button"
                          onClick={handleOpenCameraSettings}
                          disabled={isOpeningSettings}
                          className="w-full rounded-xl border border-zinc-600 bg-zinc-800/90 px-4 py-3 text-sm font-semibold text-zinc-100 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isOpeningSettings
                            ? "설정 화면 여는 중..."
                            : "브라우저 설정 열기"}
                        </button>
                        <p className="text-center text-xs text-zinc-500">
                          설정에서 권한을 허용한 뒤 이 화면으로 돌아오면 자동으로 다시 확인합니다.
                        </p>
                      </div>
                    )}
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
            className="min-h-[12rem] max-h-[45dvh] w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 font-mono text-base leading-relaxed text-zinc-100 tabular-nums outline-none ring-emerald-500/30 focus:ring-2"
          />
        </div>
      )}
    </div>
  );
}
