# 10秒ピッタリで止めろ！

頭の中で目標の秒数を数えて止める、ブラウザゲーム。
本体は `index.html` 一枚。外部 library はゼロ。開けばもう始まっている。

    index.html        ゲーム本体（これだけで動く）
    tools/dist.mjs    配る形（dist/）を組む
    worker/           ランキング（Cloudflare Workers + KV）
    store/            表紙の元（サイトの表紙はここから作る）
    test/             確かめるための道具（遊ぶのには要らない）

## 崩してはいけない三つ

**1. 表示は小数3桁まで。**
`performance.now()` は Spectre 対策で意図的に精度が落としてある。Chrome は
crossOriginIsolated でも 5µs、Safari / Firefox は 1ms 刻み。6桁出すと、時計の粗い
端末ほど末尾が `000` になって有利になり、iPhone 勢が上位を独占する。3桁に切って
全端末を揃えるのが公平。

**2. 計測は `pointerdown` の `event.timeStamp`。**
`click` は余計な遅延が乗る。`timeStamp` は `performance.now()` と同じ time origin
なので、そのまま引き算できる。

**3. 計測中に周期的な動きを置かない。**
点滅するドット、脈打つボタン、動くもの全般。1Hz で光る要素があると、それが
メトロノーム代わりになって「自力で数える」というゲーム性が丸ごと消える。
CSS アニメーションを足すときは、必ず計測中に止まることを確かめる
（`test/browser.mjs` に「計測中はなにも点かない」という確認が入れてある）。

## モード

| モード | 目標 | ヒント | 回数 | ランキング |
|---|---|---|---|---|
| 10秒ノーヒント | 10.000 | なし | 3回 | 公開中 |
| 10秒ヒントあり | 10.000 | 最初の3秒だけ時計 | 3回 | まだ |
| 100秒 | 100.000 | 最初の3秒だけ時計 | 1回 | まだ |

モードを全部いっぺんに公開すると、盤が分散して全部過疎に見える。まずノーヒント
10秒の2本（平均・ベスト1回）だけ流し、プレイ数が伸びてから足す。開け閉めは
`worker/src/index.js` の `MODES[].open` と `index.html` の `MODES[].ranked` の
両方を true にする。

ヒントは rAF で回して、閾値を越えた瞬間に完全に消灯してループを止める
（`setTimeout` はドリフトするので使わない）。100秒モードの3秒ヒントは全体の3%
しかなく、テンポの基準としてはほぼ効かない。効かせたいなら `HINT_100` を `10000`
にすると最初の10秒表示に変わる。定数1個で切り替わる。

計測中に画面を離れる（タブ切り替え・スリープ）と、その勝負は無効になる。
`visibilitychange` で見ている。100秒モードのためだが、裏で別の時計を見るのを
塞ぐ意味もあるので全モードで効かせている。

サーバーがない以上、リロードすれば何度でも挑戦できる。真の一発勝負は Workers
側でしか作れない。今はそこまでやっていない。

## スコア

- 誤差 = 実測 − 目標（ms）。順位は**絶対値**で見る
- 3回モードは誤差の絶対値を合計し、**平均で表示**する
  （「合計0.147秒」より「1回あたり0.049秒」のほうが腕前が直感的にわかる）
- 合計ランキングと平均ランキングは順位が完全に一致する（3で割るだけ）ので、
  1本にまとめてある
- 別軸として「**3回のうちベスト1回**」の盤を置く。平均が実力、ベスト1回が運

### ベスト1回のタイブレーク（決めた）

ベスト1回は 0.000 の同着が詰まる（1/1000 × 3回 ≒ 1/333）。
**タイブレークは「残り2回の誤差合計」が小さいほう**。それも同じなら先に出した
ほうが上。0.000 を出したうえで残り2回も揃えた人が上に来るので、まぐれ1回だけの
人と区別がつく。判定は `worker/src/index.js` の `byOne`。

## ランキングを動かす

    cd stopwatch10/worker        # ← サイトの worker/ ではない。ゲームのほう
    npx wrangler deploy

KV はもう作ってあり、`wrangler.toml` に id を書いてある。作り直すときは

    npx wrangler kv namespace create SCORES   # 出た id を wrangler.toml に貼る

置き場の名前は `stopwatch10-rank`。出る URL は
`https://stopwatch10-rank.<アカウント>.workers.dev` で、`index.html` の

    <meta name="stopwatch10-api" content="https://stopwatch10-rank.murakamikoshin.workers.dev">

が最初からそこを指している。**deploy すれば、ゲーム側は触らなくても繋がる。**
別のアカウントや別の名前で出すなら、この meta を書き換える。

繋がるまでのあいだ（まだ deploy していない、落ちている、繋がらない）は、
**ランキングの枠そのものが画面に出ない**。断りも出さない。遊ぶのに支障は無いので、
空の枠や赤い字を見せるより黙っているほうがいい。

受け付ける出どころは `wrangler.toml` の `ALLOW_ORIGINS`。
いまは koshinstudio.com と stopwatch10.pages.dev の二つ。

クライアント申告なので不正は防げない。**デイリーリセット前提**で流す。日付は
日本時間で切る。KV の書き込みは無料枠で1日1000回なので、盤面はモードごとに
1キーへまとめ、1回の投稿で最大2回（今日ぶん・通算ぶん）に収めてある。順位に
入らない投稿と、同じ名前で前より悪い投稿は書き込まない。同じ名前は1行だけ残す
ので、一人で盤を埋めることはできない。

## 確かめる

    cd worker && node test.mjs                 # 順位・タイブレーク・入力の検算
    NODE_PATH=$(npm root -g) node test/browser.mjs   # 実際に Chromium で押してみる
    NODE_PATH=$(npm root -g) node test/rank.mjs      # Worker を立てて通しで送ってみる

`test/` は Playwright を使う。ゲーム本体には要らない。

## 出す

このゲームは**自分の Pages に自分で出す**。koshinstudio.com はそれを中継して
いるだけなので、中身を直したときサイト側は触らなくていい。

    node tools/dist.mjs
    npx wrangler pages deploy dist --project-name stopwatch10 \
        --branch claude/handover-continuation-sttqb4

**`--branch` の名前に注意。** この Pages は最初の deploy で本番ブランチが
`claude/handover-continuation-sttqb4` になってしまっている（`--branch` を
付けずに出したため）。`--branch main` で出すと preview に入るだけで、
`stopwatch10.pages.dev` は変わらない。Settings → Builds & deployments の
**Production branch** を `main` に直せば、以後は `--branch main` でよい。

`dist/` は本体に二つだけ足したもの。検索の当たり先を紹介ページに寄せるための
`noindex, follow` と、見出しの絵（無いと `/favicon.ico` を探しに行って 404）。
ゲームポータルへ出すときは `dist` ではなく `index.html` を一枚そのまま渡す。

遊ぶ人が見る住所は **`koshinstudio.com/play/stopwatch10/`**。
koshin-studio の `worker/index.js` が `ROUTES.play` を見て
`stopwatch10.pages.dev` に繋いでいる。同じ住所に載せているのは、
サブドメインに分けると localStorage（自己ベスト）が別扱いになるため。

紹介ページは `koshinstudio.com/works/stopwatch10/`。文章と表紙は
koshin-studio 側にあり、表紙の元だけがこのリポジトリの `store/` にある
（`tools/images.py` が `.webp` / `.jpg` に落とす）。
