"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Town } from "@/lib/geo";
import type { LatLng } from "./MapView";

// Leaflet は window を使うのでブラウザでのみ読み込む
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-zinc-500">地図を読み込み中…</div>,
});

const INITIAL_CENTER: LatLng = { lat: 35.6812, lng: 139.7671 }; // 東京駅

export default function AreaFinder() {
  const [center, setCenter] = useState<LatLng>(INITIAL_CENTER);
  const [radiusKm, setRadiusKm] = useState(2);
  const [towns, setTowns] = useState<Town[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [flyToken, setFlyToken] = useState(0);
  const [query, setQuery] = useState("");
  const requestId = useRef(0);

  const fetchTowns = useCallback(async (c: LatLng, r: number) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/towns?lat=${c.lat}&lng=${c.lng}&r=${r}`);
      const json = await res.json();
      if (id !== requestId.current) return; // 古いリクエストの結果は捨てる
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      setTowns(json.towns);
    } catch (e) {
      if (id === requestId.current) {
        setError((e as Error).message);
        setTowns([]);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // 中心・半径が変わったら少し待ってから再検索（スライダー操作中の連打防止）
  useEffect(() => {
    const t = setTimeout(() => fetchTowns(center, radiusKm), 400);
    return () => clearTimeout(t);
  }, [center, radiusKm, fetchTowns]);

  // 国土地理院の住所検索APIで地名・住所から中心を移動
  async function searchAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setError(null);
    try {
      const res = await fetch(
        `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query.trim())}`,
      );
      const json = await res.json();
      if (!json.length) {
        setError(`「${query}」が見つかりませんでした`);
        return;
      }
      const [lng, lat] = json[0].geometry.coordinates;
      setCenter({ lat, lng });
      setFlyToken((n) => n + 1);
    } catch {
      setError("住所検索に失敗しました");
    }
  }

  function downloadCsv() {
    const header = "郵便番号,都道府県,市区町村,町域,中心からの距離(km)";
    const rows = towns.map((t) => [t.postal, t.prefecture, t.city, t.town, t.distanceKm].join(","));
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `area_${center.lat.toFixed(4)}_${center.lng.toFixed(4)}_${radiusKm}km.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <div className="relative h-[50dvh] md:h-full md:flex-1">
        <MapView
          center={center}
          radiusKm={radiusKm}
          towns={towns}
          highlighted={highlighted}
          flyToken={flyToken}
          onPick={setCenter}
          onHover={setHighlighted}
        />
      </div>

      <aside className="flex min-h-0 flex-1 flex-col border-zinc-200 bg-white md:w-[420px] md:flex-none md:border-l dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <h1 className="text-lg font-bold">エリア検索</h1>
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
              disabled={!towns.length}
              className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              CSV出力
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2 text-sm">
          <span>{loading ? "検索中…" : `${towns.length} 件（郵便番号単位）`}</span>
          {error && <span className="text-red-600">{error}</span>}
        </div>

        <ul className={`min-h-0 flex-1 overflow-y-auto ${loading ? "opacity-50" : ""}`}>
          {towns.map((t) => (
            <li
              key={t.postal}
              onMouseEnter={() => setHighlighted(t.postal)}
              onMouseLeave={() => setHighlighted(null)}
              className={`flex items-baseline gap-3 border-b border-zinc-100 px-4 py-2 text-sm dark:border-zinc-900 ${
                highlighted === t.postal ? "bg-orange-50 dark:bg-orange-950/40" : ""
              }`}
            >
              <span className="font-mono text-xs text-zinc-500">〒{t.postal}</span>
              <span className="flex-1">
                {t.city}
                <span className="font-semibold">{t.town}</span>
              </span>
              <span className="font-mono text-xs text-zinc-500">{t.distanceKm.toFixed(2)}km</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
