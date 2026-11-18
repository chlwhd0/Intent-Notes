// 사이드바의 "오늘의 고양이": TheCatAPI에서 사진 한 장의 주소를 받아 와요.
// API 키는 서버 보안 설정(CAT_API_KEY)에만 있고, 방문자 화면에는 내려가지 않아요. 사진 파일 자체는 방문자의 브라우저가 TheCatAPI에서 바로 받아요.
const ENDPOINT = 'https://api.thecatapi.com/v1/images/search';
const IMG_HOST = 'cdn2.thecatapi.com';

// 응답에서 사진 주소가 믿을 만한 TheCatAPI 이미지 주소일 때만 돌려줘요.
function parse(json) {
  const i = Array.isArray(json) ? json[0] : null;
  if (!i || typeof i.url !== 'string') return null;
  let u;
  try { u = new URL(i.url); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.hostname !== IMG_HOST || !/\.(jpe?g|png)$/i.test(u.pathname)) return null;
  const w = Number(i.width), h = Number(i.height);
  return { url: u.href, width: w > 0 ? Math.round(w) : null, height: h > 0 ? Math.round(h) : null };
}

async function fetchCat(key, fetchImpl = fetch) {
  const k = String(key || '').trim();
  if (!k) return { error: 'NO_KEY' };
  const q = new URLSearchParams({ limit: '1', size: 'med', mime_types: 'jpg,png' });
  try {
    const r = await fetchImpl(`${ENDPOINT}?${q.toString()}`, { signal: AbortSignal.timeout(6000), headers: { 'x-api-key': k, Accept: 'application/json' } });
    if (!r.ok) return { error: 'HTTP_' + r.status };
    const d = parse(await r.json());
    return d ? { data: d } : { error: 'BAD_RESPONSE' };
  } catch (e) {
    return { error: 'FETCH_FAIL' };
  }
}

module.exports = { fetchCat, parse };
