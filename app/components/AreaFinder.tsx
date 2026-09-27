"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchFacilities } from "@/lib/facilities";
import type { Town } from "@/lib/geo";
import { CRITERIA, scoreArea, scoreColor, type AreaScore, type Facility } from "@/lib/score";
import { fetchTowns } from "@/lib/towns";
import type { LatLng } from "./MapView";

// Leaflet は window を使うのでブラウザでのみ読み込む
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-zinc-500">地図を読み込み中…</div>,
});

const INITIAL_CENTER: LatLng = { lat: 33.5897, lng: 130.4207 }; // 博多駅

export type ScoredTown = Town & { score: AreaScore | null };

type Load<T> = { data: T; loading: boolean; error: string | null };
type Loader<T> = (lat: number, lng: number, radiusKm: number, signal: AbortSignal) => Promise<T>;

/**
 * center/radius が変わったら少し待ってから取得する（スライダー操作中の連打防止）。
 * 条件が変わったら前のリクエストは中断する。
 */
function useAreaFetch<T>(load: Loader<T>, empty: T, center: LatLng, radiusKm: number) {
  const [state, setState] = useState<Load<T>>({ data: empty, loading: false, error: null });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await load(center.lat, center.lng, radiusKm, ctrl.signal);
        if (!ctrl.signal.aborted) setState({ data, loading: false, error: null });
      } catch (e) {
        if (!ctrl.signal.aborted) setState({ data: empty, loading: false, error: (e as Error).message });
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
      <div className="relative h-[50dvh] md:h-full md:flex-1">
        <MapView
          center={center}
          radiusKm={radiusKm}
          towns={scored}
          highlighted={highlighted}
          flyToken={flyToken}
          onPick={setCenter}
          onHover={setHighlighted}
          onSelect={(postal) => setExpanded(postal)}
        />
      </div>

      <aside className="flex min-h-0 flex-1 flex-col border-zinc-200 bg-white md:w-[440px] md:flex-none md:border-l dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h1 className="text-lg font-bold">エリア住みやすさスコア</h1>
          <p className="text-xs text-zinc-500">地図をクリック（またはピンをドラッグ）して中心を指定</p>

          <form onSubmit={searchAddress} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="駅名・住所で移動（例: 武蔵小杉駅）"
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
            />
            <button className="rounded bg-zinc-800 px-3 text-sm text-white dark:bg-zinc-200 dark:text-zinc-900">
              移動
            </button>
          </form>

          <label className="block text-sm">
            <div className="mb-1 flex justify-between">
              <span>半径</span>
              <span className="font-mono">
                <input
                  type="number"
                  min={0.1}
                  max={15}
                  step={0.1}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Math.min(15, Math.max(0.1, Number(e.target.value) || 0.1)))}
                  className="w-16 rounded border border-zinc-300 bg-transparent px-1 text-right dark:border-zinc-700"
                />{" "}
                km
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={15}
              step={0.5}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="w-full"
            />
          </label>

          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span className="font-mono">
              中心: {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
            </span>
            <button
              onClick={downloadCsv}
              disabled={!scored.length}
              className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              CSV出力
            </button>
          </div>

          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer">スコアの計算方法（100点満点）</summary>
            <ul className="mt-1 space-y-0.5">
              {CRITERIA.map((c) => (
                <li key={c.key}>
                  <span className="inline-block w-8 text-right font-mono">{c.weight}</span>点 {c.label}：{c.description}
                </li>
              ))}
              <li className="pt-1">件数は対数カーブで加点（最初の数件ほど効く）。施設データ: OpenStreetMap（Overpass API）。町の代表点からの距離で数えています。</li>
            </ul>
          </details>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
          <span>
            {towns.loading
              ? "住所を検索中…"
              : `${scored.length} 件`}
            {facilities.loading && (
              <span className="ml-2 text-xs text-zinc-500">施設データ取得中…（混雑時は1〜2分かかります）</span>
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

        <ul className={`min-h-0 flex-1 overflow-y-auto ${towns.loading ? "opacity-50" : ""}`}>
          {scored.map((t) => (
            <TownRow
              key={t.postal}
              town={t}
              highlighted={highlighted === t.postal}
              expanded={expanded === t.postal}
              onHover={setHighlighted}
              onToggle={() => setExpanded((p) => (p === t.postal ? null : t.postal))}
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
  onHover,
  onToggle,
}: {
  town: ScoredTown;
  highlighted: boolean;
  expanded: boolean;
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
          className="grid h-8 w-10 shrink-0 place-items-center rounded font-mono text-sm font-bold text-white"
          style={{ background: t.score ? scoreColor(t.score.total) : "#a1a1aa" }}
        >
          {t.score ? t.score.total : "–"}
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
