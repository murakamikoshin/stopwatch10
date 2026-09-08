/* ランキングの結線を通しで確かめる。
   worker/src/index.js をそのまま node で走らせ（KV は Map で代用）、
   同じ出どころから index.html を配って、Chromium で遊んで送る。

     NODE_PATH=$(npm root -g) node test/rank.mjs                       */
import http from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import worker from "../worker/src/index.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
  .replace('<meta name="stopwatch10-api" content="">', '<meta name="stopwatch10-api" content="/api">');

const store = new Map();
const env = {
  ALLOWED_ORIGINS: "",
  SCORES: {
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts && opts.type === "json" ? JSON.parse(v) : v;
    },
    async put(key, val) { store.set(key, val); },
  },
};

const server = http.createServer(async (req, res) => {
  if (req.url === "/" || req.url.startsWith("/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = new Request("http://127.0.0.1" + req.url, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const out = await worker.fetch(r, env);
  const h = {};
  out.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(out.status, h);
  res.end(Buffer.from(await out.arrayBuffer()));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port + "/";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra === undefined ? "" : "  -> " + JSON.stringify(extra))); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const errs = [];

async function playSet(page, holds) {
  for (let i = 0; i < holds.length; i++) {
    if (i > 0) await page.click("#key");     // つぎへ
    await page.click("#key");
    await sleep(holds[i]);
    await page.click("#key");
    await sleep(1400);
  }
}

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(origin);

console.log("盤が出る");
{
  await page.waitForSelector("#rank:not([hidden])");
  ok("ランキングの枠が出る", true);
  await page.waitForFunction(() => document.querySelector("#rankList").children.length > 0);
  eq("最初は空の断り", await page.$eval("#rankList li", (li) => li.textContent), "今日はまだ誰もいません");
  ok("遊ぶ前は送信欄なし", await page.$eval("#rankForm", (el) => el.hidden));
}

console.log("遊んで送る");
{
  await playSet(page, [200, 400, 600]);
  await page.waitForSelector("#rankForm:not([hidden])");
  ok("終わると送信欄が出る", true);
  await page.fill("#nameInput", "こうしん");
  await page.click("#rankSend");
  await page.waitForFunction(() => /位|のせました/.test(document.querySelector("#rankNote").textContent));
  const names = await page.$$eval("#rankList .nm", (n) => n.map((x) => x.textContent));
  eq("盤に載る", names, ["こうしん"]);
  eq("自分の行が目印つき", await page.$$eval("#rankList li.me", (l) => l.length), 1);
  ok("送信欄は引っ込む", await page.$eval("#rankForm", (el) => el.hidden));
  const val = await page.$eval("#rankList .va", (el) => el.textContent);
  eq("盤の値は自分の平均と同じ", val, await page.$eval("#avg", (el) => el.textContent));
}

console.log("盤の切り替え");
{
  await page.click('#rankTabs button[data-board="one"]');
  const va = await page.$eval("#rankList .va", (el) => el.textContent);
  eq("ベスト1回の盤は自分のベスト1回", va, await page.$eval("#one", (el) => el.textContent));
  ok("残りの合計も出る", (await page.$eval("#rankList .sub", (el) => el.textContent)).indexOf("残り") === 0);
  await page.click('#rankTabs button[data-span="all"]');
  eq("通算にも載っている", await page.$$eval("#rankList .nm", (n) => n.map((x) => x.textContent)), ["こうしん"]);
}

console.log("もう一人");
{
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p2.on("pageerror", (e) => errs.push(String(e)));
  await p2.goto(origin);
  await playSet(p2, [9800, 9900, 10050]);        // 10秒に近い＝強い
  await p2.waitForSelector("#rankForm:not([hidden])");
  await p2.fill("#nameInput", "うまいひと");
  await p2.click("#rankSend");
  await p2.waitForFunction(() => /位|のせました/.test(document.querySelector("#rankNote").textContent));
  const names = await p2.$$eval("#rankList .nm", (n) => n.map((x) => x.textContent));
  eq("うまいほうが上", names, ["うまいひと", "こうしん"]);
  eq("順位の断り", await p2.$eval("#rankNote", (el) => el.textContent), "今日の1回あたりで 1 位");
  await p2.close();
}

console.log("ヒントありのモードにはまだ盤を出さない");
{
  await page.click("#modes button:nth-child(2)");
  await sleep(200);
  ok("枠ごと隠れる", await page.$eval("#rank", (el) => el.hidden));
}

console.log("");
ok("エラーは出ていない", errs.length === 0, errs);
console.log(pass + " 通過 / " + fail + " 失敗");
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
