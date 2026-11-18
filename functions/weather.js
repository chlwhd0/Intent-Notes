// 서울 실시간 날씨: 기상청 단기예보 조회서비스의 "초단기실황"을 불러와 화면용으로 간단히 정리해요.
// 인증키는 서버 보안 설정(KMA_SERVICE_KEY)에만 있고, 방문자 화면에는 절대 내려가지 않아요.
const ENDPOINT = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';
const SEOUL = { nx: 60, ny: 127, name: '서울' }; // 기상청 격자 좌표 (서울)
const PTY = { 0: '강수 없음', 1: '비', 2: '비·눈', 3: '눈', 5: '빗방울', 6: '빗방울·눈날림', 7: '눈날림' };

const pad = (n) => String(n).padStart(2, '0');

// 한국 시간 기준 날짜(YYYYMMDD)와 시(HH). 서버는 UTC라서 9시간을 더해요.
function kst(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  return { date: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`, hour: pad(d.getUTCHours()) };
}

// 초단기실황은 정시 자료가 40분쯤 뒤에 올라와요. 그래서 40분 전 시각의 정시를 기준으로 삼아요. back은 한 시간씩 더 이전으로.
function baseTime(nowMs, back = 0) {
  const k = kst(nowMs - 40 * 60 * 1000 - back * 3600 * 1000);
  return { base_date: k.date, base_time: k.hour + '00' };
}

// 인코딩된 키(%가 들어 있음)를 붙여 넣어도 동작하게 풀어서 써요.
function normalizeKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  try { return k.includes('%') ? decodeURIComponent(k) : k; } catch (e) { return k; }
}

// 응답의 item 목록에서 화면에 쓸 값만 뽑아요. 값이 이상하면 null.
function parse(json) {
  const h = json && json.response && json.response.header;
  if (!h || h.resultCode !== '00') return { error: (h && h.resultCode) || 'BAD_RESPONSE' };
  const items = json.response.body && json.response.body.items && json.response.body.items.item;
  if (!Array.isArray(items)) return { error: 'NO_ITEMS' };
  const v = {};
  items.forEach((i) => { v[i.category] = i.obsrValue; });
  const t = parseFloat(v.T1H);
  const h2 = parseFloat(v.REH);
  if (!Number.isFinite(t) || t < -60 || t > 60) return { error: 'NO_TEMP' }; // 결측값(-999)도 걸러요
  const pty = parseInt(v.PTY, 10);
  return {
    data: {
      place: SEOUL.name,
      temp: Math.round(t * 10) / 10,
      humidity: Number.isFinite(h2) ? Math.round(h2) : null,
      precip: Object.prototype.hasOwnProperty.call(PTY, pty) ? PTY[pty] : '정보 없음',
      raining: pty > 0,
    },
  };
}

async function fetchOnce(key, nowMs, back, fetchImpl) {
  const b = baseTime(nowMs, back);
  const q = new URLSearchParams({
    serviceKey: normalizeKey(key), pageNo: '1', numOfRows: '10', dataType: 'JSON',
    base_date: b.base_date, base_time: b.base_time, nx: String(SEOUL.nx), ny: String(SEOUL.ny),
  });
  const r = await fetchImpl(`${ENDPOINT}?${q.toString()}`, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
  if (!r.ok) return { error: 'HTTP_' + r.status };
  let json;
  try { json = await r.json(); } catch (e) { return { error: 'NOT_JSON' }; } // 인증 오류 등은 XML로 올 수 있어요
  const p = parse(json);
  if (p.data) p.data.base = `${b.base_date} ${b.base_time}`;
  return p;
}

// 최신 시각 자료가 아직 없으면 한 시간 전 자료로 한 번 더 시도해요.
async function fetchWeather(key, nowMs = Date.now(), fetchImpl = fetch) {
  let last = { error: 'NO_KEY' };
  if (!normalizeKey(key)) return last;
  for (const back of [0, 1]) {
    try { last = await fetchOnce(key, nowMs, back, fetchImpl); } catch (e) { last = { error: 'FETCH_FAIL' }; }
    if (last.data) return last;
  }
  return last;
}

module.exports = { fetchWeather, baseTime, parse, normalizeKey, SEOUL };
