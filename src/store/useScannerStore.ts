import { differenceInMilliseconds, formatISO, parseISO } from "date-fns";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ScanEntry = {
  barcode: string;
  scannedAt: string;
};

type ScannerState = {
  scans: ScanEntry[];
  addScan: (barcode: string) => boolean;
};

const DEDUP_WINDOW_MS = 2000;

export const useScannerStore = create<ScannerState>()(
  persist(
    (set, get) => ({
      scans: [],
      addScan: (barcode) => {
        const trimmed = barcode.trim();
        if (!trimmed) return false;

        const now = new Date();
        const scans = get().scans;
        const recent = scans.filter(
          (s) => differenceInMilliseconds(now, parseISO(s.scannedAt)) < DEDUP_WINDOW_MS
        );
        if (recent.some((s) => s.barcode === trimmed)) return false;

        set({
          scans: [
            ...scans,
            { barcode: trimmed, scannedAt: formatISO(now) },
          ],
        });
        return true;
      },
    }),
    {
      name: "inventory-scanner-scans",
      partialize: (state) => ({ scans: state.scans }),
    }
  )
);
