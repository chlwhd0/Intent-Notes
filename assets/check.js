// 발행 전 점검 규칙. 관리자 화면과 빌드(build.js)가 같은 코드를 써요.
// AI 없이 정해 둔 규칙(패턴)만으로 찾는 점검이라서, AI 서비스가 멈춰도 그대로 동작해요.
//   해결 필요(bad): 자리표시자, 전화번호. 하나라도 있으면 공개 글로 저장할 수 없어요. (firestore.rules도 같은 것을 막아요)
//   확인 필요(warn): 정확한 수치. 내가 "확인했어요"를 눌러야 발행돼요.
// AI가 찾는 것(실명으로 보이는 표현, 회사 내부 자료)은 서버 함수가 돌려준 결과를 fromAi()로 같은 모양으로 바꿔 합쳐요.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IntentCheck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

  // 글 서식(HTML)에서 글자만 뽑아요. 해시와 점검은 모두 이 글자를 기준으로 해요.
  const plain = (html) =>
    String(html || '')
      .replace(/<(br|\/p|\/h2|\/h3|\/li|\/blockquote)[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENT[m] || m)
      .replace(/\s+/g, ' ')
      .trim();

  // 짧은 지문(해시). 요약을 승인한 뒤 본문이 바뀌었는지 알아볼 때 써요. (보안용이 아니에요)
  const hash = (s) => {
    let h = 5381;
    const t = String(s || '');
    for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36);
  };

  const RULES = [
    { id: 'ph', level: 'bad', re: /\[(이름|샘플|이메일 주소)[^\]]*\]/g, label: '자리표시자가 남아 있어요', fix: '실제 내용으로 바꾸거나 지워 주세요.' },
    { id: 'tel', level: 'bad', re: /(?<!\d)01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/g, label: '전화번호가 들어 있어요', fix: '공개 글에는 연락처를 넣지 말고, 댓글로 문의받는 방식을 써요.' },
    { id: 'num', level: 'warn', re: /\d{1,3}(,\d{3})+\s*(명|원|회|건|개)/g, label: '정확한 수치예요', fix: '필요하면 "수천 명"이나 비율로 바꿔요. 그대로 써도 되면 확인했다고 표시해요.' },
  ];
  const AI_LABELS = {
    name: { label: '실명으로 보이는 표현이에요', fix: '동의를 받았는지 확인하거나 "동료 PM"처럼 바꿔요.' },
    internal: { label: '회사 내부 자료로 보여요', fix: '공개 가능한 자료인지 확인하고, 아니면 일반적인 설명으로 바꿔요.' },
  };

  // text(글자)에서 규칙으로 찾은 것들. [{id, level, text, label, fix, key, ai:false}]
  function run(text) {
    const t = String(text || '');
    const hits = [];
    RULES.forEach((r) => {
      const re = new RegExp(r.re.source, 'g');
      let m;
      while ((m = re.exec(t))) hits.push({ id: r.id, level: r.level, text: m[0], label: r.label, fix: r.fix, key: r.id + ':' + m[0], ai: false });
    });
    return hits;
  }

  // 서버 함수(AI)가 돌려준 [{kind:'name'|'internal', text}]를 같은 모양으로 바꿔요. 지금 글에 없는 문장은 버려요.
  function fromAi(items, text) {
    const t = String(text || '');
    return (Array.isArray(items) ? items : [])
      .filter((x) => x && AI_LABELS[x.kind] && typeof x.text === 'string' && x.text.length >= 2 && t.includes(x.text))
      .map((x) => ({ id: 'ai-' + x.kind, level: 'warn', text: x.text, label: AI_LABELS[x.kind].label, fix: AI_LABELS[x.kind].fix, key: 'ai-' + x.kind + ':' + x.text, ai: true, why: typeof x.why === 'string' ? x.why : '' }));
  }

  // 발행할 수 있는지: 해결 필요가 없고, 확인 필요 항목을 모두 확인했을 때만 true
  function gate(hits, acks) {
    const bad = hits.filter((h) => h.level === 'bad');
    const pending = hits.filter((h) => h.level === 'warn' && !(acks && acks[h.key]));
    return { ok: !bad.length && !pending.length, bad, pending };
  }

  return { plain, hash, run, fromAi, gate };
});
