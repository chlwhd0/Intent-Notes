// 서버 함수: 방문할 때마다 파이어베이스의 최신 공개 글로 페이지를 만들어 돌려줘요.
// 글을 쓰고 고치고 지우거나 메뉴를 바꾸면 배포 없이 바로 사이트에 반영돼요.
// 페이지 만드는 코드는 site/build.js예요(루트의 build.js를 `node build.js --ssr`로 복사한 것).
// 공개 글(visibility == public)만 읽어요. 나만 보기 글과 나만 보기 메뉴 이름은 가져오지 않아요.
const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { generate } = require('./site/build.js');

initializeApp();
const db = getFirestore();

const str = (v) => (typeof v === 'string' ? v : '');
const provider = {
  async menus() {
    const d = await db.doc('settings/menus').get();
    if (!d.exists) return null;
    const c = d.data().categories;
    return Array.isArray(c) ? c.map((x) => ({ slug: str(x && x.slug), name: str(x && x.name) })) : [];
  },
  async posts() {
    const snap = await db.collection('posts').where('visibility', '==', 'public').get();
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id, title: str(x.title), slug: str(x.slug), category: str(x.category), summary: str(x.summary), description: str(x.description),
        body: str(x.body), format: str(x.format), img: str(x.img), date: str(x.date), thumb: Number.isInteger(x.thumb) ? x.thumb : undefined,
        files: Array.isArray(x.files) ? x.files.map((f) => ({ name: str(f && f.name), url: str(f && f.url), size: Number(f && f.size) || 0 })) : [],
      };
    });
  },
};

// 몇 초 안에 몰린 요청은 한 번 만든 결과를 같이 써요. 오류가 나면 직전에 만든 결과를 대신 보여 줘요.
const FRESH_MS = 3000;
let cache = { at: 0, promise: null, last: null };
function getSite() {
  const now = Date.now();
  if (cache.promise && now - cache.at < FRESH_MS) return cache.promise;
  cache.at = now;
  cache.promise = generate(provider)
    .then((r) => { cache.last = r; return r; })
    .catch((e) => { if (cache.last) return cache.last; cache.at = 0; throw e; });
  return cache.promise;
}

const TYPES = { xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8' };

exports.site = onRequest({ region: 'asia-northeast3', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5 }, async (req, res) => {
  let rel;
  try { rel = decodeURIComponent(req.path || '/'); } catch (e) { res.status(400).send('Bad Request'); return; }
  rel = rel.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  try {
    const { pages } = await getSite();
    let status = 200;
    let body = pages.get(rel);
    if (body === undefined) { status = 404; body = pages.get('404.html'); rel = '404.html'; }
    res.set('Content-Type', TYPES[rel.split('.').pop()] || 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.status(status).send(body);
  } catch (e) {
    console.error('페이지를 만들지 못했어요', e);
    res.set('Cache-Control', 'no-store');
    res.status(500).send('잠시 뒤에 다시 열어 주세요.');
  }
});
