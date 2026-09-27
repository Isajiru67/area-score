import { cacheGet, cacheSet } from "./browserCache";
import { mapLimit, sleep, withTimeout, type OnProgress } from "./fetchUtil";
import { distanceKm, samplePoints, type Town } from "./geo";

// 住所データ: HeartRails Geo API（郵便番号・町域・代表点の座標を返す無料API。ブラウザから直接呼べる）
const API = "https://geoapi.heartrails.com/api/json";
export const MAX_RADIUS_KM = 15;

type HrLocation = {
  prefecture: string;
  city: string;
  town: string;
  postal: string;
  x: string; // 経度
  y: string; // 緯度
};

async function hr(params: Record<string, string>, signal?: AbortSignal): Promise<HrLocation[]> {
  const url = `${API}?${new URLSearchParams(params)}`;
  // 短時間に大量に叩くと 429 が返るので、待ってリトライする
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: withTimeout(signal, 20_000) });
    if (res.status === 429 && attempt < 5) {
      await sleep(500 * 2 ** attempt, signal);
      continue;
    }
    if (!res.ok) throw new Error(`HeartRails API ${res.status}`);
    const json = await res.json();
    return json.response?.location ?? [];
  }
}

// 市区町村ごとの町域一覧はほぼ変わらないので、メモリとブラウザに保存して使い回す
const cityMemo = new Map<string, Promise<HrLocation[]>>();

function getTowns(prefecture: string, city: string, signal?: AbortSignal) {
  const key = `towns:${prefecture}|${city}`;
  let p = cityMemo.get(key);
  if (!p) {
    const cached = cacheGet<HrLocation[]>(key, 90);
    p = cached
      ? Promise.resolve(cached)
      : hr({ method: "getTowns", prefecture, city }, signal).then((list) => {
          cacheSet(key, list);
          return list;
        });
    p.catch(() => cityMemo.delete(key));
    cityMemo.set(key, p);
  }
  return p;
}

// ビルの階ごとの郵便番号や「以下に掲載がない場合」「（その他）」は除外
const EXCLUDE = /(階|階層不明|以下に掲載がない場合|^（その他）$)/;

/**
 * 高層ビル単位の郵便番号（例: 103-6090 日本橋東京日本橋タワー）を判定。
 * ビルの「地階・階層不明」は末尾 90 で、町域名が「元の町名＋ビル名」になっている。
 */
function isBuilding(loc: HrLocation, townNames: string[]) {
  return loc.postal.endsWith("90") && townNames.some((n) => n !== loc.town && loc.town.startsWith(n));
}

/** 中心から半径 radiusKm の円に代表点が入る町域を、郵便番号単位で近い順に返す */
export async function fetchTowns(
  lat: number,
  lng: number,
  radiusKm: number,
  signal?: AbortSignal,
  onProgress?: OnProgress,
) {
  if (radiusKm > MAX_RADIUS_KM) throw new Error(`半径は ${MAX_RADIUS_KM}km 以下にしてください`);

  // 1. サンプル地点の最寄り町域から、円にかかる市区町村を洗い出す（進捗の 0〜70%）
  const points = samplePoints(lat, lng, radiusKm);
  let done = 0;
  onProgress?.({ message: "円の中の市区町村を探しています", ratio: 0 });
  const nearby = await mapLimit(points, 3, async (p) => {
    const result = await hr({ method: "searchByGeoLocation", x: String(p.lng), y: String(p.lat) }, signal).catch(
      (e) => {
        if (signal?.aborted) throw e;
        return [];
      },
    );
    onProgress?.({ message: "円の中の市区町村を探しています", ratio: (++done / points.length) * 0.7 });
    return result;
  });
  const cities = new Map<string, { prefecture: string; city: string }>();
  for (const loc of nearby.flat()) {
    cities.set(`${loc.prefecture}|${loc.city}`, { prefecture: loc.prefecture, city: loc.city });
  }

  // 2. 各市区町村の全町域を取得し、円内のものだけ残す（進捗の 70〜100%）
  const cityList = [...cities.values()];
  done = 0;
  const townLists = await mapLimit(cityList, 3, async (c) => {
    onProgress?.({ message: `${c.city} の町名を取得中`, ratio: 0.7 + (done / cityList.length) * 0.3 });
    const list = await getTowns(c.prefecture, c.city, signal);
    done++;
    return list;
  });

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

  return [...byPostal.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}
