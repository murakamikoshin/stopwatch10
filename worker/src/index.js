/* ============================================================
   10秒ピッタリで止めろ！ — ランキング

   Cloudflare Workers + KV。無料枠で足りる。
   クライアント申告なので不正は防げない。デイリーを主にして流す前提。

   置き方
     ・KV を一つ作って SCORES として結びつける
     ・wrangler deploy
     ・出た URL を index.html の <meta name="stopwatch10-api"> に入れる

   API
     GET  /scores?mode=s10&limit=20
          → { ok, mode, date, boards:{ daily:{avg,one}, all:{avg,one} } }
     POST /scores  { v:1, mode:"s10", name:"...", errors:[ms,...] }
          → 上と同じ形 + { you:{ daily:{avg,one}, all:{avg,one} } }（順位。圏外は null）

   KV の書き込みは無料枠で 1日1000回。1回の投稿で最大2回（今日ぶんと通算ぶん）に
   収まるよう、盤面はモードごとに1つのキーへまとめてある。順位に入らなかった投稿と、
   同じ名前で前より悪い投稿は、そもそも書かない。
   ============================================================ */

const MODES = {
  s10:  { rounds: 3, target: 10000,  open: true  },  // 公開中はこれだけ。増やすと盤が薄まる
  s10h: { rounds: 3, target: 10000,  open: false },
  s100: { rounds: 1, target: 100000, open: false },
};

const CAP = 100;                      // 盤に残す人数
const DEFAULT_LIMIT = 20;
const DAILY_TTL = 60 * 60 * 24 * 3;   // 今日ぶんは3日で消す
const MAX_BODY = 2048;

/* 日付は日本時間で切る。0時をまたいだら今日ぶんは流れる */
const jstDate = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);

const dailyKey = (mode, date) => `b:${mode}:d:${date}`;
const allKey = (mode) => `b:${mode}:all`;

/* 平均の盤: 平均が小さい順。同じならベスト1回、それも同じなら早い者勝ち */
const byAvg = (x, y) => (x.a - y.a) || (x.b - y.b) || (x.t - y.t);

/* ベスト1回の盤: 一番いい1回が小さい順。
   0.000 の同着は 1/1000 × 3回 ≒ 1/333 で詰まるので、
   タイブレークは「残り2回の誤差合計」。それも同じなら早い者勝ち。 */
const byOne = (x, y) => (x.b - y.b) || (x.r - y.r) || (x.t - y.t);

const CMP = { avg: byAvg, one: byOne };

const emptyBoards = () => ({ avg: [], one: [] });

async function readBoards(env, key) {
  const raw = await env.SCORES.get(key, { type: "json", cacheTtl: 30 });
  if (!raw || typeof raw !== "object") return emptyBoards();
  return {
    avg: Array.isArray(raw.avg) ? raw.avg : [],
    one: Array.isArray(raw.one) ? raw.one : [],
  };
}

/* 同じ名前は1つだけ残す。一人で盤を埋められないように */
function place(list, entry, cmp) {
  const prev = list.find((e) => e.k === entry.k);
  if (prev && cmp(prev, entry) <= 0) {
    return { list, rank: list.indexOf(prev) + 1, changed: false };
  }
  const next = list.filter((e) => e.k !== entry.k);
  next.push(entry);
  next.sort(cmp);
  const trimmed = next.slice(0, CAP);
  const at = trimmed.indexOf(entry);
  return { list: trimmed, rank: at < 0 ? null : at + 1, changed: true };
}

const strip = (list, limit) => list.slice(0, limit).map((e) => ({ n: e.n, a: e.a, b: e.b, r: e.r }));

const shape = (boards, limit) => ({
  avg: strip(boards.avg, limit),
  one: strip(boards.one, limit),
});

function cleanName(v) {
  let s = typeof v === "string" ? v : "";
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 12) s = s.slice(0, 12);
  return s || "ななし";
}

