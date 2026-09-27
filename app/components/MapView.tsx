"use client";

import "leaflet/dist/leaflet.css";
import type { FeatureCollection } from "geojson";
import L from "leaflet";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Circle,
  CircleMarker,
  GeoJSON,
  LayersControl,
  MapContainer,
  Marker,
  Pane,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { findTownBoundary } from "@/lib/boundaries";
import { scoreColor } from "@/lib/score";
import type { ScoredTown } from "./AreaFinder";
import { VectorBasemap } from "./VectorBasemap";

export type LatLng = { lat: number; lng: number };

type Props = {
  center: LatLng;
  radiusKm: number;
  towns: ScoredTown[];
  highlighted: string | null; // マウスを乗せている町
  selected: string | null; // 一覧で開いている（選択中の）町
  flyToken: number; // 値が変わったら中心へ移動（住所検索時など）
  onPick: (p: LatLng) => void;
  onHover: (postal: string | null) => void;
  onSelect: (postal: string) => void;
};

const OSM_DATA = '施設データ &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// 登録不要・無料で公開サイトでも使える地図
// OpenFreeMap はベクタータイル（帰属表示はスタイル側から自動で入る）、地理院は画像タイル
type Basemap =
  | { name: string; kind: "vector"; styleUrl: string }
  | { name: string; kind: "raster"; url: string; attribution: string; maxZoom: number };

const BASEMAPS: Basemap[] = [
  { name: "標準（OpenFreeMap Liberty）", kind: "vector", styleUrl: "https://tiles.openfreemap.org/styles/liberty" },
  { name: "淡色（OpenFreeMap Positron）", kind: "vector", styleUrl: "https://tiles.openfreemap.org/styles/positron" },
  {
    name: "地理院 淡色地図",
    kind: "raster",
    url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
    attribution: `<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a> | ${OSM_DATA}`,
    maxZoom: 18,
  },
];

// 最後に選んだ地図を覚えておく（保存できない環境では既定の地図）
const BASEMAP_KEY = "area-score:basemap";
function loadBasemap() {
  try {
    const saved = localStorage.getItem(BASEMAP_KEY);
    if (BASEMAPS.some((b) => b.name === saved)) return saved!;
  } catch {
    // 読めなければ既定
  }
  return BASEMAPS[0].name;
}
const initialBasemap = loadBasemap();

function BasemapMemory() {
  useMapEvents({
    baselayerchange: (e) => {
      try {
        localStorage.setItem(BASEMAP_KEY, e.name);
      } catch {
        // 保存できなくても続行
      }
    },
  });
  return null;
}

const centerIcon = L.divIcon({
  className: "",
  html: '<div class="center-pin"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function ClickHandler({ onPick }: { onPick: Props["onPick"] }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function FlyTo({ center, radiusKm, token }: { center: LatLng; radiusKm: number; token: number }) {
  const map = useMap();
  useEffect(() => {
    if (token === 0) return;
    map.flyToBounds(L.latLng(center).toBounds(radiusKm * 2000 * 1.1), { duration: 0.8 });
    // center/radius の変化では動かさず、token の変化時だけ移動する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, map]);
  return null;
}

const BOUNDARY_ATTRIBUTION =
  '町域境界: <a href="https://www.e-stat.go.jp/gis">e-Stat</a> 国勢調査 小地域境界（2020）を加工';

type Boundary = Awaited<ReturnType<typeof findTownBoundary>>;

/**
 * 地図の表示枠の大きさが変わったとき（スマホで一覧を見ると地図が縮む）に Leaflet へ知らせる。
 * 変化が落ち着いたら onSettled を呼ぶ。
 */
function AutoResize({ onSettled }: { onSettled: () => void }) {
  const map = useMap();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
      clearTimeout(t);
      t = setTimeout(onSettled, 150);
    });
    ro.observe(map.getContainer());
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [map, onSettled]);
  return null;
}

