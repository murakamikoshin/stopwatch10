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

## 公開したもの（2026-09-12）

| | |
|---|---|
| ゲーム本体 | `https://stopwatch10.pages.dev`（Pages プロジェクト `stopwatch10`） |
| 遊ぶ道 | `https://koshinstudio.com/play/stopwatch10/`（koshin-studio の worker が中継） |
| 紹介ページ | `https://koshinstudio.com/works/stopwatch10/` |
| ランキング | `https://stopwatch10-rank.murakamikoshin.workers.dev`（KV: SCORES） |

直したときの出し方は README の「出す」。ゲームを直しただけなら、
そこだけ出せばよく、サイト側は触らなくていい。

    node tools/dist.mjs
    npx wrangler pages deploy dist --project-name stopwatch10 --branch main

`--branch` は落とさない。落とすと、そのとき居た git の branch 名が本番ブランチとして
登録される（最初の一回でそれをやってしまい、2026-09-12 に `main` へ直した）。
`Deployment alias URL:` の行が出たら preview に入っただけ。

いまの設定は `npx wrangler pages project list` の Production branch 列で見る。
`deployment list` のほうは履歴なので、Production 行に古いブランチ名が残る。

## 残っていること

- [ ] プレイ数が伸びたら、ヒントあり・100秒のランキングを開ける。
      開けるのは `worker/src/index.js` の `MODES[].open` と
      `index.html` の `MODES[].ranked` の両方
- [ ] 100秒モードの真の一発勝負（リロードで無限に挑戦できるのは、
      サーバー側で回数を持たない限り塞げない）
- [ ] 100秒の3秒ヒントが効かないと感じたら `HINT_100` を `10000` にする
- [ ] 通算の盤に入った記録を消す道が無い。試しに送ったものもそのまま残るので、
      本気でない記録は送らない。消す必要が出たら KV のキー
      `b:s10:all` を消す（その日ぶんは `b:s10:d:<日付>`、3日で自然に消える）

## さわるときの注意

計測中に動くものを足さないこと。理由は README の「崩してはいけない三つ」。
`test/browser.mjs` に「計測中はなにも点かない」という確認が入っているので、
うっかり足すとそこで落ちる。