const cors = (env, req) => {
  const list = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") || "";
  const allow = list.length === 0 ? "*" : (list.indexOf(origin) !== -1 ? origin : list[0]);
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    ...(list.length ? { vary: "origin" } : {}),
  };
};

const json = (body, init, env, req) =>
  new Response(JSON.stringify(body), {
    status: (init && init.status) || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...cors(env, req),
      ...((init && init.headers) || {}),
    },
  });

const bad = (msg, env, req, status = 400) => json({ ok: false, error: msg }, { status }, env, req);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, req) });
    if (path === "/health") return json({ ok: true, date: jstDate() }, null, env, req);
    if (path !== "/scores") return bad("not found", env, req, 404);
    if (!env.SCORES) return bad("kv not bound", env, req, 500);

    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit"), 10) || DEFAULT_LIMIT, 1), CAP);

    /* ---- 見る ---- */
    if (req.method === "GET") {
      const mode = url.searchParams.get("mode") || "";
      if (!MODES[mode]) return bad("unknown mode", env, req);
      const date = jstDate();
      const [daily, all] = await Promise.all([
        readBoards(env, dailyKey(mode, date)),
        readBoards(env, allKey(mode)),
      ]);
      return json(
        { ok: true, mode, date, open: MODES[mode].open,
          boards: { daily: shape(daily, limit), all: shape(all, limit) } },
        { headers: { "cache-control": "public, max-age=20" } }, env, req
      );
    }

    if (req.method !== "POST") return bad("method not allowed", env, req, 405);

    /* ---- のせる ---- */
    const text = await req.text();
    if (text.length > MAX_BODY) return bad("too large", env, req, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return bad("bad json", env, req); }
    if (!body || typeof body !== "object") return bad("bad body", env, req);

    const mode = String(body.mode || "");
    const spec = MODES[mode];
    if (!spec) return bad("unknown mode", env, req);
    if (!spec.open) return bad("mode closed", env, req, 403);

    const errors = body.errors;
    if (!Array.isArray(errors) || errors.length !== spec.rounds) return bad("bad errors", env, req);
    let sum = 0, best = Infinity;
    for (const raw of errors) {
      const e = Number(raw);
      if (!isFinite(e) || Math.floor(e) !== e) return bad("bad errors", env, req);
      if (e < -spec.target || e > spec.target * 4) return bad("out of range", env, req);
      const abs = Math.abs(e);
      sum += abs;
      if (abs < best) best = abs;
    }

    const now = Date.now();
    const name = cleanName(body.name);
    const entry = {
      n: name,
      k: name.toLowerCase(),
      a: Math.round((sum / spec.rounds) * 1000) / 1000,   // 1回あたりの誤差(ms)
      b: best,                                            // ベスト1回(ms)
      r: sum - best,                                      // タイブレーク用: 残りの合計(ms)
      t: now,
    };

    const date = jstDate(now);
    const keys = { daily: dailyKey(mode, date), all: allKey(mode) };
    const you = {};
    const out = {};

    for (const span of ["daily", "all"]) {
      const boards = await readBoards(env, keys[span]);
      let changed = false;
      const ranks = {};
      for (const board of ["avg", "one"]) {
        const res = place(boards[board], entry, CMP[board]);
        boards[board] = res.list;
        ranks[board] = res.rank;
        if (res.changed) changed = true;
      }
      if (changed) {
        await env.SCORES.put(keys[span], JSON.stringify(boards),
          span === "daily" ? { expirationTtl: DAILY_TTL } : undefined);
      }
      you[span] = ranks;
      out[span] = shape(boards, limit);
    }

    return json({ ok: true, mode, date, open: true, boards: out, you }, null, env, req);
  },
};

/* テスト用（worker/test.mjs から使う）。本番の動きには関わらない */
export const _internals = { place, byAvg, byOne, cleanName, jstDate, MODES, CAP };
