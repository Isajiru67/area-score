import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // サーバー不要の静的サイトとして out/ に書き出す（GitHub Pages / Cloudflare Pages 等に置ける）
  output: "export",
  // GitHub Pages のようにサブパス（/area-score）で公開する場合は BASE_PATH を指定してビルドする
  basePath: process.env.BASE_PATH || undefined,
  // public/ のファイルをブラウザ側のコードから参照するときに使う
  env: { NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || "" },
};

export default nextConfig;
