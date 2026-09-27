import { MAX_CRITERION_RADIUS_M, type Category, type Facility } from "@/lib/score";

// 公開 Overpass サーバー（混雑して 504 等が返ることがよくあるので、失敗したら次を試す）
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const MAX_RADIUS_KM = 15;

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

async function queryOverpass(query: string) {
  let lastError: unknown;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "area-score/0.1" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      return json.elements as OsmElement[];
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// 同じ場所・半径の再検索はキャッシュから返す（Overpass の負荷軽減）
const cache = new Map<string, Promise<Facility[]>>();

async function fetchFacilities(lat: number, lng: number, radiusKm: number) {
  const radiusM = radiusKm * 1000 + MAX_CRITERION_RADIUS_M;
  const elements = await queryOverpass(buildQuery(lat, lng, radiusM));
  const facilities: Facility[] = [];
  for (const el of elements) {
    const category = el.tags && categorize(el.tags);
    const fLat = el.lat ?? el.center?.lat;
    const fLng = el.lon ?? el.center?.lon;
    if (!category || fLat === undefined || fLng === undefined) continue;
    facilities.push([category, Math.round(fLat * 1e6) / 1e6, Math.round(fLng * 1e6) / 1e6]);
  }
  return facilities;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radiusKm = Number(searchParams.get("r"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(radiusKm > 0)) {
    return Response.json({ error: "lat, lng, r を指定してください" }, { status: 400 });
  }
  if (radiusKm > MAX_RADIUS_KM) {
    return Response.json({ error: `半径は ${MAX_RADIUS_KM}km 以下にしてください` }, { status: 400 });
  }

  const key = `${lat.toFixed(4)},${lng.toFixed(4)},${radiusKm}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchFacilities(lat, lng, radiusKm);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }

  try {
    return Response.json({ facilities: await p });
  } catch (e) {
    return Response.json({ error: `施設データの取得に失敗しました: ${(e as Error).message}` }, { status: 502 });
  }
}
