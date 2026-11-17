// 마크다운을 안전한 HTML로 바꿉니다. 빌드(build.js)와 관리자 미리보기가 같은 코드를 써요.
// 글에 들어 있는 HTML 글자는 모두 걸러지고, 링크와 이미지 주소는 http(s), mailto, 상대 주소만 허용해요.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IntentMd = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // javascript:, data: 같은 위험한 주소는 '#'으로 바꿔요.
  function safeUrl(u) {
    const url = String(u).trim();
    const m = /^([a-z][a-z0-9+.\-]*):/i.exec(url);
    if (m && !/^(https?|mailto)$/i.test(m[1])) return '#';
    return url;
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${safeUrl(src)}" alt="${alt}" loading="lazy">`);
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      const u = safeUrl(href);
      return /^https?:/i.test(u) ? `<a href="${u}" rel="noopener noreferrer">${text}</a>` : `<a href="${u}">${text}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    return s;
  }

  function markdown(md) {
    const lines = String(md).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
      } else if (/^#{1,3} /.test(line)) {
        // 페이지 제목이 h1이라서 본문의 #, ##은 h2, ###은 h3로 만들어요. (제목 단계를 건너뛰지 않게)
        const level = line.match(/^#+/)[0].length;
        const n = level === 3 ? 3 : 2;
        out.push(`<h${n}>${inline(line.replace(/^#+ /, ''))}</h${n}>`);
        i++;
      } else if (/^> /.test(line)) {
        const q = [];
        while (i < lines.length && /^> /.test(lines[i])) q.push(lines[i++].slice(2));
        out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>');
      } else if (/^[-*] /.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*] /.test(lines[i])) items.push('<li>' + inline(lines[i++].slice(2)) + '</li>');
        out.push('<ul>' + items.join('') + '</ul>');
      } else if (/^\d+\. /.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\. /.test(lines[i])) items.push('<li>' + inline(lines[i++].replace(/^\d+\. /, '')) + '</li>');
        out.push('<ol>' + items.join('') + '</ol>');
      } else if (line.trim() === '') {
        i++;
      } else {
        const p = [];
        while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,3} |> |[-*] |\d+\. )/.test(lines[i])) p.push(lines[i++]);
        out.push('<p>' + inline(p.join(' ')) + '</p>');
      }
    }
    return out.join('\n');
  }

  return { markdown, esc, safeUrl };
});
