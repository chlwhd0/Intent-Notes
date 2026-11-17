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
// 비공개 카테고리(site.config.json의 "private": true, 예: 회고)는 나만 볼 수 있어요.
// 기본 빌드(인터넷에 올리는 용도)에는 아예 들어가지 않고,
// 내 컴퓨터에서 미리 볼 때만 `node build.js --with-private`로 private/ 폴더의 글을 포함해요.
const WITH_PRIVATE = process.argv.includes('--with-private');
const catBySlug = Object.fromEntries(cfg.categories.map((c) => [c.slug, c]));
const visCats = cfg.categories.filter((c) => !c.private || WITH_PRIVATE);
const loadPosts = (dir, isPrivateDir) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { meta, body } = parseFile(path.join(dir, f));
      const slug = f.replace(/\.md$/, '');
      const cat = catBySlug[meta.category];
      if (!cat) throw new Error(`${f}: category가 올바르지 않습니다 (${meta.category})`);
      if (cat.private && !isPrivateDir) throw new Error(`${f}: ${cat.title}은 나만 보는 글이라 posts/가 아니라 private/ 폴더에 써야 해요.`);
      if (!cat.private && isPrivateDir) throw new Error(`${f}: private/ 폴더에는 비공개 카테고리 글만 둘 수 있어요.`);
      return { slug, title: meta.title || slug, date: meta.date || '', category: meta.category, summary: meta.summary || '', html: markdown(body) };
    });
};
const posts = [...loadPosts(path.join(ROOT, 'posts'), false), ...(WITH_PRIVATE ? loadPosts(path.join(ROOT, 'private'), true) : [])].sort((a, b) =>
  a.date < b.date ? 1 : -1
);

// ---- 공통 레이아웃 ----
function layout({ title, body, active, root, admin = false, script = '' }) {
  const items = admin
    ? [
        { href: root + 'admin/write.html', label: '새 글 쓰기', key: 'write' },
        { href: root + 'index.html', label: '블로그 보기', key: 'home' },
      ]
    : [
        { href: root + 'about.html', label: 'ABOUT', key: 'about' },
        ...visCats.map((c) => ({ href: `${root}${c.slug}/`, label: c.label, key: c.slug })),
      ];
  const nav = items
    .map((n) => `<a href="${n.href}"${n.key === active ? ' class="on" aria-current="page"' : ''}>${n.label}</a>`)
    .join('');
  const bottom = admin
    ? `<div class="who"><span>Firebase 연결 전 미리보기</span><a href="${root}admin/login.html">로그인 화면</a></div>`
    : `<a class="admin" href="${root}admin/login.html">관리자 로그인</a>`;
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
<nav aria-label="${admin ? '관리자 메뉴' : '주 메뉴'}">${nav}</nav>
${bottom}
</aside>
<main>
${body}
<footer>© ${new Date().getFullYear()} ${esc(cfg.author)} · ${esc(cfg.name)}</footer>
</main>
</div>
${script ? `<script src="${root}assets/${script}"></script>` : ''}
</body>
</html>
`;
}

const fmtDate = (d) => d.replace(/-/g, '.');
const postRow = (p, root) =>
  `<a class="row" data-q="${esc((p.title + ' ' + p.summary).toLowerCase())}" href="${root}posts/${p.slug}.html"><span class="tag">${esc(catBySlug[p.category].label)}</span><span class="rt"><b>${esc(p.title)}</b><small>${esc(p.summary)}</small></span><time>${fmtDate(p.date)}</time></a>`;

// 글 목록(정렬·검색 포함). assets/list.js가 동작을 붙입니다.
const listBlock = (list, root) => `<div class="tools">
<div class="chips" role="group" aria-label="정렬"><button class="chip" type="button" data-sort="desc" aria-pressed="true">최신순</button><button class="chip" type="button" data-sort="asc" aria-pressed="false">오래된순</button></div>
<label><span class="sr">글 검색</span><input class="search" id="q" type="search" placeholder="제목으로 검색"></label>
</div>
<div class="bar"><span><b>전체보기</b> <span id="count">${list.length}</span>개의 글</span></div>
<div class="list" id="list">${list.length ? list.map((p) => postRow(p, root)).join('') : ''}</div>
<p class="empty" id="empty"${list.length ? ' hidden' : ''}>${list.length ? '검색 결과가 없습니다.' : '아직 글이 없습니다.'}</p>`;

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
<div class="collage">${tile('portfolio', 't1', '')}<div class="col${WITH_PRIVATE ? '' : ' one'}">${WITH_PRIVATE ? tile('retrospective', 't2', '') : ''}${tile('study', 't3', '')}</div></div>
<div class="bar"><span><b>최근 글</b> ${Math.min(5, posts.length)}개</span><a href="posts/">전체 글 보기 →</a></div>
<div class="list">${posts.slice(0, 5).map((p) => postRow(p, '')).join('')}</div>`,
  })
);

