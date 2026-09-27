// 町域の境界データ（地図で選んだ町を囲んで表示するため）を作るスクリプト。
//
// 出典: 政府統計の総合窓口(e-Stat) 国勢調査 令和2年 小地域（町丁・字等別）境界データ
//       https://www.e-stat.go.jp/gis （政府標準利用規約に基づき加工して利用）
//
// 使い方: node scripts/build-boundaries.mjs 40 13   （都道府県コードを並べる。福岡=40、東京=13）
//
// 1. 都道府県ごとの境界データ（shapefile の zip）をダウンロード
// 2. 「上牟田一丁目」「上牟田二丁目」… を町名（上牟田）ごとに1つの区域にまとめる（郵便番号の町域の単位に合わせる）
// 3. 形を簡略化して市区町村ごとの GeoJSON に分け、public/boundaries/ に書き出す
// 4. 「都道府県|市区町村名 → ファイル名」の対応表 public/boundaries/index.json を更新する
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR = "public/boundaries";
const INDEX = path.join(OUT_DIR, "index.json");

const prefCodes = process.argv.slice(2).map((c) => c.padStart(2, "0"));
if (!prefCodes.length || prefCodes.some((c) => !/^\d{2}$/.test(c) || +c < 1 || +c > 47)) {
  console.error("都道府県コード（01〜47）を指定してください。例: node scripts/build-boundaries.mjs 40");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : {};

for (const pref of prefCodes) {
  const work = mkdtempSync(path.join(tmpdir(), `boundaries-${pref}-`));
  try {
    const zip = path.join(work, `${pref}.zip`);
    const url = `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=${pref}&coordSys=1&format=shape&downloadType=5&datum=2011`;
    console.log(`[${pref}] ダウンロード中…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`e-Stat ${res.status}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

    console.log(`[${pref}] 変換中…`);
    const split = path.join(work, "split");
    mkdirSync(split);
    // mapshaper は脆弱性のある依存を含むためプロジェクトには入れず、npx で都度実行する。
    // Windows でも引数の引用符が壊れないよう、シェルを通さず npx 本体（npx-cli.js）を node で直接呼ぶ
    const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    execFileSync(
      process.execPath,
      [
        npxCli,
        "-y",
        "mapshaper@0.6",
        "-i", zip, "encoding=shiftjis",
        // 8101 = 通常の町丁・字（8154 = 水面 は除く）
        "-filter", 'HCODE === 8101 && S_NAME !== ""',
        "-each", 'N = S_NAME.replace(/[一二三四五六七八九十]+丁目$/, ""), C = PREF + CITY, P = PREF_NAME, CN = CITY_NAME',
        "-dissolve2", "fields=C,N", "copy-fields=P,CN",
        "-simplify", "12%", "keep-shapes",
        "-split", "C",
        "-o", split + path.sep, "format=geojson", "precision=0.00001",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );

    let count = 0;
    for (const file of readdirSync(split)) {
      const geo = JSON.parse(readFileSync(path.join(split, file), "utf8"));
      const { P, CN } = geo.features[0].properties;
      // ブラウザでは町名（N）しか使わないので、他の属性は捨ててサイズを減らす
      for (const f of geo.features) f.properties = { N: f.properties.N };
      writeFileSync(path.join(OUT_DIR, file), JSON.stringify(geo));
      index[`${P}|${CN}`] = file;
      count++;
    }
    console.log(`[${pref}] ${count} 市区町村を書き出しました`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

writeFileSync(INDEX, JSON.stringify(index, Object.keys(index).sort(), 0));
console.log(`index.json: ${Object.keys(index).length} 市区町村`);
