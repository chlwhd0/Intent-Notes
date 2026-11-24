// 서버 함수: 방문할 때마다 파이어베이스의 최신 공개 글로 페이지를 만들어 돌려줘요.
// 글을 쓰고 고치고 지우거나 메뉴를 바꾸면 배포 없이 바로 사이트에 반영돼요.
// 페이지 만드는 코드는 site/build.js예요(루트의 build.js를 `node build.js --ssr`로 복사한 것).
// 공개 글(visibility == public)만 읽어요. 나만 보기 글과 나만 보기 메뉴 이름은 가져오지 않아요.
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { generate } = require('./site/build.js');
const { fetchWeather } = require('./weather.js');
const { fetchCat } = require('./cat.js');
const ai = require('./ai.js');

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
        files: Array.isArray(x.files) ? x.files.map((f) => ({ name: str(f && f.name), url: str(f && f.url), size: Number(f && f.size) || 0, summary: str(f && f.summary), ai: !!(f && f.ai === true) })) : [],
        aiSummary: Array.isArray(x.aiSummary) ? x.aiSummary.map(str).filter(Boolean).slice(0, 3) : [], aiSummaryOn: x.aiSummaryOn === true, aiSummaryFor: str(x.aiSummaryFor),
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

// 서울 실시간 날씨. 사이드바 하단이 /api/weather 로 불러가요. (호스팅이 이 주소를 이 함수로 연결해요)
// 결과는 10분 동안 같이 쓰고, 기상청이 잠깐 안 될 때는 3시간 안의 직전 값을 대신 보여 줘요.
const kmaKey = defineSecret('KMA_SERVICE_KEY');
const WX_FRESH_MS = 10 * 60 * 1000;
const WX_STALE_MS = 3 * 60 * 60 * 1000;
let wx = { at: 0, data: null, promise: null };
exports.weather = onRequest({ region: 'asia-northeast3', memory: '256MiB', timeoutSeconds: 20, maxInstances: 3, secrets: [kmaKey] }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).send('Method Not Allowed'); return; }
  const now = Date.now();
  if (!(wx.data && now - wx.at < WX_FRESH_MS)) {
    if (!wx.promise) {
      wx.promise = fetchWeather(kmaKey.value(), now)
        .then((r) => { if (r.data) wx = { at: Date.now(), data: r.data, promise: null }; else wx.promise = null; return r; })
        .catch(() => { wx.promise = null; return { error: 'FETCH_FAIL' }; });
    }
    const r = await wx.promise;
    if (r && r.error && !(wx.data && now - wx.at < WX_STALE_MS)) {
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ error: 'unavailable' });
      return;
    }
  }
  res.set('Cache-Control', 'public, max-age=600, s-maxage=600');
  res.json(wx.data);
});

// 오늘의 고양이. 사이드바가 /api/cat 으로 불러가요. 사진 주소는 1시간 동안 같이 쓰고, 실패하면 3시간 안의 직전 사진을 대신 보여 줘요.
const catKey = defineSecret('CAT_API_KEY');
const CAT_FRESH_MS = 60 * 60 * 1000;
const CAT_STALE_MS = 3 * 60 * 60 * 1000;
let cat = { at: 0, data: null, promise: null };
exports.cat = onRequest({ region: 'asia-northeast3', memory: '256MiB', timeoutSeconds: 20, maxInstances: 3, secrets: [catKey] }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).send('Method Not Allowed'); return; }
  const now = Date.now();
  if (!(cat.data && now - cat.at < CAT_FRESH_MS)) {
    if (!cat.promise) {
      cat.promise = fetchCat(catKey.value())
        .then((r) => { if (r.data) cat = { at: Date.now(), data: r.data, promise: null }; else cat.promise = null; return r; })
        .catch(() => { cat.promise = null; return { error: 'FETCH_FAIL' }; });
    }
    const r = await cat.promise;
    if (r && r.error && !(cat.data && now - cat.at < CAT_STALE_MS)) {
      res.set('Cache-Control', 'no-store');
      res.status(503).json({ error: 'unavailable' });
      return;
    }
  }
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.json(cat.data);
});

// AI 도우미. 관리자 화면(글쓰기 보조, 발행 전 점검, 첨부 요약, 3줄 요약, 회고 정리)이 /api/ai 로 불러가요.
// 관리자 로그인(ID 토큰의 admin 표시)이 있어야 하고, 한 달에 부를 수 있는 횟수를 넘으면 멈춰요.
// 키가 없거나 AI 서비스가 안 될 때는 오류 코드만 돌려줘요. (글쓰기·저장은 AI 없이도 그대로 돼요)
const aiKey = defineSecret('AI_API_KEY');
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';
const AI_LIMIT = Number(process.env.AI_MONTHLY_LIMIT) || 300;
const ymKey = () => { const d = new Date(Date.now() + 9 * 3600 * 1000); return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0'); };

async function adminOf(req) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m) return null;
  try { const t = await getAuth().verifyIdToken(m[1]); return t.admin === true ? t : null; } catch (e) { return null; }
}
// 호출 횟수를 하나 올려요. 한도를 넘었으면 false.
async function takeAiCall(ref) {
  return db.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    const n = d.exists ? Number(d.data().count) || 0 : 0;
    if (n >= AI_LIMIT) return false;
    tx.set(ref, { count: n + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

exports.ai = onRequest({ region: 'asia-northeast3', memory: '256MiB', timeoutSeconds: 60, maxInstances: 3, secrets: [aiKey] }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD' }); return; }
  if (!(await adminOf(req))) { res.status(403).json({ error: 'FORBIDDEN' }); return; }
  const { action, input } = req.body || {};
  const ref = db.doc('aiUsage/' + ymKey());
  if (action === 'usage') {
    const d = await ref.get();
    res.json({ result: { count: d.exists ? Number(d.data().count) || 0 : 0, limit: AI_LIMIT, month: ymKey(), model: AI_MODEL } });
    return;
  }
  if (!ai.ACTIONS[action]) { res.status(400).json({ error: 'BAD_ACTION' }); return; }
  if (!ai.ACTIONS[action].need(input || {})) { res.status(400).json({ error: 'TOO_SHORT' }); return; }
  let key = '';
  try { key = aiKey.value(); } catch (e) { key = ''; }
  if (!key) { res.status(503).json({ error: 'NO_KEY' }); return; }
  if (!(await takeAiCall(ref))) { res.status(429).json({ error: 'LIMIT', limit: AI_LIMIT }); return; }
  try {
    res.json({ result: await ai.run(action, input, { key, model: AI_MODEL }) });
  } catch (e) {
    console.error('AI 호출 실패', action, e && e.message);
    res.status(502).json({ error: 'UPSTREAM', detail: String((e && e.message) || '').slice(0, 40) }); // detail은 오류 코드(예: UPSTREAM_404)만이라 키·글 내용이 들어가지 않아요
  }
});
