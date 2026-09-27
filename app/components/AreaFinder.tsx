"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchFacilities } from "@/lib/facilities";
import type { OnProgress, Progress } from "@/lib/fetchUtil";
import type { Town } from "@/lib/geo";
import { CRITERIA, scoreArea, scoreColor, type AreaScore, type Facility } from "@/lib/score";
import { fetchTowns } from "@/lib/towns";
import LoadingStatus from "./LoadingStatus";
import type { LatLng } from "./MapView";

// Leaflet は window を使うのでブラウザでのみ読み込む
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-zinc-500">地図を読み込み中…</div>,
});

const INITIAL_CENTER: LatLng = { lat: 33.5897, lng: 130.4207 }; // 博多駅

export type ScoredTown = Town & { score: AreaScore | null };

type Load<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  progress: Progress | null;
  startedAt: number | null;
};
type Loader<T> = (
  lat: number,
  lng: number,
  radiusKm: number,
  signal: AbortSignal,
  onProgress: OnProgress,
) => Promise<T>;

/**
 * center/radius が変わったら少し待ってから取得する（スライダー操作中の連打防止）。
 * 条件が変わったら前のリクエストは中断する。
 */
function useAreaFetch<T>(load: Loader<T>, empty: T, center: LatLng, radiusKm: number) {
  const [state, setState] = useState<Load<T>>({
    data: empty,
    loading: false,
    error: null,
    progress: null,
    startedAt: null,
  });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: null, progress: null, startedAt: Date.now() }));
      const onProgress: OnProgress = (progress) => {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, progress }));
      };
      try {
        const data = await load(center.lat, center.lng, radiusKm, ctrl.signal, onProgress);
        if (!ctrl.signal.aborted) setState({ data, loading: false, error: null, progress: null, startedAt: null });
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setState({ data: empty, loading: false, error: (e as Error).message, progress: null, startedAt: null });
        }
      }
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // load / empty はモジュール定数を渡す前提
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, radiusKm, reloadToken]);

  return { ...state, reload: () => setReloadToken((n) => n + 1) };
}

const NO_TOWNS: Town[] = [];
const NO_FACILITIES: Facility[] = [];

