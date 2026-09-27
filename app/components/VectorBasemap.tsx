"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";
import { createElementObject, createLayerComponent, type LayerProps } from "@react-leaflet/core";
import L from "leaflet";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { useEffect, useState } from "react";

// MapLibre の Web Worker はバンドルに含められないので public/maplibre に置いたものを使う
// （scripts/copy-maplibre-worker.mjs が dev / build 前にコピーする）
setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH}/maplibre/maplibre-gl-worker.mjs`);


// OpenFreeMap のスタイルはラベルが「Shinjuku 新宿」のようなローマ字併記なので、日本語名だけにする
const JA_LABEL = ["coalesce", ["get", "name:ja"], ["get", "name"]];

function toJapaneseLabels(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (layer.type !== "symbol") return layer;
      const text = JSON.stringify(layer.layout?.["text-field"] ?? "");
      if (!/name[:_]/.test(text)) return layer; // 道路番号などはそのまま
      return { ...layer, layout: { ...layer.layout, "text-field": JA_LABEL } } as typeof layer;
    }),
  };
}

const styleCache = new Map<string, Promise<StyleSpecification>>();

function loadStyle(url: string) {
  let p = styleCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`style ${res.status}`);
        return res.json() as Promise<StyleSpecification>;
      })
      .then(toJapaneseLabels);
    p.catch(() => styleCache.delete(url));
    styleCache.set(url, p);
  }
  return p;
}

// プラグインは削除後の再追加（地図の切り替えで戻したとき・開発時の Strict Mode）で古いコンテナを使い回すので、
// 念のため削除時にコンテナも捨てて、次の追加時にまっさらな状態から作り直させる
const FreshMaplibreGL = (L.MaplibreGL as unknown as typeof L.Layer).extend({
  onRemove(this: { _container?: HTMLElement }, map: L.Map) {
    L.MaplibreGL.prototype.onRemove.call(this, map);
    this._container = undefined;
  },
}) as unknown as new (options: L.LeafletMaplibreGLOptions) => L.MaplibreGL;

const MaplibreLayer = createLayerComponent<L.MaplibreGL, LayerProps & { mapStyle: StyleSpecification }>(
  ({ mapStyle }, ctx) => createElementObject(new FreshMaplibreGL({ style: mapStyle }), ctx),
);

/**
 * MapLibre のベクタータイル地図を Leaflet のレイヤーとして表示する。
 * スタイルを先に取得して日本語ラベルに書き換えてから地図を作る（英語ラベルが一瞬出るのを防ぐ）。
 */
export function VectorBasemap({ styleUrl }: { styleUrl: string }) {
  const [mapStyle, setMapStyle] = useState<StyleSpecification | null>(null);

  useEffect(() => {
    let alive = true;
    loadStyle(styleUrl).then(
      (s) => alive && setMapStyle(s),
      (e) => console.error("地図スタイルの読み込みに失敗しました", e),
    );
    return () => {
      alive = false;
    };
  }, [styleUrl]);

  return mapStyle ? <MaplibreLayer mapStyle={mapStyle} /> : null;
}
