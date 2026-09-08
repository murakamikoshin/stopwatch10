/* ランキングの検算。KV を Map で代用して、Worker をそのまま叩く。
     cd worker && node test.mjs                                        */
import worker, { _internals } from "./src/index.js";

const store = new Map();
let writes = 0;
const env = {
  ALLOWED_ORIGINS: "",
  SCORES: {
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async put(key, val) { writes++; store.set(key, val); },
  },
};

const base = "https://x/";
const get = (q) => worker.fetch(new Request(base + "scores?" + q), env);
const post = (body) =>
  worker.fetch(new Request(base + "scores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), env);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra === undefined ? "" : "  -> " + JSON.stringify(extra))); }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });

console.log("入口");
{
  const r = await get("mode=nope");
  ok("知らないモードは 400", r.status === 400);
  const r2 = await get("mode=s10");
  const j2 = await r2.json();
  ok("空の盤が返る", r2.status === 200 && j2.boards.daily.avg.length === 0);
  const r3 = await worker.fetch(new Request(base + "health"), env);
  ok("/health", r3.status === 200);
  const r4 = await worker.fetch(new Request(base + "api/scores?mode=s10"), env);
  ok("/api 付きでも通る", r4.status === 200);
}

console.log("受け付けない投稿");
{
  ok("閉じているモード", (await post({ mode: "s10h", name: "a", errors: [1, 2, 3] })).status === 403);
  ok("回数が合わない", (await post({ mode: "s10", name: "a", errors: [1, 2] })).status === 400);
  ok("整数でない", (await post({ mode: "s10", name: "a", errors: [1.5, 2, 3] })).status === 400);
  ok("目標より早すぎる", (await post({ mode: "s10", name: "a", errors: [-10001, 0, 0] })).status === 400);
  ok("遅すぎる", (await post({ mode: "s10", name: "a", errors: [40001, 0, 0] })).status === 400);
  eq("書き込みは起きていない", writes, 0);
}

console.log("順位");
{
  /* C は平均が良い、D はベスト1回が良い。2本の盤で順が入れ替わるはず */
  const c = await (await post({ mode: "s10", name: "C", errors: [30, 30, 30] })).json();
  const d = await (await post({ mode: "s10", name: "D", errors: [0, 60, 60] })).json();
  eq("平均の盤に C だけ", c.boards.daily.avg.map((e) => e.n), ["C"]);
  eq("平均の盤は C が上", d.boards.daily.avg.map((e) => e.n), ["C", "D"]);
  eq("ベスト1回の盤は D が上", d.boards.daily.one.map((e) => e.n), ["D", "C"]);
  eq("自分の順位（平均）", d.you.daily.avg, 2);
  eq("自分の順位（ベスト1回）", d.you.daily.one, 1);
  eq("通算にも入る", d.boards.all.avg.map((e) => e.n), ["C", "D"]);
  eq("1回の投稿で書き込みは2回まで", writes, 4);
}

console.log("ベスト1回のタイブレーク（残り2回の誤差合計）");
{
  /* D=[0,60,60] 残り120 / E=[0,100,100] 残り200 / F=[0,50,300] 残り350。
     ベスト1回はどれも 0.000 なので、順は残りの合計だけで決まる */
  await post({ mode: "s10", name: "E", errors: [0, 100, 100] });
  const f = await (await post({ mode: "s10", name: "F", errors: [0, 50, 300] })).json();
  eq("0.000 同着は残りの合計で決まる", f.boards.daily.one.map((x) => x.n).slice(0, 3), ["D", "E", "F"]);
  eq("残りの合計もその順", f.boards.daily.one.map((x) => x.r).slice(0, 3), [120, 200, 350]);
}

console.log("同じ名前");
{
  const before = writes;
  const g1 = await (await post({ mode: "s10", name: "C", errors: [500, 500, 500] })).json();
  eq("前より悪い記録では書き込まない", writes, before);
  eq("盤の C は元のまま", g1.boards.daily.avg.filter((x) => x.n === "C")[0].a, 30);
  const g2 = await (await post({ mode: "s10", name: "C", errors: [10, 10, 10] })).json();
  eq("良くなったら差し替わる", g2.boards.daily.avg.filter((x) => x.n === "C")[0].a, 10);
  eq("同じ名前は1行だけ", g2.boards.daily.avg.filter((x) => x.n === "C").length, 1);
}

console.log("名前の掃除");
{
  const { cleanName } = _internals;
  const dirty = "a" + String.fromCharCode(1) + "b" + String.fromCharCode(0x200b) + "c";
  eq("空は ななし", cleanName(""), "ななし");
  eq("空白だけも ななし", cleanName("   "), "ななし");
  eq("制御文字とゼロ幅は落とす", cleanName(dirty), "abc");
  eq("12文字まで", cleanName("あ".repeat(20)).length, 12);
  eq("文字列でないもの", cleanName({ a: 1 }), "ななし");
}

console.log("日付は日本時間で切る");
{
  const { jstDate } = _internals;
  eq("UTC 15:00 は翌日", jstDate(Date.parse("2026-09-08T15:00:00Z")), "2026-09-09");
  eq("UTC 14:59 はまだ当日", jstDate(Date.parse("2026-09-08T14:59:59Z")), "2026-09-08");
}

console.log("");
console.log(pass + " 通過 / " + fail + " 失敗");
process.exit(fail ? 1 : 0);
