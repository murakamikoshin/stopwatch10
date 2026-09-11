/* 画面の検算。実際に Chromium で開いて、押して、出た数字を見る。
   Playwright が要る（遊ぶ側には要らない。確かめるためだけの道具）。

     NODE_PATH=$(npm root -g) node test/browser.mjs                    */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const url = pathToFileURL(new URL("../index.html", import.meta.url).pathname).href;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra === undefined ? "" : "  -> " + JSON.stringify(extra))); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
/* ランキングの置き場へ繋がらないのは、ここでは当たり前（外に出られない）。
   繋がらなくてもゲームは動く、というのがまさに確かめたいことなので数えない */
page.on("console", (m) => {
  if (m.type() === "error" && !/net::ERR|Failed to load resource/.test(m.text())) errs.push(m.text());
});
await page.goto(url);

const lit = () => page.$$eval("#disp g", (gs) => gs.map((g) => g.querySelectorAll(".seg.on").length));
const text = (sel) => page.$eval(sel, (el) => el.textContent.trim());
const rounds = () => page.$$eval("#rounds b", (bs) => bs.map((b) => b.textContent.trim()));
const play = async (hold) => {           // 1回ぶん押して、出るまで待つ
  await page.click("#key");
  await sleep(hold);
  await page.click("#key");
  await sleep(1400);                     // 1桁ずつ点く演出が終わるまで
};

console.log("最初の姿");
{
  eq("モードは3つ", await page.$$eval("#modes button", (b) => b.length), 3);
  eq("桁は 2 + 3", await page.$$eval("#disp g", (g) => g.length), 5);
  eq("回数の欄は3つ", (await rounds()).length, 3);
  eq("消灯している", (await lit()).reduce((a, b) => a + b, 0), 0);
  ok("置き場に繋がらないうちはランキングを出さない", await page.$eval("#rank", (el) => el.hidden));
}

console.log("10秒ノーヒント");
{
  await page.click("#key");
  eq("押すとストップになる", await text("#key"), "ストップ");
  await sleep(600);
  eq("計測中はなにも点かない", (await lit()).reduce((a, b) => a + b, 0), 0);
  await page.click("#key");
  await sleep(1400);
  const r = await rounds();
  ok("1回目に誤差が入る", /^[+\-±]\d+\.\d{3}$/.test(r[0]), r);
  eq("2回目はまだ", r[1], "—");
  eq("ランプが1つ", await page.$$eval("#lampset .lamp.on", (l) => l.length), 1);
  eq("次へ進める", await text("#key"), "つぎへ");
}

console.log("3回そろえる");
{
  await page.click("#key");            // つぎへ
  await play(300);
  await page.click("#key");
  await play(300);
  eq("おわり", await text("#roundLabel"), "おわり");
  ok("1回あたりが出る", /^\d+\.\d{3}秒$/.test(await text("#avg")), await text("#avg"));
  ok("ベスト1回が出る", /^\d+\.\d{3}秒$/.test(await text("#one")));
  ok("自己ベスト（平均）が入る", (await text("#bestAvg")) !== "—");
  ok("共有ボタンが出る", !(await page.$eval("#share", (el) => el.hidden)));
  const avg = parseFloat(await text("#avg"));
  const rs = (await rounds()).map((s) => Math.abs(parseFloat(s)));
  ok("平均は3回の平均になっている", Math.abs(avg - (rs[0] + rs[1] + rs[2]) / 3) < 0.002, { avg, rs });
  const one = parseFloat(await text("#one"));
  eq("ベスト1回は一番小さい誤差", one, Math.min.apply(null, rs));
}

console.log("100秒モード");
{
  await page.click("#modes button:nth-child(3)");
  eq("桁が 3 + 3 になる", await page.$$eval("#disp g", (g) => g.length), 6);
  eq("回数の欄は消える", await page.$eval("#rounds", (el) => el.hidden), true);
  eq("ランプは1つだけ", await page.$$eval("#lampset .lamp", (l) => l.length), 1);
  eq("一発勝負", await text("#roundLabel"), "一発勝負");
  eq("ベスト1回の行は隠れる", await page.$eval("#oneLabel", (el) => el.hidden), true);
}

console.log("ヒントあり（最初の3秒だけ時計が出る）");
{
  await page.click("#modes button:nth-child(2)");
  await page.click("#key");
  await sleep(500);
  ok("ヒント中は点いている", (await lit()).reduce((a, b) => a + b, 0) > 0);
  await sleep(2800);                   // 3秒を越えたところ
  eq("3秒で完全に消える", (await lit()).reduce((a, b) => a + b, 0), 0);
  eq("読み上げも切り替わる", await text("#readout"), "ここから自力");
  await sleep(700);
  eq("消えたまま", (await lit()).reduce((a, b) => a + b, 0), 0);
  await page.click("#key");
  await sleep(1400);
  const r = await rounds();
  ok("止めれば記録は出る", /^[+\-±]\d+\.\d{3}$/.test(r[0]), r);
}

console.log("画面を離れたら無効");
{
  await page.click("#key");            // つぎへ
  await page.click("#key");            // 計測開始
  await sleep(300);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  eq("無効になる", await text("#roundLabel"), "無効");
  ok("断りが出る", (await text("#readout")).indexOf("無効") !== -1, await text("#readout"));
  eq("記録は消える", await rounds(), ["—", "—", "—"]);
  eq("押し直せる", await text("#key"), "はじめから");
}

console.log("記録の持ち越し");
{
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("pittari10.best", "300");   // 旧版の「3回の誤差合計」
    localStorage.setItem("stopwatch10.mode", "s10");
  });
  await page.reload();
  eq("旧版の合計は平均に読み替わる", await text("#bestAvg"), "0.100秒");
}

console.log("");
ok("エラーは出ていない", errs.length === 0, errs);
console.log(pass + " 通過 / " + fail + " 失敗");
await browser.close();
process.exit(fail ? 1 : 0);
