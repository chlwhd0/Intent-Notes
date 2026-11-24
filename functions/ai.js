// AI 기능의 두뇌: 글 내용을 받아 Anthropic(Claude) API에 물어보고, 정해진 모양의 결과로 돌려줘요.
// 서버 함수(index.js의 ai)가 이 파일을 쓰고, 테스트에서는 가짜 fetch를 넣어 돌려 봐요.
// 지키는 것: 방문자 이름·이메일·댓글은 보내지 않아요(받는 입력은 글 본문, PDF 글자, 회고 글뿐이에요).
const API = 'https://api.anthropic.com/v1/messages';
const MAX_IN = 30000; // 한 번에 보내는 글자 수 상한(비용과 속도를 위해)

const SYSTEM =
  '당신은 개인 블로그 운영자를 돕는 한국어 편집 도우미예요. 반드시 요청한 JSON 한 개만 출력하세요. 설명 문장, 마크다운 코드 블록은 쓰지 마세요. ' +
  '글에 없는 사실을 지어내지 마세요. 말투는 글의 말투(해요체/합니다체)를 따르세요.';

const clip = (s) => String(s || '').slice(0, MAX_IN);
const arr = (v) => (Array.isArray(v) ? v : []);
const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// 각 기능: prompt(입력)을 만들고, parse(모델이 낸 JSON)로 안전한 결과로 다듬어요.
const ACTIONS = {
  suggest: {
    need: (i) => clip(i.body).length >= 30,
    prompt: (i) =>
      `다음 블로그 글을 읽고 JSON으로만 답하세요.\n{"summary":"글 목록에 보일 한 줄 요약(80자 이내)","description":"검색 결과에 보일 설명(120자 이내, 요약과 다른 표현)","titles":["제목 후보 3개(40자 이내, 서로 다른 관점)"]}\n\n[글]\n${clip(i.body)}`,
    parse: (j) => ({ summary: s(j.summary, 300), description: s(j.description, 300), titles: arr(j.titles).map((t) => s(t, 120)).filter(Boolean).slice(0, 3) }),
  },
  check: {
    need: (i) => clip(i.body).length >= 30,
    prompt: (i) =>
      `다음은 공개하려는 블로그 글이에요. 아래 두 가지만 찾아 JSON으로 답하세요.\n- name: 실제 사람 이름으로 보이는 표현(글에 나온 그대로 인용)\n- internal: 회사 내부 자료로 보이는 표현(예: 내부 지표, 비공개 문서 이름, 미공개 계획)\n찾은 문장은 글에 있는 그대로 짧게(40자 이내) text에 넣고, why에 이유를 한 문장으로 적으세요. 없으면 빈 배열이에요. 확실하지 않으면 넣지 마세요.\n{"items":[{"kind":"name|internal","text":"...","why":"..."}]}\n\n[글]\n${clip(i.body)}`,
    parse: (j) => ({ items: arr(j.items).filter((x) => x && (x.kind === 'name' || x.kind === 'internal')).map((x) => ({ kind: x.kind, text: s(x.text, 80), why: s(x.why, 200) })).filter((x) => x.text).slice(0, 20) }),
  },
  files: {
    need: (i) => clip(i.text).length >= 30,
    prompt: (i) => `다음은 블로그에 첨부할 문서에서 뽑은 글자예요. 방문자가 내려받기 전에 볼 요약을 JSON으로 답하세요.\n{"summary":"문서가 무엇이고 무엇을 알 수 있는지 2~3문장(200자 이내)"}\n\n[문서]\n${clip(i.text)}`,
    parse: (j) => ({ summary: s(j.summary, 300) }),
  },
  tldr: {
    need: (i) => clip(i.body).length >= 100,
    prompt: (i) => `다음 블로그 글의 핵심을 정확히 3줄로 요약해 JSON으로 답하세요. 각 줄은 60자 이내의 완결된 한 문장이에요.\n{"lines":["...","...","..."]}\n\n[글]\n${clip(i.body)}`,
    parse: (j) => ({ lines: arr(j.lines).map((t) => s(t, 120)).filter(Boolean).slice(0, 3) }),
  },
  themes: {
    need: (i) => arr(i.texts).reduce((n, t) => n + String((t && t.body) || '').length, 0) >= 30,
    prompt: (i) => `다음은 한 사람이 쓴 회고 글들이에요(나만 보기). 반복해서 나오는 주제 3~5개를 JSON으로 답하세요. 각 주제는 이름(20자 이내)과 근거가 된 글의 제목(titles)이에요.\n{"themes":[{"name":"...","titles":["..."]}]}\n\n${arr(i.texts).map((t, n) => `[글 ${n + 1}] ${s(t && t.title, 80)}\n${clip(t && t.body).slice(0, 6000)}`).join('\n\n').slice(0, MAX_IN)}`,
    parse: (j) => ({ themes: arr(j.themes).map((t) => ({ name: s(t && t.name, 40), titles: arr(t && t.titles).map((x) => s(x, 120)).filter(Boolean).slice(0, 10) })).filter((t) => t.name).slice(0, 5) }),
  },
  retro: {
    need: (i) => arr(i.themes).length > 0,
    prompt: (i) => `다음 주제들로, 한 사람이 자신의 회고를 되돌아보는 글 초안을 마크다운으로 쓰세요. 주제마다 소제목(##) 하나와 2~3문장을 쓰고, 마지막에 "다음에 해 볼 것" 한 줄을 붙이세요. 글에 없는 사실은 지어내지 마세요.${i.noQuote === false ? '' : ' 참고 회고의 문장을 그대로 옮기지 말고 새 표현으로 쓰세요.'} 설명이나 코드 블록 없이 초안 마크다운만 출력하세요.\n\n[주제]\n${JSON.stringify(arr(i.themes)).slice(0, 6000)}\n\n[참고 회고]\n${arr(i.texts).map((t) => s(t && t.body, 3000)).join('\n---\n').slice(0, 20000)}`,
    raw: true, // JSON이 아니라 글 그대로 받아요(줄바꿈이 많은 긴 글이라 JSON이 깨지기 쉬워요)
    max: 3000,
    parse: (t) => {
      let x = String(t).trim();
      // 시스템 지침 때문에 모델이 {"키":"글"} 모양으로 감싸 보내기도 해요. 그러면 안의 글만 꺼내요.
      if (x.startsWith('{')) { try { const v = Object.values(JSON.parse(x)).find((y) => typeof y === 'string'); if (v) x = v; } catch (e) { const m = /"\s*:\s*"([\s\S]*)"\s*}?\s*$/.exec(x); if (m) x = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); } }
      return { draft: s(x.replace(/^```(?:markdown|md)?\s*|\s*```$/g, ''), 8000) };
    },
  },
};

// 모델이 낸 글에서 JSON 한 덩어리를 꺼내요. (앞뒤에 말이 붙어도 괜찮게)
function extractJson(t) {
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('BAD_JSON');
  return JSON.parse(t.slice(a, b + 1));
}

// run(action, input, {key, model, fetch}) → 결과 객체. 실패하면 Error(code)를 던져요.
async function run(action, input, deps) {
  const def = ACTIONS[action];
  if (!def) throw new Error('BAD_ACTION');
  if (!def.need(input || {})) throw new Error('TOO_SHORT');
  if (!deps.key) throw new Error('NO_KEY');
  const f = deps.fetch || fetch;
  const res = await f(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': deps.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: deps.model, max_tokens: def.max || 1500, system: SYSTEM, messages: [{ role: 'user', content: def.prompt(input) }] }),
  });
  if (!res.ok) throw new Error('UPSTREAM_' + res.status);
  const data = await res.json();
  const text = arr(data.content).map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('');
  return def.parse(def.raw ? text : extractJson(text));
}

module.exports = { run, ACTIONS, extractJson };
