// 글 서식(HTML)을 안전하게 걸러요. 빌드(build.js)와 관리자 화면이 같은 코드를 써요.
// 허용한 태그와 스타일만 남기고 나머지는 모두 버려서, 글에 심은 코드가 실행되지 않게 해요.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IntentSan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FAM = {
    sans: "'Noto Sans KR',sans-serif",
    serif: "'Noto Serif KR',serif",
    disp: "'Cormorant Garamond',serif",
    mono: 'ui-monospace,Menlo,monospace',
  };
  const famKey = (v) => {
    v = String(v).toLowerCase();
    if (v.includes('cormorant')) return 'disp';
    if (v.includes('noto serif')) return 'serif';
    if (v.includes('mono') || v.includes('menlo') || v.includes('courier')) return 'mono';
    if (v.includes('noto sans')) return 'sans';
    return '';
  };
  const okColor = (c) => {
    c = String(c).trim().toLowerCase();
    return /^#[0-9a-f]{3,6}$/.test(c) || /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(c);
  };
  const TAGS = {
    p: 'p', div: 'p', h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h3', br: 'br', strong: 'strong', b: 'strong', em: 'em', i: 'em',
    u: 'u', s: 's', strike: 's', del: 's', ul: 'ul', ol: 'ol', li: 'li', blockquote: 'blockquote', span: 'span', font: 'span', a: 'a',
  };
  const SKIP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'textarea', 'title', 'svg', 'math']);
  const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const escText = (s) =>
    s.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,8}|#\d{1,6}|#x[0-9a-fA-F]{1,5});)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function cleanStyle(style, align) {
    const o = [];
    const re = /([a-zA-Z-]+)\s*:\s*((?:"[^"]*"|'[^']*'|[^;])*)/g;
    let m;
    while ((m = re.exec(style || ''))) {
      const k = m[1].toLowerCase();
      const v = m[2].trim();
      if (k === 'font-family') { const f = famKey(v); if (f) o.push('font-family:' + FAM[f]); }
      else if (k === 'font-size') { const n = parseInt(v, 10); if (/px$/.test(v) && n >= 10 && n <= 60) o.push('font-size:' + n + 'px'); }
      else if (k === 'font-weight') { const n = v === 'bold' ? 700 : v === 'normal' ? 400 : parseInt(v, 10); if (n >= 100 && n <= 900) o.push('font-weight:' + n); }
      else if (k === 'font-style') { if (v === 'italic') o.push('font-style:italic'); }
      else if (k === 'text-decoration' || k === 'text-decoration-line') {
        const d = [];
        if (/underline/.test(v)) d.push('underline');
        if (/line-through/.test(v)) d.push('line-through');
        if (d.length) o.push('text-decoration:' + d.join(' '));
      } else if (k === 'color') { if (okColor(v)) o.push('color:' + v.toLowerCase()); }
      else if (k === 'text-align') { if (/^(left|center|right|justify)$/.test(v)) o.push('text-align:' + v); }
    }
    if (align && /^(left|center|right|justify)$/i.test(align) && !o.some((x) => x.startsWith('text-align'))) o.push('text-align:' + align.toLowerCase());
    return o.join(';');
  }

  function parseAttrs(src) {
    const out = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '');
    return out;
  }

  function sanitizeHtml(html) {
    const input = String(html || '');
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g;
    const out = [];
    const stack = [];
    let skip = '';
    let skipDepth = 0;
    let m;
    while ((m = re.exec(input))) {
      const tok = m[0];
      if (tok.startsWith('<!--')) continue;
      if (m[2] === undefined) { // 글자
        if (!skip) out.push(tok === '<' ? '&lt;' : escText(tok));
        continue;
      }
      const raw = m[2].toLowerCase();
      const closing = m[1] === '/';
      if (skip) {
        if (raw === skip) { if (closing) { skipDepth--; if (skipDepth <= 0) skip = ''; } else skipDepth++; }
        continue;
      }
      if (SKIP.has(raw)) { if (!closing) { skip = raw; skipDepth = 1; } continue; }
      const name = TAGS[raw];
      if (!name) continue; // 모르는 태그는 버리고 안의 글자는 남겨요.
      if (closing) {
        if (name === 'br') continue;
        const i = stack.lastIndexOf(name);
        if (i < 0) continue;
        while (stack.length > i) out.push('</' + stack.pop() + '>');
        continue;
      }
      if (name === 'br') { out.push('<br>'); continue; }
      const attrs = parseAttrs(m[3]);
      let open = '<' + name;
      if (name === 'a') {
        const href = (attrs.href || '').trim();
        if (!/^https?:\/\//i.test(href)) continue; // 위험하거나 잘못된 링크는 글자만 남겨요.
        open += ' href="' + escAttr(href) + '" target="_blank" rel="noopener noreferrer"';
      }
      const st = cleanStyle(attrs.style, attrs.align);
      if (st) open += ' style="' + st + '"';
      out.push(open + '>');
      stack.push(name);
    }
    while (stack.length) out.push('</' + stack.pop() + '>');
    return out.join('');
  }

  const textOf = (html) =>
    decode(String(html || '').replace(/<(br|\/p|\/h2|\/h3|\/li|\/blockquote)[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

  return { sanitizeHtml, textOf, FAM };
});
