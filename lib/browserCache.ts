// 取得結果をブラウザ（localStorage）に保存して、同じエリアの再検索を速くする。
// 容量（5MB 前後）があふれたら古いものから消す。保存できなくても動作には影響しない。

const PREFIX = "area-score:";
const DAY = 24 * 60 * 60 * 1000;

type Entry<T> = { t: number; v: T };

export function cacheGet<T>(key: string, maxAgeDays: number): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (Date.now() - entry.t > maxAgeDays * DAY) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry.v;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T) {
  const raw = JSON.stringify({ t: Date.now(), v: value } satisfies Entry<T>);
  try {
    localStorage.setItem(PREFIX + key, raw);
  } catch {
    try {
      evictOldestHalf();
      localStorage.setItem(PREFIX + key, raw);
    } catch {
      // 保存できなくても続行
    }
  }
}

function evictOldestHalf() {
  const entries: { key: string; t: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      entries.push({ key, t: (JSON.parse(localStorage.getItem(key)!) as Entry<unknown>).t });
    } catch {
      entries.push({ key, t: 0 });
    }
  }
  entries.sort((a, b) => a.t - b.t);
  for (const e of entries.slice(0, Math.ceil(entries.length / 2))) localStorage.removeItem(e.key);
}
