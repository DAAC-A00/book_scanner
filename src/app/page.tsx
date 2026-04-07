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

  if (isScanMode) {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-black text-white">
        <Scanner />
      </main>
    );
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-bold tracking-tight">빛나래 장서점검</h1>
        <p className="mt-1 text-sm text-zinc-500">데이터 관리 메인 화면</p>

        <button
          type="button"
          onClick={startWork}
          className="mt-5 flex h-16 w-full items-center justify-center rounded-3xl bg-emerald-600 text-lg font-semibold text-white shadow-xl shadow-emerald-950/40 active:bg-emerald-700"
        >
          장서점검 업무 시작
        </button>

        <section className="mt-5 min-h-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/40">
          {!selectedKey ? (
            <div className="flex h-full min-h-[40dvh] flex-col">
              <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold">
                저장된 점검 목록
              </div>
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
            </div>
          ) : (
            <div className="flex h-full min-h-[40dvh] flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedKey(null)}
                  className="text-sm font-medium text-zinc-300 active:text-white"
                >
                  ← 목록
                </button>
                <span className="text-xs text-zinc-500">{selectedCount}건</span>
              </div>
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
                  className="h-full min-h-[34dvh] w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none ring-emerald-500/30 focus:ring-2"
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
