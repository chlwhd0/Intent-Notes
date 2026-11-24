// 관리자 글쓰기 화면의 AI 도우미 부품. admin-app.js가 가져다 써요.
// 여기에는 화면 조각(HTML)과 도움 함수만 있고, 상태와 버튼 동작은 admin-app.js에 있어요.
import './check.js';

export const IC = self.IntentCheck;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 서버 함수가 돌려주는 오류 코드를 쉬운 말로 바꿔요.
const ERR = {
  NO_KEY: 'AI 키가 아직 등록되지 않았어요. 키를 등록하기 전에도 글쓰기와 저장은 그대로 돼요.',
  LIMIT: '이번 달 AI 호출 한도에 도달했어요. 다음 달에 다시 쓸 수 있어요. 글쓰기와 저장은 그대로 돼요.',
  TOO_SHORT: '본문이 너무 짧아요. 조금 더 쓴 뒤에 눌러 주세요.',
  FORBIDDEN: 'AI는 관리자로 로그인해야 쓸 수 있어요.',
};
export const aiErr = (code) => ERR[code] || 'AI가 지금 답하지 못했어요. 잠시 뒤에 다시 눌러 주세요. 글쓰기와 저장은 그대로 돼요.';

// 첨부 파일에서 요약에 쓸 글자를 뽑아요. 글자를 읽을 수 없으면 빈 문자열이에요.
// 텍스트 파일은 바로 읽고, PDF는 pdf.js(cdnjs)를 처음 필요할 때만 불러와서 앞 10쪽까지 읽어요.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let pdfLoad = null;
function loadPdfJs() {
  if (self.pdfjsLib) return Promise.resolve(self.pdfjsLib);
  if (!pdfLoad) {
    pdfLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js'; s.onload = () => { self.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(self.pdfjsLib); };
      s.onerror = () => { pdfLoad = null; reject(new Error('pdf')); };
      document.head.appendChild(s);
    });
  }
  return pdfLoad;
}
export async function extractText(file, ext) {
  try {
    if (['txt', 'md', 'csv'].includes(ext)) return (await file.text()).slice(0, 30000);
    if (ext === 'pdf') {
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      let out = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 10) && out.length < 30000; i++) {
        const c = await (await pdf.getPage(i)).getTextContent();
        out += c.items.map((x) => x.str).join(' ') + '\n';
      }
      return out.trim().slice(0, 30000);
    }
  } catch (e) { /* 읽지 못하면 요약 없이 넘어가요 */ }
  return '';
}

// 점검 목록. 점검하는 5가지 항목을 모두 보여 주고, 항목마다 통과 여부를 표시해요.
// hits는 IC.run + IC.fromAi를 합친 것, acks는 "확인했어요" 표시, aiState는 AI 점검 상태('none' 아직 안 함 | 'ok' | 'fail')예요.
const CHECKS = [
  { id: 'ph', name: '자리표시자', desc: '[이름], [샘플] 같은 빈칸 표시가 남아 있는지', ai: false },
  { id: 'tel', name: '전화번호', desc: '휴대전화 번호가 들어 있는지', ai: false },
  { id: 'ai-name', name: '실명으로 보이는 표현', desc: '실제 사람 이름이 그대로 적혀 있는지', ai: true },
  { id: 'ai-internal', name: '회사 내부 자료', desc: '대외비·내부 자료로 보이는 표현이 있는지', ai: true },
];
export function checkHtml(hits, acks, aiNote, aiState) {
  const rows = CHECKS.map((c) => {
    const mine = hits.filter((h) => h.id === c.id);
    let st, cls, body = '';
    if (c.ai && aiState !== 'ok') { st = aiState === 'fail' ? 'AI 점검 실패' : 'AI 점검 전'; cls = 'skip'; body = `<small>${aiState === 'fail' ? 'AI가 답하지 못했어요. [새로고침]으로 다시 시도해요.' : '위쪽 [새로고침]을 누르면 AI가 점검해요.'}</small>`; }
    else if (!mine.length) { st = '통과'; cls = 'pass'; }
    else {
      const bad = mine.some((h) => h.level === 'bad');
      const pend = mine.filter((h) => h.level === 'warn' && !acks[h.key]).length;
      st = bad ? '해결 필요' : pend ? '확인 필요' : '확인 완료';
      cls = bad ? 'bad' : pend ? 'warn' : 'done';
      body = mine.map((h) => `<div class="ahit"><q>${esc(h.text)}</q>${h.why ? `<span>${esc(h.why)}</span>` : ''}${h.level === 'bad' ? '' : `<label class="ackl"><input type="checkbox" data-ack="${esc(h.key)}"${acks[h.key] ? ' checked' : ''}> 확인했어요</label>`}</div>`).join('') + `<small>${esc(mine[0].fix)}</small>`;
    }
    return `<li class="ck ${cls}"><div class="ckh"><span class="ckn">${esc(c.name)}${c.ai ? ' <span class="aib">AI</span>' : ''}</span><span class="cks">${st}</span></div><div class="ckd">${esc(c.desc)}</div>${body}</li>`;
  }).join('');
  const total = CHECKS.length;
  const passed = CHECKS.filter((c) => { const m = hits.filter((h) => h.id === c.id); return (!c.ai || aiState === 'ok') && (!m.length || m.every((h) => h.level === 'warn' && acks[h.key])); }).length;
  const bad = hits.filter((h) => h.level === 'bad').length, pend = hits.filter((h) => h.level === 'warn' && !acks[h.key]).length;
  const sum = `<p class="cksum"><b>${passed}/${total} 통과</b>${bad ? ` · 해결 필요 ${bad}건` : ''}${pend ? ` · 확인 필요 ${pend}건` : ''}${!bad && !pend && passed === total ? ' · 발행할 수 있어요' : ''}</p>`;
  return `${sum}<ul class="cklist">${rows}</ul>${aiNote ? `<p class="hint">${esc(aiNote)}</p>` : ''}`;
}

