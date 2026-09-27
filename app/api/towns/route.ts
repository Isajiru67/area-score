import { distanceKm, samplePoints, type Town } from "@/lib/geo";

// 住所データ: HeartRails Geo API（郵便番号・町域・代表点の座標を返す無料API）
const API = "https://geoapi.heartrails.com/api/json";
const MAX_RADIUS_KM = 15;

type HrLocation = {
  prefecture: string;
  city: string;
  town: string;
  postal: string;
  x: string; // 経度
  y: string; // 緯度
};

// 市区町村ごとの町域一覧はほぼ変わらないのでプロセス内でキャッシュ
const cityCache = new Map<string, Promise<HrLocation[]>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hr(params: Record<string, string>): Promise<HrLocation[]> {
  const url = `${API}?${new URLSearchParams(params)}`;
  // 短時間に大量に叩くと 429 が返るので、待ってリトライする
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 && attempt < 5) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`HeartRails API ${res.status}`);
    const json = await res.json();
    return json.response?.location ?? [];
  }
}

function getTowns(prefecture: string, city: string) {
  const key = `${prefecture}|${city}`;
  let p = cityCache.get(key);
  if (!p) {
    p = hr({ method: "getTowns", prefecture, city });
    p.catch(() => cityCache.delete(key));
    cityCache.set(key, p);
  }
  return p;
}

/** 同時実行数を制限して map する */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ビルの階ごとの郵便番号や「以下に掲載がない場合」「（その他）」は除外
const EXCLUDE = /(階|階層不明|以下に掲載がない場合|^（その他）$)/;

/**
 * 高層ビル単位の郵便番号（例: 103-6090 日本橋東京日本橋タワー）を判定。
 * ビルの「地階・階層不明」は末尾 90 で、町域名が「元の町名＋ビル名」になっている。
 */
function isBuilding(loc: HrLocation, townNames: string[]) {
  return (
    loc.postal.endsWith("90") &&
    townNames.some((n) => n !== loc.town && loc.town.startsWith(n))
  );
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

  try {
    // 1. サンプル地点の最寄り町域から、円にかかる市区町村を洗い出す
    const nearby = await mapLimit(samplePoints(lat, lng, radiusKm), 3, (p) =>
      hr({ method: "searchByGeoLocation", x: String(p.lng), y: String(p.lat) }).catch(() => []),
    );
    const cities = new Map<string, { prefecture: string; city: string }>();
    for (const loc of nearby.flat()) {
      cities.set(`${loc.prefecture}|${loc.city}`, { prefecture: loc.prefecture, city: loc.city });
    }

    // 2. 各市区町村の全町域を取得し、円内のものだけ残す
    const townLists = await mapLimit([...cities.values()], 3, (c) => getTowns(c.prefecture, c.city));

    const byPostal = new Map<string, Town>();
    for (const list of townLists) {
      const names = list.map((l) => l.town);
      for (const loc of list) {
        if (EXCLUDE.test(loc.town) || isBuilding(loc, names)) continue;
        const tLat = Number(loc.y);
        const tLng = Number(loc.x);
        const d = distanceKm(lat, lng, tLat, tLng);
        if (d > radiusKm) continue;
        const postal = `${loc.postal.slice(0, 3)}-${loc.postal.slice(3)}`;
        const prev = byPostal.get(postal);
        if (prev) {
          // 1つの郵便番号に複数町域がある場合は名前を連結
          if (!prev.town.split("・").includes(loc.town)) prev.town += `・${loc.town}`;
          continue;
        }
        byPostal.set(postal, {
          postal,
          prefecture: loc.prefecture,
          city: loc.city,
          town: loc.town,
          lat: tLat,
          lng: tLng,
          distanceKm: Math.round(d * 100) / 100,
        });
      }
    }

    const towns = [...byPostal.values()].sort((a, b) => a.distanceKm - b.distanceKm);
    return Response.json({ towns, cities: [...cities.values()] });
  } catch (e) {
    return Response.json({ error: `住所データの取得に失敗しました: ${(e as Error).message}` }, { status: 502 });
  }
}
