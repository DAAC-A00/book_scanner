"use client";

import { useCallback, useRef } from "react";

function createAudioContext(): AudioContext {
  const AC =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (
          window as unknown as {
            webkitAudioContext: typeof AudioContext;
          }
        ).webkitAudioContext;
  return new AC();
}

/**
 * Web Audio로 짧은 톤 재생. 음원 파일 없음.
 * iOS 등에서는 사용자 제스처 이후 resume이 필요할 수 있음 → prime() 호출 권장.
 */
export function useScanBeeps() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = useCallback(async () => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) ctxRef.current = createAudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }, []);

  const prime = useCallback(() => {
    void ensureCtx();
  }, [ensureCtx]);

  const playSuccess = useCallback(() => {
    void (async () => {
      const ctx = await ensureCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(1250, ctx.currentTime);
      const t0 = ctx.currentTime;
      const dur = 0.07;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    })();
  }, [ensureCtx]);

  const playFailure = useCallback(() => {
    void (async () => {
      const ctx = await ensureCtx();
      if (!ctx) return;

      const beep = (offset: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.setValueAtTime(220, ctx.currentTime + offset);
        const t0 = ctx.currentTime + offset;
        const dur = 0.1;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.055, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      };

      beep(0);
      beep(0.18);
    })();
  }, [ensureCtx]);

  return { playSuccess, playFailure, prime };
}