/** 町域の境界を囲んで表示する。境界データがない地域では何も描かない */
function TownBoundary({
  town,
  variant,
  sizeTick,
  onResolved,
}: {
  town: ScoredTown;
  variant: "selected" | "hover";
  sizeTick: number; // 地図の大きさが変わったら見える位置か確認し直す
  onResolved: (postal: string, found: boolean) => void;
}) {
  const map = useMap();
  const [boundary, setBoundary] = useState<{ postal: string; features: Boundary } | null>(null);

  useEffect(() => {
    let alive = true;
    findTownBoundary(town).then(
      (features) => {
        if (!alive) return;
        setBoundary({ postal: town.postal, features });
        onResolved(town.postal, !!features);
      },
      () => alive && onResolved(town.postal, false),
    );
    return () => {
      alive = false;
    };
    // town オブジェクトはスコア再計算で作り直されるので、郵便番号が変わったときだけ読み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [town.postal]);

  const features = boundary?.postal === town.postal ? boundary.features : null;
  const data = useMemo<FeatureCollection | null>(
    () => features && { type: "FeatureCollection", features },
    [features],
  );

  // 選択した町が画面外なら、見える位置まで移動する
  useEffect(() => {
    if (variant !== "selected" || !data) return;
    const bounds = L.geoJSON(data).getBounds();
    if (!map.getBounds().contains(bounds)) map.flyToBounds(bounds, { padding: [24, 24], maxZoom: 16, duration: 0.6 });
  }, [data, variant, map, sizeTick]);

  if (!data) return null;
  const color = town.score ? scoreColor(town.score.total) : "#f97316";
  return (
    <GeoJSON
      key={`${town.postal}-${variant}`}
      data={data}
      interactive={false}
      attribution={BOUNDARY_ATTRIBUTION}
      style={
        variant === "selected"
          ? { color: "#18181b", weight: 3, fillColor: color, fillOpacity: 0.3 }
          : { color: "#18181b", weight: 2, dashArray: "5 4", fillColor: color, fillOpacity: 0.15 }
      }
    />
  );
}

export default function MapView({
  center,
  radiusKm,
  towns,
  highlighted,
  selected,
  flyToken,
  onPick,
  onHover,
  onSelect,
}: Props) {
  // 境界を表示できた町（点を大きくするのは境界がない町だけにする）
  const [outlined, setOutlined] = useState<Record<string, boolean>>({});
  const [sizeTick, setSizeTick] = useState(0);
  const onSizeSettled = useCallback(() => setSizeTick((n) => n + 1), []);
  const onResolved = (postal: string, found: boolean) =>
    setOutlined((o) => (o[postal] === found ? o : { ...o, [postal]: found }));

  const selectedTown = towns.find((t) => t.postal === selected);
  const hoverTown = highlighted !== selected ? towns.find((t) => t.postal === highlighted) : undefined;

  return (
    <MapContainer center={center} zoom={13} className="h-full w-full" scrollWheelZoom>
      <LayersControl position="topright">
        {BASEMAPS.map((b) => (
          <LayersControl.BaseLayer key={b.name} name={b.name} checked={b.name === initialBasemap}>
            {b.kind === "vector" ? (
              <VectorBasemap styleUrl={b.styleUrl} />
            ) : (
              <TileLayer attribution={b.attribution} url={b.url} maxZoom={b.maxZoom} />
            )}
          </LayersControl.BaseLayer>
        ))}
      </LayersControl>
      <BasemapMemory />
      <AutoResize onSettled={onSizeSettled} />
      <ClickHandler onPick={onPick} />
      <FlyTo center={center} radiusKm={radiusKm} token={flyToken} />
      <Circle
        center={center}
        radius={radiusKm * 1000}
        pathOptions={{ color: "#2563eb", weight: 2, fillOpacity: 0.08 }}
        interactive={false}
      />
      {/* 境界は町の点より下に描く（点のクリックを邪魔しない） */}
      <Pane name="boundaries" style={{ zIndex: 350 }}>
        {selectedTown && (
          <TownBoundary town={selectedTown} variant="selected" sizeTick={sizeTick} onResolved={onResolved} />
        )}
        {hoverTown && <TownBoundary town={hoverTown} variant="hover" sizeTick={sizeTick} onResolved={onResolved} />}
      </Pane>
      <Marker
        position={center}
        icon={centerIcon}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const p = (e.target as L.Marker).getLatLng();
            onPick({ lat: p.lat, lng: p.lng });
          },
        }}
      />
      {towns.map((t) => {
        // 境界を囲んで表示できる町は点を大きくせず、境界がない地域だけ点で強調する
        const active = (t.postal === highlighted || t.postal === selected) && !outlined[t.postal];
        const fill = t.score ? scoreColor(t.score.total) : "#f97316";
        return (
          <CircleMarker
            key={t.postal}
            center={{ lat: t.lat, lng: t.lng }}
            radius={active ? 10 : 7}
            bubblingMouseEvents={false} // 地図クリック（中心移動）に伝播させない
            pathOptions={{
              color: active ? "#18181b" : "#ffffff",
              fillColor: fill,
              fillOpacity: 0.9,
              weight: active ? 3 : 1.5,
            }}
            eventHandlers={{
              mouseover: () => onHover(t.postal),
              mouseout: () => onHover(null),
              click: () => onSelect(t.postal),
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {t.score && <b>{t.score.total}点 </b>}〒{t.postal} {t.city}
              {t.town}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
