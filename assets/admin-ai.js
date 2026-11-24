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

// 점검 결과 목록. hits는 IC.run + IC.fromAi를 합친 것이고, acks는 "확인했어요" 표시예요.
export function checkHtml(hits, acks, aiNote) {
  if (!hits.length) return `<p class="aok">규칙으로 찾을 수 있는 문제는 없어요.${aiNote ? ' ' + esc(aiNote) : ''}</p>`;
  const rows = hits.map((h) => {
    const bad = h.level === 'bad';
    const ctl = bad ? '<span class="aitag bad">해결 필요</span>' : `<span class="aitag">확인 필요</span><label class="ackl"><input type="checkbox" data-ack="${esc(h.key)}"${acks[h.key] ? ' checked' : ''}> 확인했어요</label>`;
    return `<li class="${bad ? 'bad' : 'warn'}"><div>${ctl}${h.ai ? ' <span class="aib">AI</span>' : ''}</div><q>${esc(h.text)}</q><div>${esc(h.label)}${h.why ? ' · ' + esc(h.why) : ''}</div><small>${esc(h.fix)}</small></li>`;
  }).join('');
  return `<ul class="ahits">${rows}</ul>${aiNote ? `<p class="hint">${esc(aiNote)}</p>` : ''}`;
}

// 패널 전체. s는 admin-app.js의 상태: {busy, msg, sug, chk(null|{hits,aiNote}), showChk, pub}
export function panelHtml(d, s, hitsHtml) {
  const busy = s.busy;
  const btn = (a, label) => `<button type="button" class="btn sm" data-a="${a}"${busy ? ' disabled' : ''}>${busy === a ? '요청 중…' : label}</button>`;
  let sug = '';
  if (s.sug) {
    const row = (label, text, key, extra = '') => (text ? `<div class="arow"><b>${label}</b><span>${esc(text)}</span><button type="button" class="btn sm pri" data-a="aiapply" data-v="${key}"${extra}>적용</button></div>` : '');
    sug = `<div class="abox" id="asug"><p class="hint">AI 제안이에요. 마음에 드는 것만 적용하세요.</p>${row('한 줄 요약', s.sug.summary, 'summary')}${row('검색용 설명', s.sug.description, 'description')}${(s.sug.titles || []).map((t, i) => row('제목 후보 ' + (i + 1), t, 't' + i)).join('')}<button type="button" class="btn sm" data-a="aiignore">모두 무시</button></div>`;
  }
  const lines = d.ai.lines;
  const tl = lines.length
    ? `<div class="abox" id="atl"><p class="hint">AI가 만든 3줄 요약이에요. 고쳐 쓸 수 있고, 아래를 체크해야 공개 글에 보여요.</p>${lines.map((t, i) => `<label class="sr" for="ail${i}">요약 ${i + 1}줄</label><input id="ail${i}" class="ail" type="text" maxlength="120" value="${esc(t)}">`).join('')}<label class="ackl"><input type="checkbox" id="aion"${d.ai.on ? ' checked' : ''}> 내가 확인했어요. 공개 글에 “AI가 정리한 3줄 요약”으로 보여 주세요.</label><span class="hint">본문을 고치면 승인이 풀려서 요약이 숨겨져요.</span></div>`
    : '';
  const chk = s.showChk ? `<div class="abox" id="achk"><p class="hint">발행 전 점검 결과예요. 해결 필요가 있으면 공개 글로 저장할 수 없고, 확인 필요는 “확인했어요”를 눌러야 해요.</p>${hitsHtml}</div>` : '';
  return `<section class="aip" id="aip" aria-labelledby="aiph"><h2 id="aiph">AI 도우미 <span class="aib">AI</span></h2>` +
    `<p class="hint">AI는 제안만 해요. 눌러서 적용하기 전에는 글이 바뀌지 않아요. 보내는 내용은 본문(첨부 요약은 문서 글자)뿐이고, 방문자 이름·이메일·댓글은 보내지 않아요.</p>` +
    `<div class="aibtns">${btn('aisug', '글쓰기 보조')}${btn('aichk', '발행 전 점검')}${btn('aitl', '3줄 요약 만들기')}</div>` +
    `<p class="hint" id="aimsg" role="status">${esc(s.msg || '')}</p>${sug}${chk}${tl}</section>`;
}
