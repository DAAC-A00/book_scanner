"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scanner from "@/components/Scanner";
import {
  deleteSessionKey,
  listSessionStorageKeys,
  readSessionRaw,
  useScannerStore,
  writeSessionRaw,
} from "@/store/useScannerStore";

function formatSessionLabel(key: string): string {
  const iso = key.slice("book-scanner:session:".length);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function lineCount(text: string): number {
  return text.split("\n").filter((x) => x.trim().length > 0).length;
}

function toPlain(text: string): string {
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .join("\n");
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export default function Home() {
  const activeSessionKey = useScannerStore((s) => s.activeSessionKey);
  const beginInventorySession = useScannerStore((s) => s.beginInventorySession);

  const [isScanMode, setIsScanMode] = useState(false);
  const [adminView, setAdminView] = useState<"main" | "list" | "detail">(
    "main"
  );
  const [sessionKeys, setSessionKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [copyDone, setCopyDone] = useState(false);
  const timerRef = useRef<number | null>(null);

  const refreshList = useCallback(() => {
    setSessionKeys(listSessionStorageKeys());
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (isScanMode && !activeSessionKey) {
      setIsScanMode(false);
      refreshList();
    }
  }, [activeSessionKey, isScanMode, refreshList]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const startWork = () => {
    beginInventorySession();
    setIsScanMode(true);
  };

  const openDetail = (key: string) => {
    setSelectedKey(key);
    setSelectedText(readSessionRaw(key));
    setCopyDone(false);
    setAdminView("detail");
  };

  const onChangeDetail = (value: string) => {
    if (!selectedKey) return;
    setSelectedText(value);
    writeSessionRaw(selectedKey, value);
    refreshList();
  };

  const onDelete = () => {
    if (!selectedKey) return;
    if (!window.confirm("이 점검 기록을 삭제할까요?")) return;
    deleteSessionKey(selectedKey);
    setSelectedKey(null);
    setSelectedText("");
    refreshList();
    setAdminView("list");
  };

  const onCopy = async () => {
    const plain = toPlain(selectedText);
    if (!plain) return;
    try {
      await copyText(plain);
      setCopyDone(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopyDone(false), 1800);
    } catch {
      window.alert("복사에 실패했습니다. 텍스트를 길게 눌러 직접 복사해 주세요.");
    }
  };

  const selectedCount = useMemo(() => lineCount(selectedText), [selectedText]);
  const totalRecords = sessionKeys.length;

  if (isScanMode) {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-black text-white">
        <Scanner />
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-5 pb-8 pt-[max(1.25rem,env(safe-area-inset-top))]">
        {adminView === "main" && (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="rounded-3xl border border-zinc-800 bg-linear-to-b from-zinc-900 to-zinc-950 p-6 shadow-2xl shadow-black/30">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
                Main / Admin
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
                빛나래 장서점검
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                업무 시작과 데이터 관리를 분리한 메인 화면입니다.
              </p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                  <p className="text-xs text-zinc-500">저장된 점검 건수</p>
                  <p className="mt-1 text-2xl font-bold text-zinc-100">
                    {totalRecords}
                    <span className="ml-1 text-base font-medium text-zinc-400">
                      건
                    </span>
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                  <p className="text-xs text-zinc-500">현재 상태</p>
                  <p className="mt-1 text-sm font-medium text-zinc-200">
                    카메라 비활성화 (관리 모드)
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={startWork}
                className="flex h-16 items-center justify-center rounded-3xl bg-emerald-600 text-lg font-semibold text-white shadow-xl shadow-emerald-950/40 active:bg-emerald-700"
              >
                장서점검 업무 시작
              </button>
              <button
                type="button"
                onClick={() => setAdminView("list")}
                className="flex h-16 items-center justify-center rounded-3xl border border-zinc-700 bg-zinc-900 text-base font-semibold text-zinc-100 active:bg-zinc-800"
              >
                저장된 점검 목록
              </button>
            </div>
          </section>
        )}

        {adminView === "list" && (
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-100">
                저장된 점검 목록
              </h2>
              <button
                type="button"
                onClick={() => setAdminView("main")}
                className="rounded-full border border-zinc-600 bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-200 active:bg-zinc-800"
              >
                메인
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {sessionKeys.length === 0 ? (
                <p className="px-4 py-6 text-sm text-zinc-500">
                  저장된 점검 기록이 없습니다.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {sessionKeys.map((key) => {
                    const raw = readSessionRaw(key);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => openDetail(key)}
                          className="flex w-full flex-col items-start px-4 py-3 text-left active:bg-zinc-800/70"
                        >
                          <span className="text-sm font-semibold text-zinc-100">
                            {formatSessionLabel(key)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            스캔 {lineCount(raw)}건
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {adminView === "detail" && selectedKey && (
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
              <button
                type="button"
                onClick={() => setAdminView("list")}
                className="text-sm font-medium text-zinc-300 active:text-white"
              >
                ← 목록
              </button>
              <span className="text-xs text-zinc-500">{selectedCount}건</span>
            </header>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <button
                type="button"
                onClick={onCopy}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  copyDone
                    ? "bg-emerald-600 text-white"
                    : "border border-zinc-600 bg-zinc-900 text-zinc-100 active:bg-zinc-800"
                }`}
              >
                {copyDone ? "데이터 복사 완료" : "데이터 복사"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="rounded-full border border-red-900/70 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-100 active:bg-red-950/70"
              >
                데이터 삭제
              </button>
            </div>
            <div className="min-h-0 flex-1 px-4 pb-4">
              <textarea
                value={selectedText}
                onChange={(e) => onChangeDetail(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
                autoComplete="off"
                className="h-full min-h-[40dvh] w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none ring-emerald-500/30 focus:ring-2"
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
