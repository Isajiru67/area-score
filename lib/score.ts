export type Category =
  | "station"
  | "shopping"
  | "convenience"
  | "medical"
  | "education"
  | "park"
  | "food"
  | "public";

/** [カテゴリ, 緯度, 経度] */
export type Facility = [Category, number, number];

type Criterion = {
  key: Category;
  label: string;
  weight: number; // 配点（合計100）
  radiusM: number; // 町の代表点からこの範囲内の施設を数える
  /** 件数型: target 件で満点（対数カーブ＝最初の数件ほど効く） / 距離型: 最寄りが fullM 以内で満点、zeroM 以上で0点 */
  rule: { type: "count"; target: number } | { type: "nearest"; fullM: number; zeroM: number };
  description: string;
};

export const CRITERIA: Criterion[] = [
  { key: "station", label: "駅", weight: 25, radiusM: 2000, rule: { type: "nearest", fullM: 300, zeroM: 1600 }, description: "最寄り駅まで300m以内で満点、1.6km以上で0点" },
  { key: "shopping", label: "スーパー・ドラッグストア", weight: 20, radiusM: 800, rule: { type: "count", target: 15 }, description: "800m以内 15件で満点" },
  { key: "medical", label: "病院・診療所・薬局", weight: 15, radiusM: 800, rule: { type: "count", target: 30 }, description: "800m以内 30件で満点" },
  { key: "convenience", label: "コンビニ", weight: 10, radiusM: 500, rule: { type: "count", target: 8 }, description: "500m以内 8件で満点" },
  { key: "education", label: "学校・幼稚園・保育園", weight: 10, radiusM: 800, rule: { type: "count", target: 15 }, description: "800m以内 15件で満点" },
  { key: "park", label: "公園", weight: 10, radiusM: 800, rule: { type: "count", target: 20 }, description: "800m以内 20件で満点" },
  { key: "food", label: "飲食店・カフェ", weight: 5, radiusM: 500, rule: { type: "count", target: 60 }, description: "500m以内 60件で満点" },
  { key: "public", label: "交番・図書館", weight: 5, radiusM: 1000, rule: { type: "count", target: 6 }, description: "1km以内 6件で満点" },
];

/** 施設取得時に円の外側へ広げる距離（円の縁の町でも周辺施設を数えられるように） */
export const MAX_CRITERION_RADIUS_M = Math.max(...CRITERIA.map((c) => c.radiusM));

export type Breakdown = {
  key: Category;
  label: string;
  count: number;
  nearestM: number | null;
  points: number;
  weight: number;
};

export type AreaScore = { total: number; breakdown: Breakdown[] };

// 数km程度なら正距円筒近似で十分（町×施設で数百万回計算するので軽さ優先）
function approxDistanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * 111_195;
}

export function scoreArea(lat: number, lng: number, facilities: Facility[]): AreaScore {
  const counts = new Map<Category, number>();
  const nearest = new Map<Category, number>();
  const radius = new Map(CRITERIA.map((c) => [c.key, c.radiusM]));

  for (const [cat, fLat, fLng] of facilities) {
    const d = approxDistanceM(lat, lng, fLat, fLng);
    if (d > (radius.get(cat) ?? 0)) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
    if (d < (nearest.get(cat) ?? Infinity)) nearest.set(cat, d);
  }

  const breakdown = CRITERIA.map((c): Breakdown => {
    const count = counts.get(c.key) ?? 0;
    const nearestM = nearest.get(c.key) ?? null;
    let ratio: number;
    if (c.rule.type === "count") {
      // 0件→1件の差は大きく、20件→21件の差は小さい、という実感に合わせて対数で逓減させる
      ratio = Math.min(1, Math.log1p(count) / Math.log1p(c.rule.target));
    } else {
      const { fullM, zeroM } = c.rule;
      ratio = nearestM === null ? 0 : Math.min(1, Math.max(0, (zeroM - nearestM) / (zeroM - fullM)));
    }
    return {
      key: c.key,
      label: c.label,
      count,
      nearestM: nearestM === null ? null : Math.round(nearestM),
      points: Math.round(c.weight * ratio * 10) / 10,
      weight: c.weight,
    };
  });

  const total = Math.round(breakdown.reduce((s, b) => s + b.points, 0));
  return { total, breakdown };
}

/** スコア → 色（0=赤 → 50=黄 → 100=緑） */
export function scoreColor(score: number) {
  const hue = Math.max(0, Math.min(100, score)) * 1.2;
  return `hsl(${hue} 75% 45%)`;
}
