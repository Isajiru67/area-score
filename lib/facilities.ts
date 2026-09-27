import { cacheGet, cacheSet } from "./browserCache";
import { sleep, withTimeout, type OnProgress } from "./fetchUtil";
import { MAX_CRITERION_RADIUS_M, type Category, type Facility } from "./score";
import { MAX_RADIUS_KM } from "./towns";

// 公開 Overpass サーバー（ブラウザから直接呼べる）。混雑時は 504/429 がすぐ返ってくることが多く、
// 少し待って再送すれば通ることがほとんどなので、交互にリトライする。
// （kumi.systems / private.coffee は応答せず60秒待たされることが多いので使わない）
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const MAX_ATTEMPTS = 8;

// OSM タグ → スコアのカテゴリ
const TAG_RULES: { key: string; values: string[]; category: Category }[] = [
  { key: "railway", values: ["station"], category: "station" },
  { key: "shop", values: ["supermarket", "chemist", "drugstore"], category: "shopping" },
  { key: "shop", values: ["convenience"], category: "convenience" },
  { key: "amenity", values: ["hospital", "clinic", "doctors", "pharmacy"], category: "medical" },
  { key: "amenity", values: ["school", "kindergarten", "childcare"], category: "education" },
  { key: "leisure", values: ["park"], category: "park" },
  { key: "amenity", values: ["restaurant", "cafe", "fast_food"], category: "food" },
  { key: "amenity", values: ["police", "library"], category: "public" },
];

type OsmElement = {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function buildQuery(lat: number, lng: number, radiusM: number) {
  // 同じタグキーの値はまとめて1本の正規表現にする
  const byKey = new Map<string, string[]>();
  for (const r of TAG_RULES) byKey.set(r.key, [...(byKey.get(r.key) ?? []), ...r.values]);
  const around = `(around:${Math.round(radiusM)},${lat},${lng})`;
  const lines = [...byKey].map(([k, vs]) => `  nwr["${k}"~"^(${vs.join("|")})$"]${around};`);
  return `[out:json][timeout:60];\n(\n${lines.join("\n")}\n);\nout tags center qt;`;
}

function categorize(tags: Record<string, string>): Category | null {
  for (const r of TAG_RULES) {
    if (r.values.includes(tags[r.key])) return r.category;
  }
  return null;
}

async function queryOverpass(query: string, signal?: AbortSignal, onProgress?: OnProgress) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    onProgress?.({
      message:
        attempt === 0
          ? "周辺の施設を取得中（OpenStreetMap）"
          : `サーバーが混雑しているため再試行中（${attempt + 1}/${MAX_ATTEMPTS}回目）`,
    });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: withTimeout(signal, 70_000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      // タイムアウト等は 200 + remark で返ってくることがある
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
        throw new Error(`Overpass: ${json.remark}`);
      }
      return json.elements as OsmElement[];
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
      console.warn(`[facilities] ${new URL(url).host} 失敗 (${attempt + 1}/${MAX_ATTEMPTS}): ${(e as Error).message}`);
      await sleep(Math.min(2000 * (attempt + 1), 8000), signal);
    }
  }
  throw lastError;
}

/** 円＋周辺（スコア計算に必要な範囲）の施設を取得する。同じ場所・半径はブラウザに保存した結果を使う */
export async function fetchFacilities(
  lat: number,
  lng: number,
  radiusKm: number,
  signal?: AbortSignal,
  onProgress?: OnProgress,
) {
  if (radiusKm > MAX_RADIUS_KM) throw new Error(`半径は ${MAX_RADIUS_KM}km 以下にしてください`);

  const key = `facilities:${lat.toFixed(4)},${lng.toFixed(4)},${radiusKm}`;
  const cached = cacheGet<Facility[]>(key, 30);
  if (cached) return cached;

  let elements: OsmElement[];
  try {
    elements = await queryOverpass(buildQuery(lat, lng, radiusKm * 1000 + MAX_CRITERION_RADIUS_M), signal, onProgress);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`施設データの取得に失敗しました（Overpass API が混雑中の可能性があります）: ${(e as Error).message}`);
  }

  const facilities: Facility[] = [];
  for (const el of elements) {
    const category = el.tags && categorize(el.tags);
    const fLat = el.lat ?? el.center?.lat;
    const fLng = el.lon ?? el.center?.lon;
    if (!category || fLat === undefined || fLng === undefined) continue;
    facilities.push([category, Math.round(fLat * 1e6) / 1e6, Math.round(fLng * 1e6) / 1e6]);
  }
  cacheSet(key, facilities);
  return facilities;
}
