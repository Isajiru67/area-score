"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { scoreColor } from "@/lib/score";
import type { ScoredTown } from "./AreaFinder";

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
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onPick} />
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
