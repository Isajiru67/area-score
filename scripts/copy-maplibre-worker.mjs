// MapLibre v6 の Web Worker は別ファイルで、Next.js のバンドルに含められないため public/ に置く。
// dev / build の前に自動実行（package.json の predev / prebuild）するので、バージョンは常に node_modules と一致する。
import { cpSync, mkdirSync } from "node:fs";

const src = "node_modules/maplibre-gl/dist";
const dest = "public/maplibre";
mkdirSync(dest, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  cpSync(`${src}/${f}`, `${dest}/${f}`);
}
