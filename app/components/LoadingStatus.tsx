"use client";

import { useEffect, useState } from "react";
import type { Progress } from "@/lib/fetchUtil";

export type StepState = {
  loading: boolean;
  error: string | null;
  progress: Progress | null;
  startedAt: number | null;
};

type Step = { label: string; state: StepState; doneText: string };

/** 地図の上に出す取得状況カード（①住所 → ②施設 → スコア表示） */
export default function LoadingStatus({ steps }: { steps: Step[] }) {
  const active = steps.some((s) => s.state.loading);
  const now = useNow(active);
  if (!active) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center px-14">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white/95 p-3 text-sm shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
      >
        <p className="mb-2 font-semibold">スコアを計算しています</p>
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <StepRow key={step.label} index={i + 1} step={step} now={now} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepRow({ index, step, now }: { index: number; step: Step; now: number }) {
  const { loading, error, progress, startedAt } = step.state;
  const elapsed = loading && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;
  const status = loading ? "loading" : error ? "error" : "done";

  return (
    <li className="flex gap-2">
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={status === "done" ? "text-zinc-500" : "font-medium"}>
            {index}. {step.label}
          </span>
          {elapsed !== null && <span className="shrink-0 font-mono text-xs text-zinc-500">{elapsed}秒</span>}
        </div>
        <p className="truncate text-xs text-zinc-500">
          {loading ? (progress?.message ?? "準備中…") : error ? "失敗しました" : step.doneText}
        </p>
        {loading && <ProgressBar ratio={progress?.ratio} />}
      </div>
    </li>
  );
}

function ProgressBar({ ratio }: { ratio?: number }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
      {ratio === undefined ? (
        // 進み具合が分からない処理は、流れるバーで「動いている」ことだけ示す
        <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded bg-blue-500" />
      ) : (
        <div className="h-full rounded bg-blue-500 transition-[width]" style={{ width: `${Math.round(ratio * 100)}%` }} />
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: "loading" | "error" | "done" }) {
  if (status === "loading") {
    return (
      <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    );
  }
  return (
    <span
      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
        status === "done" ? "bg-emerald-500" : "bg-red-500"
      }`}
    >
      {status === "done" ? "✓" : "!"}
    </span>
  );
}

/** active の間だけ1秒ごとに現在時刻を更新する（経過秒数の表示用） */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
