import InstagramIcon from "@/components/InstagramIcon";
import { INSTAGRAM_GARAM_LIB_URL } from "@/lib/brand";

type AppFooterProps = {
  className?: string;
};

export default function AppFooter({ className = "" }: AppFooterProps) {
  return (
    <footer
      className={`border-t border-amber-500/10 bg-zinc-950/80 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${className}`}
    >
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
        <p className="order-2 text-[11px] leading-relaxed text-zinc-500 sm:order-1">
          동국대학교사범대학부속가람고등학교 · 도서부 동아리 빛나래
        </p>
        <a
          href={INSTAGRAM_GARAM_LIB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="order-1 inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-2xl border border-pink-500/30 bg-zinc-900/80 px-4 py-3 text-sm font-medium text-pink-100 transition active:bg-zinc-800 sm:order-2"
        >
          <InstagramIcon className="h-6 w-6 shrink-0 text-pink-400" />
          <span className="tabular-nums">도서관 인스타</span>
        </a>
      </div>
    </footer>
  );
}

