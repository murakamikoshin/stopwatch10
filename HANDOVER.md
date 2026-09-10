# 引き継ぎメモ

設計の理由・モード・スコアの決まりは README.md に移した。ここは進み具合だけ。

## 済んだこと

- [x] モード切り替え UI（10秒ノーヒント / 10秒ヒントあり / 100秒）とモードごとの記録保持
- [x] 3秒ヒント表示（rAF。閾値で完全消灯してループを止める）
- [x] 100秒モード（表示を 3桁 + 3桁に組み替え）と離席検出（`visibilitychange`）
- [x] 合計から平均表示への変更、ベスト1回の保持
- [x] Workers + KV のランキング（`worker/`）とクライアント側の結線
- [x] ベスト1回のタイブレーク＝**残り2回の誤差合計**。同値なら先着（README 参照）
- [x] 旧版 `pittari10.best`（3回の誤差合計）を平均に読み替えて持ち越す
- [x] 検算（`worker/test.mjs` 30件 / `test/browser.mjs` 34件 / `test/rank.mjs` 15件）

## 残っていること

- [ ] `node tools/dist.mjs` して `npx wrangler pages deploy dist --project-name stopwatch10`
      （Cloudflare の操作が要るので、村上さんの手で）。出したら koshin-studio 側で
      `worker/` を deploy し直すと `koshinstudio.com/play/stopwatch10/` が繋がる
- [ ] KV を作って `worker/wrangler.toml` に id を貼り、deploy する
      （これも Cloudflare の操作が要る）
- [ ] 出た URL を `index.html` の `<meta name="stopwatch10-api">` に入れる。
      **ここが空のあいだ、ランキングの枠はそもそも画面に出ない**
- [ ] プレイ数が伸びたら、ヒントあり・100秒のランキングを開ける。
      開けるのは `worker/src/index.js` の `MODES[].open` と
      `index.html` の `MODES[].ranked` の両方
- [ ] 100秒モードの真の一発勝負（リロードで無限に挑戦できるのは、
      サーバー側で回数を持たない限り塞げない）
- [ ] 100秒の3秒ヒントが効かないと感じたら `HINT_100` を `10000` にする

## さわるときの注意

計測中に動くものを足さないこと。理由は README の「崩してはいけない三つ」。
`test/browser.mjs` に「計測中はなにも点かない」という確認が入っているので、
うっかり足すとそこで落ちる。