export default function AreaFinder() {
  const [center, setCenter] = useState<LatLng>(INITIAL_CENTER);
  const [radiusKm, setRadiusKm] = useState(2);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"score" | "distance">("score");
  const [flyToken, setFlyToken] = useState(0);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  // スマホ表示で一覧（各地域の情報）を見ているか。true の間は地図を縮めて一覧を広く見せる
  const [listMode, setListMode] = useState(false);

  const towns = useAreaFetch(fetchTowns, NO_TOWNS, center, radiusKm);
  const facilities = useAreaFetch(fetchFacilities, NO_FACILITIES, center, radiusKm);

  const scored = useMemo<ScoredTown[]>(() => {
    const hasFacilities = facilities.data.length > 0;
    const list = towns.data.map((t) => ({
      ...t,
      score: hasFacilities ? scoreArea(t.lat, t.lng, facilities.data) : null,
    }));
    if (sortBy === "score" && hasFacilities) {
      list.sort((a, b) => b.score!.total - a.score!.total || a.distanceKm - b.distanceKm);
    }
    return list;
  }, [towns.data, facilities.data, sortBy]);

  const avg = scored.length && scored[0].score
    ? Math.round(scored.reduce((s, t) => s + (t.score?.total ?? 0), 0) / scored.length)
    : null;

  // 国土地理院の住所検索APIで地名・住所から中心を移動
  async function searchAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchError(null);
    try {
      const res = await fetch(
        `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query.trim())}`,
      );
      const json = await res.json();
      if (!json.length) {
        setSearchError(`「${query}」が見つかりませんでした`);
        return;
      }
      // 先頭が最適とは限らない（「武蔵小杉駅」→瑞穂町武蔵 等）ので、完全一致→部分一致→先頭の順で選ぶ
      type Hit = { geometry: { coordinates: [number, number] }; properties: { title: string } };
      const q = query.trim();
      const hits = json as Hit[];
      const best =
        hits.find((h) => h.properties.title === q) ??
        hits.find((h) => h.properties.title.includes(q)) ??
        hits[0];
      const [lng, lat] = best.geometry.coordinates;
      setCenter({ lat, lng });
      setFlyToken((n) => n + 1);
    } catch {
      setSearchError("住所検索に失敗しました");
    }
  }

  function downloadCsv() {
    const header = ["郵便番号", "都道府県", "市区町村", "町域", "中心からの距離(km)", "スコア", ...CRITERIA.map((c) => `${c.label}(件)`), "最寄り駅(m)"];
    const rows = scored.map((t) => [
      t.postal,
      t.prefecture,
      t.city,
      t.town,
      t.distanceKm,
      t.score?.total ?? "",
      ...CRITERIA.map((c) => t.score?.breakdown.find((b) => b.key === c.key)?.count ?? ""),
      t.score?.breakdown.find((b) => b.key === "station")?.nearestM ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `area_${center.lat.toFixed(4)}_${center.lng.toFixed(4)}_${radiusKm}km.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const loading = towns.loading || facilities.loading;

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* スマホでは一覧を見ている間は地図を縮める（PC では常に左側いっぱい） */}
      <div
        className={`relative shrink-0 transition-[height] duration-300 ease-out md:h-full md:flex-1 ${
          listMode ? "h-[28dvh]" : "h-[50dvh]"
        }`}
        onPointerDown={() => setListMode(false)}
      >
        <MapView
          center={center}
          radiusKm={radiusKm}
          towns={scored}
          highlighted={highlighted}
          selected={expanded}
          flyToken={flyToken}
          onPick={setCenter}
          onHover={setHighlighted}
          onSelect={(postal) => setExpanded(postal)}
        />
        <LoadingStatus
          steps={[
            { label: "円の中の住所を検索", state: towns, doneText: `${towns.data.length} 件見つかりました` },
            {
              label: "周辺の施設を取得",
              state: facilities,
              doneText: `${facilities.data.length.toLocaleString()} 件の施設を取得しました`,
            },
          ]}
        />
        {listMode && (
          <button
            onClick={() => setListMode(false)}
            className="absolute bottom-10 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs font-medium shadow md:hidden dark:bg-zinc-900/95"
          >
            ▼ 地図を広げる
          </button>
        )}
      </div>

      <aside className="flex min-h-0 flex-1 flex-col border-zinc-200 bg-white md:w-[440px] md:flex-none md:border-l dark:border-zinc-800 dark:bg-zinc-950">
        {/* gap は非表示の子要素に余白を作らない（space-y だと一覧表示中にタイトル下が空く） */}
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 md:gap-3 md:py-4 dark:border-zinc-800">
          <h1 className="text-base font-bold md:text-lg">エリア住みやすさスコア</h1>

          {/* スマホで一覧を見ている間は操作部を隠して一覧を広く見せる */}
          <div className={`flex-col gap-2 md:flex md:gap-3 ${listMode ? "hidden" : "flex"}`}>
            <p className="hidden text-xs text-zinc-500 md:block">地図をクリック（またはピンをドラッグ）して中心を指定</p>

            <form onSubmit={searchAddress} className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="駅名・住所で移動（例: 天神駅）"
                className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-base md:text-sm dark:border-zinc-700"
              />
              <button className="rounded bg-zinc-800 px-3 text-sm text-white dark:bg-zinc-200 dark:text-zinc-900">
                移動
              </button>
            </form>

            <label className="flex items-center gap-2 text-sm">
              <span className="shrink-0">半径</span>
              <input
                type="range"
                min={0.5}
                max={15}
                step={0.5}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="min-w-0 flex-1"
              />
              <span className="shrink-0 font-mono">
                <input
                  type="number"
                  min={0.1}
                  max={15}
                  step={0.1}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Math.min(15, Math.max(0.1, Number(e.target.value) || 0.1)))}
                  className="w-14 rounded border border-zinc-300 bg-transparent px-1 text-right dark:border-zinc-700"
                />{" "}
                km
              </span>
            </label>

            <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
              <details className="min-w-0">
                <summary className="cursor-pointer">スコアの計算方法（100点満点）</summary>
                <ul className="mt-1 space-y-0.5">
                  {CRITERIA.map((c) => (
                    <li key={c.key}>
                      <span className="inline-block w-8 text-right font-mono">{c.weight}</span>点 {c.label}：
                      {c.description}
                    </li>
                  ))}
                  <li className="pt-1">
                    件数は対数カーブで加点（最初の数件ほど効く）。施設データ: OpenStreetMap（Overpass
                    API）。町の代表点からの距離で数えています。
                  </li>
                  <li>
                    町域の境界: 政府統計の総合窓口（e-Stat）国勢調査
                    小地域境界データ（令和2年）を加工して作成（現在は福岡県のみ）。
                  </li>
                  <li className="font-mono">
                    中心: {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
                  </li>
                </ul>
              </details>
              <button
                onClick={downloadCsv}
                disabled={!scored.length}
                className="shrink-0 self-start rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
              >
                CSV出力
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
          <span>
            {towns.loading ? "住所を検索中…" : `${scored.length} 件`}
            {facilities.loading && !towns.loading && (
              <span className="ml-2 text-xs text-zinc-500">スコア計算中…</span>
            )}
            {avg !== null && !loading && <span className="ml-2 text-xs text-zinc-500">平均 {avg} 点</span>}
          </span>
          <div className="flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700">
            {(["score", "distance"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSortBy(k)}
                className={`px-2 py-1 ${sortBy === k ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : ""}`}
              >
                {k === "score" ? "スコア順" : "距離順"}
              </button>
            ))}
          </div>
        </div>
        {(towns.error || searchError) && (
          <p className="px-4 pb-2 text-xs text-red-600">{searchError ?? towns.error}</p>
        )}
        {facilities.error && !facilities.loading && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <span className="flex-1">{facilities.error}</span>
            <button onClick={facilities.reload} className="shrink-0 rounded bg-red-600 px-2 py-1 text-white">
              再取得
            </button>
          </div>
        )}

        <ul
          className={`min-h-0 flex-1 overflow-y-auto ${towns.loading ? "opacity-50" : ""}`}
          onScroll={(e) => {
            // スマホで一覧を下にスクロールしたら地図を縮める
            if (e.currentTarget.scrollTop > 24) setListMode(true);
          }}
        >
          {scored.map((t) => (
            <TownRow
              key={t.postal}
              town={t}
              highlighted={highlighted === t.postal}
              expanded={expanded === t.postal}
              scoring={facilities.loading}
              onHover={setHighlighted}
              onToggle={() => {
                const opening = expanded !== t.postal;
                setExpanded(opening ? t.postal : null);
                if (opening) setListMode(true);
              }}
            />
          ))}
        </ul>
      </aside>
    </div>
  );
}

function TownRow({
  town: t,
  highlighted,
  expanded,
  scoring,
  onHover,
  onToggle,
}: {
  town: ScoredTown;
  highlighted: boolean;
  expanded: boolean;
  scoring: boolean;
  onHover: (postal: string | null) => void;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [expanded]);

  return (
    <li
      ref={ref}
      onMouseEnter={() => onHover(t.postal)}
      onMouseLeave={() => onHover(null)}
      className={`border-b border-zinc-100 text-sm dark:border-zinc-900 ${
        highlighted || expanded ? "bg-orange-50 dark:bg-orange-950/40" : ""
      }`}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2 text-left">
        <span
          className={`grid h-8 w-10 shrink-0 place-items-center rounded font-mono text-sm font-bold text-white ${
            !t.score && scoring ? "animate-pulse" : ""
          }`}
          style={{ background: t.score ? scoreColor(t.score.total) : "#a1a1aa" }}
          title={!t.score && scoring ? "スコア計算中" : undefined}
        >
          {t.score ? t.score.total : scoring ? "…" : "–"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-xs text-zinc-500">〒{t.postal}</span>
          <span>
            {t.city}
            <span className="font-semibold">{t.town}</span>
          </span>
        </span>
        <span className="font-mono text-xs text-zinc-500">{t.distanceKm.toFixed(2)}km</span>
      </button>

      {expanded && t.score && (
        <table className="mx-4 mb-3 w-[calc(100%-2rem)] text-xs">
          <tbody>
            {t.score.breakdown.map((b) => (
              <tr key={b.key}>
                <td className="py-0.5 pr-2">{b.label}</td>
                <td className="pr-2 text-right font-mono text-zinc-500">
                  {b.key === "station" ? (b.nearestM === null ? "なし" : `${b.nearestM}m`) : `${b.count}件`}
                </td>
                <td className="w-24">
                  <div className="h-1.5 rounded bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-1.5 rounded bg-emerald-500"
                      style={{ width: `${(b.points / b.weight) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="w-14 text-right font-mono">
                  {b.points}/{b.weight}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
