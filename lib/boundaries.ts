import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { Town } from "./geo";

// 町域の境界データ（scripts/build-boundaries.mjs で e-Stat の小地域境界から作成し public/boundaries に同梱）
// 変換済みの都道府県だけ境界を表示でき、それ以外は null を返す（地図では代表点の表示のみになる）

type TownFeature = Feature<Polygon | MultiPolygon, { N: string }>;

const BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/boundaries`;

let indexPromise: Promise<Record<string, string>> | null = null;
const cityPromises = new Map<string, Promise<TownFeature[]>>();

function loadIndex() {
  indexPromise ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => {
      indexPromise = null;
      return {};
    });
  return indexPromise;
}

function loadCity(file: string) {
  let p = cityPromises.get(file);
  if (!p) {
    p = fetch(`${BASE}/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`boundaries ${r.status}`);
        return r.json() as Promise<FeatureCollection<Polygon | MultiPolygon, { N: string }>>;
      })
      .then((g) => g.features);
    p.catch(() => cityPromises.delete(file));
    cityPromises.set(file, p);
  }
  return p;
}

/** 郵便番号データと国勢調査データの表記ゆれをそろえる（中洲/中州、ヶ/ケ、大字の有無 など） */
function normalize(name: string) {
  return name
    .normalize("NFKC")
    .replace(/^大字/, "")
    .replace(/洲/g, "州")
    .replace(/[ヶヵケ]/g, "ケ")
    .replace(/\s/g, "");
}

// 点がポリゴンの中にあるか（レイキャスティング法）
function inRing(x: number, y: number, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(f: TownFeature, lng: number, lat: number) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));
}

/**
 * 町域（郵便番号単位）の境界を返す。
 * 町名で探し、見つからなければ代表点を含む区域を使う。境界データがない地域は null。
 */
export async function findTownBoundary(town: Town): Promise<TownFeature[] | null> {
  const index = await loadIndex();
  // e-Stat は「粕屋町」、郵便番号データは「糟屋郡粕屋町」のように郡名の有無が違う
  const file =
    index[`${town.prefecture}|${town.city}`] ?? index[`${town.prefecture}|${town.city.replace(/^.+?郡/, "")}`];
  if (!file) return null;

  const features = await loadCity(file);
  // 1つの郵便番号に複数の町がある場合は「A・B」と連結しているので、それぞれ探す
  const wanted = new Set(town.town.split("・").map(normalize));
  const byName = features.filter((f) => wanted.has(normalize(f.properties.N)));
  if (byName.length) return byName;

  const byPoint = features.find((f) => contains(f, town.lng, town.lat));
  return byPoint ? [byPoint] : null;
}
