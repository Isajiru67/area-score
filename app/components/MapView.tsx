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
import type { Town } from "@/lib/geo";

export type LatLng = { lat: number; lng: number };

type Props = {
  center: LatLng;
  radiusKm: number;
  towns: Town[];
  highlighted: string | null;
  flyToken: number; // 値が変わったら中心へ移動（住所検索時など）
  onPick: (p: LatLng) => void;
  onHover: (postal: string | null) => void;
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

export default function MapView({ center, radiusKm, towns, highlighted, flyToken, onPick, onHover }: Props) {
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
        return (
          <CircleMarker
            key={t.postal}
            center={{ lat: t.lat, lng: t.lng }}
            radius={active ? 9 : 5}
            pathOptions={{
              color: active ? "#dc2626" : "#ea580c",
              fillColor: active ? "#dc2626" : "#f97316",
              fillOpacity: 0.85,
              weight: active ? 3 : 1,
            }}
            eventHandlers={{
              mouseover: () => onHover(t.postal),
              mouseout: () => onHover(null),
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              〒{t.postal} {t.city}
              {t.town}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
