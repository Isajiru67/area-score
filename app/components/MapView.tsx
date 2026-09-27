"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  LayersControl,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { scoreColor } from "@/lib/score";
import type { ScoredTown } from "./AreaFinder";
import { VectorBasemap } from "./VectorBasemap";

export type LatLng = { lat: number; lng: number };

type Props = {
  center: LatLng;
  radiusKm: number;
  towns: ScoredTown[];
  highlighted: string | null;
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

export default function MapView({ center, radiusKm, towns, highlighted, flyToken, onPick, onHover, onSelect }: Props) {
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
      <BasemapMemory />      <ClickHandler onPick={onPick} />
      <FlyTo center={center} radiusKm={radiusKm} token={flyToken} />
      <Circle
        center={center}
        radius={radiusKm * 1000}
        pathOptions={{ color: "#2563eb", weight: 2, fillOpacity: 0.08 }}
        interactive={false}
      />
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
        const active = t.postal === highlighted;
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
