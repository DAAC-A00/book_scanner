import type { ReactNode } from "react";

const SERVICE_TITLE = "빛나래 장서점검";

type AppHeaderProps = {
  /** 점검 화면 등 우측 액션(예: 점검 중단) */
  rightSlot?: ReactNode;
  className?: string;
};

export default function AppHeader({ rightSlot, className = "" }: AppHeaderProps) {
  return (
    <header
      className={`flex min-h-[3.5rem] items-center gap-3 border-b border-amber-500/15 bg-linear-to-r from-zinc-950 via-zinc-900/95 to-zinc-950 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-4 ${className}`}
    >
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-400/35 bg-zinc-900/90 text-center text-[0.65rem] font-semibold leading-tight text-amber-100/90 shadow-inner shadow-amber-900/20"
        aria-label="학교 로고 자리(추후 이미지로 교체)"
      >
        동대부
        <br />
        가람고
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-amber-400/85">
          도서부 빛나래
        </p>
        <h1 className="truncate text-base font-bold tracking-tight text-white sm:text-lg">
          {SERVICE_TITLE}
        </h1>
      </div>
      {rightSlot != null ? (
        <div className="flex shrink-0 items-center gap-2">{rightSlot}</div>
      ) : (
        <span className="w-2 shrink-0" aria-hidden />
      )}
    </header>
  );
}
