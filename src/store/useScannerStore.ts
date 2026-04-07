import { create } from "zustand";
import { persist } from "zustand/middleware";

const DIGIT_ONLY = /^\d+$/;
const DEDUP_WINDOW_MS = 2000;

type Dedup = { at: number; value: string };

type ScannerState = {
  scanLines: string[];
  isScanning: boolean;
  _dedup: Dedup | null;
  setIsScanning: (v: boolean) => void;
  setScanLinesFromText: (text: string) => void;
  addValidatedDigitScan: (raw: string) => boolean;
};

function normalizeDigits(raw: string): string | null {
  const t = raw.trim();
  if (!t || !DIGIT_ONLY.test(t)) return null;
  return t;
}

export const useScannerStore = create<ScannerState>()(
  persist(
    (set, get) => ({
      isScanning: false,
      scanLines: [],
      _dedup: null,
      setIsScanning: (v) => set({ isScanning: v }),
      setScanLinesFromText: (text) => {
        set({ scanLines: text.split("\n") });
      },
      addValidatedDigitScan: (raw) => {
        const digits = normalizeDigits(raw);
        if (!digits) return false;
        const now = Date.now();
        const { scanLines, _dedup } = get();
        if (
          _dedup &&
          _dedup.value === digits &&
          now - _dedup.at < DEDUP_WINDOW_MS
        ) {
          return false;
        }
        set({
          scanLines: [...scanLines, digits],
          _dedup: { at: now, value: digits },
        });
        return true;
      },
    }),
    {
      name: "inventory-scanner-scans",
      version: 1,
      migrate: (persisted) => {
        const p = persisted as {
          scanLines?: string[];
          scans?: { barcode?: string }[];
        };
        if (Array.isArray(p.scanLines)) {
          return { scanLines: p.scanLines };
        }
        if (Array.isArray(p.scans)) {
          return {
            scanLines: p.scans
              .map((x) => String(x.barcode ?? "").trim())
              .filter((s) => s.length > 0),
          };
        }
        return { scanLines: [] };
      },
      partialize: (state) => ({ scanLines: state.scanLines }),
    }
  )
);
