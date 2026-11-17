// 사용법: node build.js  →  dist/ 폴더에 완성된 블로그가 만들어집니다.
// 글은 posts/ 폴더에 .md 파일로 쓰고, 소개글은 about.md에 씁니다.
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- 글 머리말(front matter) 읽기 ----
function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  let body = raw;
  if (m) {
    body = m[2];
    m[1].split('\n').forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
  }
  return { meta, body };
}

// ---- 간단한 마크다운 변환 ----
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return s;
}
function markdown(md) {
  const lines = md.split('\n');
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
      const n = line.match(/^#+/)[0].length + 1; // # → h2
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

// ---- 데이터 모으기 ----
const catBySlug = Object.fromEntries(cfg.categories.map((c) => [c.slug, c]));
const postsDir = path.join(ROOT, 'posts');
const posts = fs
  .readdirSync(postsDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const { meta, body } = parseFile(path.join(postsDir, f));
    const slug = f.replace(/\.md$/, '');
    if (!catBySlug[meta.category]) throw new Error(`${f}: category가 올바르지 않습니다 (${meta.category})`);
    return { slug, title: meta.title || slug, date: meta.date || '', category: meta.category, summary: meta.summary || '', html: markdown(body) };
  })
  .sort((a, b) => (a.date < b.date ? 1 : -1));

// ---- 공통 레이아웃 ----
function layout({ title, body, active, root }) {
  const nav = [
    { href: root + 'about.html', label: 'ABOUT', key: 'about' },
    ...cfg.categories.map((c) => ({ href: `${root}${c.slug}/`, label: c.label, key: c.slug })),
  ]
    .map((n) => `<a href="${n.href}"${n.key === active ? ' class="on" aria-current="page"' : ''}>${n.label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Noto+Sans+KR:wght@300;400;500&family=Noto+Serif+KR:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}assets/style.css">
</head>
<body>
<div class="wrap">
<aside>
<a class="brand" href="${root}index.html">${esc(cfg.name)}</a>
<nav aria-label="주 메뉴">${nav}</nav>
</aside>
<main>
${body}
<footer>© ${new Date().getFullYear()} ${esc(cfg.author)} · ${esc(cfg.name)}</footer>
</main>
</div>
</body>
</html>
`;
}

const fmtDate = (d) => d.replace(/-/g, '.');
const postRow = (p, root) =>
  `<a class="row" href="${root}posts/${p.slug}.html"><span class="tag">${esc(catBySlug[p.category].label)}</span><span class="rt"><b>${esc(p.title)}</b><small>${esc(p.summary)}</small></span><time>${fmtDate(p.date)}</time></a>`;

const write = (rel, html) => {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
};

// ---- 빌드 ----
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });

// 홈: 카테고리별 최신 글 3개를 콜라주 타일로
const latest = (slug) => posts.find((p) => p.category === slug);
const tile = (slug, cls, root) => {
  const p = latest(slug);
  const c = catBySlug[slug];
  if (!p) return `<div class="tile ${cls}"><span>${esc(c.title)}</span></div>`;
  return `<a class="tile ${cls}" href="${root}posts/${p.slug}.html"><small>${esc(c.label)}</small><span>${esc(p.title)}</span></a>`;
};
write(
  'index.html',
  layout({
    title: `${cfg.name} · AI PM 블로그`,
    active: '',
    root: '',
    body: `<h1 class="hero">${esc(cfg.headline)}</h1>
<p class="tagline">${esc(cfg.tagline)}</p>
<div class="collage">${tile('portfolio', 't1', '')}<div class="col">${tile('retrospective', 't2', '')}${tile('study', 't3', '')}</div></div>
<div class="bar"><span><b>전체보기</b> ${posts.length}개의 글</span></div>
<div class="list">${posts.map((p) => postRow(p, '')).join('')}</div>`,
  })
);

// 카테고리 페이지
cfg.categories.forEach((c) => {
  const list = posts.filter((p) => p.category === c.slug);
  write(
    `${c.slug}/index.html`,
    layout({
      title: `${c.title} · ${cfg.name}`,
      active: c.slug,
      root: '../',
      body: `<h1 class="page-title">${esc(c.title)}</h1>
<div class="bar"><span><b>전체보기</b> ${list.length}개의 글</span></div>
<div class="list">${list.length ? list.map((p) => postRow(p, '../')).join('') : '<p class="empty">아직 글이 없습니다.</p>'}</div>`,
    })
  );
});

// 글 페이지
posts.forEach((p, idx) => {
  const prev = posts[idx + 1];
  const next = posts[idx - 1];
  const c = catBySlug[p.category];
  write(
    `posts/${p.slug}.html`,
    layout({
      title: `${p.title} · ${cfg.name}`,
      active: p.category,
      root: '../',
      body: `<article class="post">
<a class="tag" href="../${c.slug}/">${esc(c.label)}</a>
<h1>${esc(p.title)}</h1>
<p class="summary">${esc(p.summary)}</p>
<time>${fmtDate(p.date)}</time>
<div class="body">${p.html}</div>
<div class="pn">${prev ? `<a href="${prev.slug}.html">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="${next.slug}.html">${esc(next.title)} →</a>` : '<span></span>'}</div>
</article>`,
    })
  );
});

// 소개 페이지
const about = parseFile(path.join(ROOT, 'about.md'));
write(
  'about.html',
  layout({
    title: `ABOUT · ${cfg.name}`,
    active: 'about',
    root: '',
    body: `<article class="post"><h1>${esc(about.meta.title || 'About')}</h1><div class="body">${markdown(about.body)}</div></article>`,
  })
);

console.log(`완료: 글 ${posts.length}개, 카테고리 ${cfg.categories.length}개 → ${DIST}`);