// 패널 전체. s는 admin-app.js의 상태: {busy, msg, tab('sug'|'chk'|'tl'|''), sug, ...}
// 버튼 3개는 한 줄 탭이고, 누른 기능의 결과만 보여요. 이미 만든 결과는 다시 누르면 그대로 보이고, [새로고침]을 눌러야 새로 만들어요.
export function panelHtml(d, s, hitsHtml) {
  const busy = s.busy, tab = s.tab;
  const tabBtn = (t, a, label) => `<button type="button" class="aitab" data-a="${a}" aria-pressed="${tab === t}"${busy ? ' disabled' : ''}>${busy === a ? '요청 중…' : label}</button>`;
  const ref = (t) => `<button type="button" class="airef${busy ? ' spin' : ''}" data-a="airef" data-v="${t}"${busy ? ' disabled' : ''} aria-label="새로고침" title="새로고침"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/></svg></button>`;
  let body = '';
  if (tab === 'sug' && s.sug) {
    const row = (label, text, key) => (text ? `<div class="arow"><b>${label}</b><span>${esc(text)}</span><button type="button" class="btn sm pri" data-a="aiapply" data-v="${key}">적용</button></div>` : '');
    body = `<div class="abox" id="asug"><div class="ahead"><span class="hint">AI 제안이에요. 마음에 드는 것만 적용하세요.</span>${ref('sug')}</div>${(s.sug.titles || []).map((t, i) => row('제목 후보 ' + (i + 1), t, 't' + i)).join('')}${row('한 줄 요약', s.sug.summary, 'summary')}${row('검색용 설명', s.sug.description, 'description')}<button type="button" class="btn sm" data-a="aiignore">모두 무시</button></div>`;
  } else if (tab === 'chk') {
    body = `<div class="abox" id="achk"><div class="ahead"><span class="hint">점검 5가지의 통과 여부예요. 해결 필요가 있으면 공개 글로 저장할 수 없고, 확인 필요는 “확인했어요”를 눌러야 해요.</span>${ref('chk')}</div>${hitsHtml}</div>`;
  } else if (tab === 'tl' && d.ai.lines.length) {
    const lines = d.ai.lines;
    body = `<div class="abox" id="atl"><div class="ahead"><span class="hint">AI가 만든 3줄 요약이에요. 고쳐 쓸 수 있고, 아래를 체크해야 공개 글에 보여요.</span>${ref('tl')}</div>${lines.map((t, i) => `<label class="sr" for="ail${i}">요약 ${i + 1}줄</label><input id="ail${i}" class="ail" type="text" maxlength="120" value="${esc(t)}">`).join('')}<label class="ackl"><input type="checkbox" id="aion"${d.ai.on ? ' checked' : ''}> 내가 확인했어요. 공개 글에 “AI가 정리한 3줄 요약”으로 보여 주세요.</label><span class="hint">본문을 고치면 승인이 풀려서 요약이 숨겨져요. 새로고침하면 고친 내용과 승인이 사라져요.</span></div>`;
  }
  return `<section class="aip" id="aip" aria-labelledby="aiph"><h2 id="aiph">AI 도우미 <span class="aib">AI</span></h2>` +
    `<p class="hint">AI는 제안만 해요. 눌러서 적용하기 전에는 글이 바뀌지 않아요. 보내는 내용은 본문(첨부 요약은 문서 글자)뿐이고, 방문자 이름·이메일·댓글은 보내지 않아요.</p>` +
    `<div class="aibtns">${tabBtn('sug', 'aisug', '글쓰기 보조')}${tabBtn('tl', 'aitl', '3줄 요약')}${tabBtn('chk', 'aichk', '발행 전 점검')}</div>` +
    `<p class="hint" id="aimsg" role="status">${esc(s.msg || '')}</p>${body}</section>`;
}
