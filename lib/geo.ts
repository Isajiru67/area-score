export type Town = {
  postal: string; // "123-4567"
  prefecture: string;
  city: string;
  town: string;
  lat: number;
  lng: number;
  distanceKm: number;
};

const EARTH_RADIUS_KM = 6371;

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** 中心から (dxKm, dyKm) ずらした地点の緯度経度 */
export function offset(lat: number, lng: number, dxKm: number, dyKm: number) {
  const dLat = (dyKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const dLng = (dxKm / (EARTH_RADIUS_KM * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * 円内の市区町村を洗い出すためのサンプル地点。
 * 円内の格子点＋円周上の点（境界ぎりぎりの市区町村を拾うため）。
 */
export function samplePoints(lat: number, lng: number, radiusKm: number) {
  const points: { lat: number; lng: number }[] = [{ lat, lng }];
  const step = Math.max(1, radiusKm / 4);
  for (let x = -radiusKm; x <= radiusKm; x += step) {
    for (let y = -radiusKm; y <= radiusKm; y += step) {
      if (x * x + y * y <= radiusKm * radiusKm && (x !== 0 || y !== 0)) {
        points.push(offset(lat, lng, x, y));
      }
    }
  }
  const ringCount = Math.min(40, Math.max(12, Math.ceil((2 * Math.PI * radiusKm) / 1.2)));
  for (let i = 0; i < ringCount; i++) {
    const t = (2 * Math.PI * i) / ringCount;
    points.push(offset(lat, lng, radiusKm * Math.cos(t), radiusKm * Math.sin(t)));
  }
  return points;
}
