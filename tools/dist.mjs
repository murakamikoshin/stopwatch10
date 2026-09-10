/* 配信用の一式を dist/ に組む。

   本体（index.html）はどこへ出しても同じものだが、
   置き場所ごとに少しだけ足したいものがある。
   ここでは「Koshin Studio の一台」として出すぶんを組む。

       node tools/dist.mjs
       npx wrangler pages deploy dist --project-name stopwatch10

   出した先（stopwatch10.pages.dev）は、koshin-studio の worker が
   koshinstudio.com/play/stopwatch10/ に中継する。遊ぶ人が見る住所はそちら。

   ゲームポータルへ出すときは、dist ではなく index.html を一枚そのまま渡す。
   何も足さない。
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = ROOT + '/dist';

mkdirSync(OUT, { recursive: true });

/* 足すもの:
   ・noindex … 検索の当たり先は koshinstudio.com/works/stopwatch10/ の
                紹介ページに寄せる。実物が先に拾われると具合が悪い
   ・icon   … 無いと /favicon.ico を探しに行って 404
   言葉の切り替えも広告も持たないので、足すのはこの二つだけ。 */
const html = readFileSync(ROOT + '/index.html', 'utf8').replace(
  '<meta name="viewport"',
  '<meta name="robots" content="noindex,follow">\n'
  + '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
  + '<meta name="viewport"');

writeFileSync(OUT + '/index.html', html);
if (existsSync(ROOT + '/favicon.svg')) copyFileSync(ROOT + '/favicon.svg', OUT + '/favicon.svg');

/* 一枚しか無いので、持たせ方も一行で足りる */
writeFileSync(OUT + '/_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()

# 中身が変わっても名前は変わらないので、毎回確かめさせる
/
  Cache-Control: public, max-age=0, must-revalidate
/index.html
  Cache-Control: public, max-age=0, must-revalidate
`);

const kb = (p) => Math.round(readFileSync(p).length / 1024);
console.log(`dist/index.html  ${kb(OUT + '/index.html')} KB`);
console.log('出す: npx wrangler pages deploy dist --project-name stopwatch10');