// 전체 글 목록
write(
  'posts/index.html',
  layout({
    title: `전체 글 · ${cfg.name}`,
    active: '',
    root: '../',
    script: 'list.js',
    body: `<h1 class="page-title">전체 글</h1>\n${listBlock(posts, '../')}`,
  })
);

// 카테고리 페이지
visCats.forEach((c) => {
  const list = posts.filter((p) => p.category === c.slug);
  write(
    `${c.slug}/index.html`,
    layout({
      title: `${c.title} · ${cfg.name}`,
      active: c.slug,
      root: '../',
      script: 'list.js',
      body: `<h1 class="page-title">${esc(c.title)}</h1>\n${listBlock(list, '../')}`,
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

console.log(`완료: 글 ${posts.length}개, 카테고리 ${visCats.length}개${WITH_PRIVATE ? ' (나만 보기 글 포함, 올리지 마세요)' : ''} → ${DIST}`);

// ---- 관리자 화면 (Firebase 연결 전 미리보기) ----
const fonts = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Noto+Sans+KR:wght@300;400;500&family=Noto+Serif+KR:wght@500;700&display=swap';

write(
  'admin/login.html',
  `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>관리자 로그인 · ${esc(cfg.name)}</title>
<link href="${fonts}" rel="stylesheet">
<link rel="stylesheet" href="../assets/style.css">
</head>
<body class="login">
<div class="wrap">
<section class="visual"><a class="brand" href="../index.html">${esc(cfg.name)}</a><p>${esc(cfg.headline)}</p><small>글쓰기는 로그인한 관리자만 할 수 있어요.</small></section>
<section class="panel">
<form id="f" novalidate>
<h1>관리자 로그인</h1>
<p class="sub">글을 쓰고 고치려면 로그인하세요.</p>
<label class="field" for="em">이메일<input id="em" name="email" type="email" autocomplete="username" placeholder="admin@example.com"></label>
<label class="field" for="pw">비밀번호<input id="pw" name="password" type="password" autocomplete="current-password"></label>
<p class="err" id="err" role="alert"></p>
<button class="btn" type="submit">로그인</button>
<a class="back" href="../index.html">← 블로그로 돌아가기</a>
<p class="note">아직 파이어베이스와 연결되지 않아 로그인되지 않아요.</p>
</form>
</section>
</div>
<script src="../assets/admin.js"></script>
</body>
</html>
`
);

write(
  'admin/write.html',
  layout({
    title: `새 글 쓰기 · ${cfg.name}`,
    active: 'write',
    root: '../',
    admin: true,
    script: 'admin.js',
    body: `<div class="head"><h1 class="page-title">새 글 쓰기</h1><div class="btns"><button class="btn" type="button" data-need-backend>임시저장</button><button class="btn pri" type="button" data-need-backend>발행하기</button></div></div>
<p class="notice" id="notice" role="status" hidden></p>
<label><span class="sr">제목</span><input class="title" id="t" type="text" placeholder="제목을 입력하세요"></label>
<div class="meta">
<label class="field" for="cat">카테고리<select id="cat">${cfg.categories.map((c) => `<option value="${c.slug}"${c.private ? ' data-private' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
<div class="field" id="vfixed" hidden>공개 범위<p class="fixed">나만 보기 (고정)</p><span class="hint">회고는 항상 나만 볼 수 있어요. 공개로 바꿀 수 없어요.</span></div>
<div class="field" id="vlabel">공개 범위
<div class="vis" role="group" aria-labelledby="vlabel"><button type="button" id="pub" aria-pressed="true">공개글</button><button type="button" id="priv" aria-pressed="false">나만 보기</button></div>
<span class="hint" id="vhint">누구나 읽을 수 있어요.</span></div>
<label class="field" for="sum">한 줄 요약<input id="sum" type="text" placeholder="목록에 보일 한두 문장"></label>
</div>
<div class="tabs" role="tablist" aria-label="편집 방식"><button role="tab" type="button" id="tw" aria-selected="true">작성</button><button role="tab" type="button" id="tp" aria-selected="false">미리보기</button></div>
<label id="bodywrap"><span class="sr">본문</span><textarea id="body" placeholder="## 제목&#10;&#10;본문을 마크다운으로 쓰세요."></textarea></label>
<div class="preview" id="pv" hidden></div>
<div class="status">저장 기능은 파이어베이스를 연결한 뒤에 켜져요.</div>`,
  })
);
