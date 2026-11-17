// 사용법: node build.js  →  dist/ 폴더에 완성된 블로그가 만들어집니다.
// 글은 두 곳에서 와요. (1) 관리자 화면에서 쓴 공개 글은 파이어베이스에서 가져오고, (2) posts/ 폴더의 .md 파일도 그대로 써요.
// 소개글은 about.md에 씁니다.
// 사이트 주소는 site.config.json의 "siteUrl"이나 `node build.js --site-url=https://내주소` 로 알려 주세요.
// 주소가 있어야 대표 주소(canonical), 사이트맵, RSS, 공유 이미지 주소가 만들어져요.
// 옵션: --with-private (내 컴퓨터에서 private/ 폴더의 회고까지 보기), --no-remote (파이어베이스에서 글을 가져오지 않기)
const fs = require('fs');
const path = require('path');
const { markdown, esc } = require('./assets/markdown.js');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const fbCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/firebase-config.json'), 'utf8'));

const isPlaceholder = (s) => !s || /^\[.*\]$/.test(String(s).trim());
const warnings = [];

// ---- 사이트 주소와 기본 설정 ----
const argSite = (process.argv.find((a) => a.startsWith('--site-url=')) || '').split('=')[1];
const SITE_URL = String(argSite || process.env.SITE_URL || cfg.siteUrl || '').trim().replace(/\/+$/, '');
const DESC = cfg.description || cfg.tagline;
const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Noto+Sans+KR:wght@300;400;500&family=Noto+Serif+KR:wght@500;700&display=swap';
// 주소를 만들 때 쓰는 규칙: index.html은 폴더 주소로, cleanUrls가 켜져 있으면 .html도 뗍니다.
const urlFor = (rel) => {
  let r = rel.replace(/index\.html$/, '');
  if (cfg.cleanUrls) r = r.replace(/\.html$/, '');
  return `${SITE_URL}/${r}`;
};
const excerpt = (html, n = 150) => {
  const t = String(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const isoDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

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

// ---- 데이터 모으기 ----
// 비공개 카테고리(site.config.json의 "private": true, 예: 회고)는 나만 볼 수 있어요.
// 기본 빌드(인터넷에 올리는 용도)에는 아예 들어가지 않고,
// 내 컴퓨터에서 미리 볼 때만 `node build.js --with-private`로 private/ 폴더의 글을 포함해요.
const WITH_PRIVATE = process.argv.includes('--with-private');
const catBySlug = Object.fromEntries(cfg.categories.map((c) => [c.slug, c]));
const visCats = cfg.categories.filter((c) => !c.private || WITH_PRIVATE);
const publicCats = cfg.categories.filter((c) => !c.private);

function checkPost(p, where) {
  if (!p.summary) warnings.push(`${where}: summary(요약)가 없어 본문 앞부분을 검색 결과 설명으로 써요.`);
  else if (p.summary.length > 160) warnings.push(`${where}: 요약이 160자보다 길어서 검색 결과에서 잘릴 수 있어요.`);
  if (/<img[^>]*alt=""/.test(p.html)) warnings.push(`${where}: 이미지에 대체 글(alt)이 비어 있어요. ![설명](주소) 형태로 설명을 적어 주세요.`);
  if (p.title.length > 60) warnings.push(`${where}: 제목이 60자보다 길어서 검색 결과에서 잘릴 수 있어요.`);
}

// 폴더의 .md 파일 읽기
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
      const html = markdown(body);
      const post = {
        slug,
        title: meta.title || slug,
        date: meta.date || '',
        category: meta.category,
        summary: meta.summary || '',
        description: meta.description || meta.summary || excerpt(html),
        image: meta.image || '',
        html,
      };
      if (!isPrivateDir) checkPost(post, f);
      return post;
    });
};

// 파이어베이스에서 공개 글 가져오기. 로그인 없이 읽을 수 있는 글(visibility == public)만 와요.
// 가져오지 못하면 멈춰요. (그냥 넘어가면 쓴 글이 사이트에서 사라진 채 배포될 수 있어서예요.)
async function fetchRemotePosts() {
  if (process.argv.includes('--no-remote')) {
    warnings.push('--no-remote로 빌드해서 파이어베이스의 글을 가져오지 않았어요. 이 빌드를 배포하면 파이어베이스에 쓴 글이 사이트에서 빠져요.');
    return [];
  }
  const url = `https://firestore.googleapis.com/v1/projects/${fbCfg.projectId}/databases/(default)/documents:runQuery`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'posts' }],
          where: { fieldFilter: { field: { fieldPath: 'visibility' }, op: 'EQUAL', value: { stringValue: 'public' } } },
        },
      }),
    });
  } catch (e) {
    throw new Error('파이어베이스에서 글을 가져오지 못했어요. 인터넷 연결을 확인하거나, 연결 없이 만들려면 --no-remote 옵션을 쓰세요.');
  }
  if (!res.ok) throw new Error(`파이어베이스에서 글을 가져오지 못했어요 (오류 ${res.status}). 연결 없이 만들려면 --no-remote 옵션을 쓰세요.`);
  const rows = await res.json();
  const out = [];
  for (const r of rows) {
    if (!r.document) continue;
    const f = r.document.fields || {};
    const id = r.document.name.split('/').pop();
    const s = (k) => (f[k] && f[k].stringValue) || '';
    const cat = catBySlug[s('category')];
    if (!cat || cat.private) {
      warnings.push(`파이어베이스 글 ${id}: 알 수 없거나 비공개인 카테고리(${s('category')})라 건너뛰었어요.`);
      continue;
    }
    const html = markdown(s('body'));
    const post = {
      slug: s('slug') || id,
      id,
      title: s('title') || id,
      date: s('date'),
      category: s('category'),
      summary: s('summary'),
      description: s('description') || s('summary') || excerpt(html),
      image: '',
      html,
    };
    checkPost(post, `파이어베이스 글 "${post.title}"`);
    out.push(post);
  }
  return out;
}

// ---- 검색·공유용 head 만들기 ----
// seo: { description, rel(대표 주소가 될 파일 경로), type('website'|'article'), noindex, image, published, jsonld[] }
function headHtml({ title, root, seo = {} }) {
  const t = [];
  const desc = seo.description || DESC;
  t.push('<meta charset="utf-8">');
  t.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  t.push(`<title>${esc(title)}</title>`);
  t.push(`<meta name="description" content="${esc(desc)}">`);
  if (!isPlaceholder(cfg.author)) t.push(`<meta name="author" content="${esc(cfg.author)}">`);
  t.push(seo.noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow,max-image-preview:large">');
  if (!seo.noindex) {
    const canonical = SITE_URL && seo.rel !== undefined ? urlFor(seo.rel) : '';
    if (canonical) t.push(`<link rel="canonical" href="${esc(canonical)}">`);
    // 공유 카드(Open Graph, Twitter)
    const imgRel = seo.image || cfg.ogImage || 'assets/og-default.png';
    const hasImg = SITE_URL && fs.existsSync(path.join(ROOT, imgRel));
    const imgUrl = hasImg ? `${SITE_URL}/${imgRel.replace(/^\//, '')}` : '';
    t.push(`<meta property="og:type" content="${seo.type || 'website'}">`);
    t.push(`<meta property="og:site_name" content="${esc(cfg.name)}">`);
    t.push(`<meta property="og:locale" content="ko_KR">`);
    t.push(`<meta property="og:title" content="${esc(title)}">`);
    t.push(`<meta property="og:description" content="${esc(desc)}">`);
    if (canonical) t.push(`<meta property="og:url" content="${esc(canonical)}">`);
    if (imgUrl) {
      t.push(`<meta property="og:image" content="${esc(imgUrl)}">`);
      if (imgRel === 'assets/og-default.png') t.push('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
    }
    if (seo.type === 'article' && isoDate(seo.published)) t.push(`<meta property="article:published_time" content="${seo.published}">`);
    t.push(`<meta name="twitter:card" content="${imgUrl ? 'summary_large_image' : 'summary'}">`);
    t.push(`<meta name="twitter:title" content="${esc(title)}">`);
    t.push(`<meta name="twitter:description" content="${esc(desc)}">`);
    if (imgUrl) t.push(`<meta name="twitter:image" content="${esc(imgUrl)}">`);
  }
  if (cfg.googleVerification) t.push(`<meta name="google-site-verification" content="${esc(cfg.googleVerification)}">`);
  if (cfg.naverVerification) t.push(`<meta name="naver-site-verification" content="${esc(cfg.naverVerification)}">`);
  t.push(`<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">`);
  t.push(`<link rel="icon" href="${root}assets/icon-192.png" sizes="192x192" type="image/png">`);
  t.push(`<link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png">`);
  if (SITE_URL && !WITH_PRIVATE) t.push(`<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)} RSS" href="${root}rss.xml">`);
  // 글꼴은 화면 그리기를 막지 않게 늦게 불러와요.
  t.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  t.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  t.push(`<link rel="preload" as="style" href="${FONT_URL}" onload="this.onload=null;this.rel='stylesheet'">`);
  t.push(`<noscript><link rel="stylesheet" href="${FONT_URL}"></noscript>`);
  t.push(`<link rel="stylesheet" href="${root}assets/style.css">`);
  (seo.jsonld || []).forEach((o) => t.push(`<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`));
  return t.join('\n');
}

// ---- 공통 레이아웃 ----
function layout({ title, body, active, root, admin = false, script = '', extraScripts = '', bodyAttr = '', seo = {} }) {
  const items = admin
    ? [
        { href: root + 'admin/write.html', label: '새 글 쓰기', key: 'write' },
        { href: root + 'admin/posts.html', label: '글 관리', key: 'posts' },
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
    ? `<div class="who"><span id="who">확인 중…</span><button type="button" id="logout" class="linkbtn">로그아웃</button></div>`
    : `<a class="admin" href="${root}admin/login.html" rel="nofollow">관리자 로그인</a>`;
  return `<!doctype html>
<html lang="ko">
<head>
${headHtml({ title, root, seo })}
</head>
<body${bodyAttr}>
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
${script ? `<script src="${root}assets/${script}"></script>` : ''}${extraScripts}
</body>
</html>
`;
}

const fmtDate = (d) => d.replace(/-/g, '.');
const timeTag = (d) => (isoDate(d) ? `<time datetime="${d}">${fmtDate(d)}</time>` : `<time>${fmtDate(d)}</time>`);
const postRow = (p, root) =>
  `<a class="row" data-q="${esc((p.title + ' ' + p.summary).toLowerCase())}" href="${root}posts/${p.slug}.html"><span class="tag">${esc(catBySlug[p.category].label)}</span><span class="rt"><b>${esc(p.title)}</b><small>${esc(p.summary)}</small></span>${timeTag(p.date)}</a>`;

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

const websiteLd = () => {
  const o = { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.name, description: DESC, inLanguage: 'ko' };
  if (SITE_URL) o.url = urlFor('');
  return o;
};

// ---- 빌드 ----
async function main() {
  const remote = await fetchRemotePosts();
  const local = [...loadPosts(path.join(ROOT, 'posts'), false), ...(WITH_PRIVATE ? loadPosts(path.join(ROOT, 'private'), true) : [])];
  // 주소(slug)가 겹치면 파이어베이스 글 뒤에 글 번호 앞 6자를 붙여요.
  const used = new Set(local.map((p) => p.slug));
  remote.forEach((p) => {
    if (used.has(p.slug)) {
      warnings.push(`글 주소 "${p.slug}"가 겹쳐서 "${p.title}"의 주소를 ${p.slug}-${p.id.slice(0, 6)}로 바꿨어요.`);
      p.slug = `${p.slug}-${p.id.slice(0, 6)}`;
    }
    used.add(p.slug);
  });
  const posts = [...local, ...remote].sort((a, b) => (a.date < b.date ? 1 : -1));

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
      seo: { description: DESC, rel: '', jsonld: [websiteLd()] },
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
      seo: { description: `${cfg.name}에 올린 글 ${posts.length}편의 목록입니다. 포트폴리오와 스터디 노트를 최신순으로 볼 수 있어요.`, rel: 'posts/' },
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
        seo: { description: `${cfg.name}의 ${c.title} 글 ${list.length}편. ${list[0] ? `최근 글: ${list[0].title}` : '곧 글이 올라와요.'}`, rel: `${c.slug}/` },
        body: `<h1 class="page-title">${esc(c.title)}</h1>\n${listBlock(list, '../')}`,
      })
    );
  });

  // 글 페이지
  posts.forEach((p, idx) => {
    const prev = posts[idx + 1];
    const next = posts[idx - 1];
    const c = catBySlug[p.category];
    const rel = `posts/${p.slug}.html`;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.description,
      inLanguage: 'ko',
      articleSection: c.title,
    };
    if (isoDate(p.date)) {
      ld.datePublished = p.date;
      ld.dateModified = p.date;
    }
    if (!isPlaceholder(cfg.author)) ld.author = { '@type': 'Person', name: cfg.author };
    if (SITE_URL) {
      ld.mainEntityOfPage = urlFor(rel);
      ld.url = urlFor(rel);
      const imgRel = p.image || cfg.ogImage || 'assets/og-default.png';
      if (fs.existsSync(path.join(ROOT, imgRel))) ld.image = `${SITE_URL}/${imgRel.replace(/^\//, '')}`;
    }
    const jsonld = [ld];
    if (SITE_URL) {
      jsonld.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: cfg.name, item: urlFor('') },
          { '@type': 'ListItem', position: 2, name: c.title, item: urlFor(`${c.slug}/`) },
          { '@type': 'ListItem', position: 3, name: p.title, item: urlFor(rel) },
        ],
      });
    }
    write(
      rel,
      layout({
        title: `${p.title} · ${cfg.name}`,
        active: p.category,
        root: '../',
        seo: { description: p.description, rel, type: 'article', image: p.image, published: p.date, jsonld },
        body: `<article class="post">
<a class="tag" href="../${c.slug}/">${esc(c.label)}</a>
<h1>${esc(p.title)}</h1>
<p class="summary">${esc(p.summary)}</p>
${timeTag(p.date)}
<div class="body">${p.html}</div>
<div class="pn">${prev ? `<a href="${prev.slug}.html" rel="prev">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="${next.slug}.html" rel="next">${esc(next.title)} →</a>` : '<span></span>'}</div>
</article>`,
      })
    );
  });

  // 소개 페이지
  const about = parseFile(path.join(ROOT, 'about.md'));
  const aboutHtml = markdown(about.body);
  const aboutLd = [];
  if (!isPlaceholder(cfg.author)) {
    const person = { '@context': 'https://schema.org', '@type': 'Person', name: cfg.author, description: excerpt(aboutHtml, 120) };
    if (SITE_URL) person.url = urlFor('about.html');
    aboutLd.push(person);
  }
  write(
    'about.html',
    layout({
      title: `ABOUT · ${cfg.name}`,
      active: 'about',
      root: '',
      seo: { description: excerpt(aboutHtml) || DESC, rel: 'about.html', jsonld: aboutLd },
      body: `<article class="post"><h1>${esc(about.meta.title || 'About')}</h1><div class="body">${aboutHtml}</div></article>`,
    })
  );

  // 찾을 수 없는 주소(404). 어느 폴더에서 열려도 깨지지 않게 주소를 /로 시작해요.
  write(
    '404.html',
    layout({
      title: `페이지를 찾을 수 없어요 · ${cfg.name}`,
      active: '',
      root: '/',
      seo: { noindex: true },
      body: `<article class="post"><h1>페이지를 찾을 수 없어요</h1><p class="summary">주소가 바뀌었거나 없는 글이에요.</p><p><a class="btn" href="/index.html">홈으로 가기</a></p></article>`,
    })
  );

  // ---- robots.txt, 사이트맵, RSS (올리는 용도의 빌드에서만) ----
  if (!WITH_PRIVATE) {
    write('robots.txt', `User-agent: *\nAllow: /\n${SITE_URL ? `\nSitemap: ${SITE_URL}/sitemap.xml\n` : ''}`);
    if (SITE_URL) {
      const newest = posts.map((p) => p.date).filter(isoDate)[0];
      const aboutDate = fs.statSync(path.join(ROOT, 'about.md')).mtime.toISOString().slice(0, 10);
      const entries = [
        { rel: '', last: newest },
        { rel: 'posts/', last: newest },
        ...visCats.map((c) => ({ rel: `${c.slug}/`, last: (posts.find((p) => p.category === c.slug) || {}).date })),
        { rel: 'about.html', last: aboutDate },
        ...posts.map((p) => ({ rel: `posts/${p.slug}.html`, last: p.date })),
      ];
      write(
        'sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          entries.map((e) => `  <url><loc>${esc(urlFor(e.rel))}</loc>${isoDate(e.last) ? `<lastmod>${e.last}</lastmod>` : ''}</url>`).join('\n') +
          `\n</urlset>\n`
      );
      const items = posts.slice(0, 20).map((p) => {
        const link = urlFor(`posts/${p.slug}.html`);
        const pub = isoDate(p.date) ? `<pubDate>${new Date(p.date + 'T00:00:00+09:00').toUTCString()}</pubDate>` : '';
        return `    <item><title>${esc(p.title)}</title><link>${esc(link)}</link><guid isPermaLink="true">${esc(link)}</guid>${pub}<description>${esc(p.description)}</description></item>`;
      });
      write(
        'rss.xml',
        `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${esc(cfg.name)}</title>\n    <link>${esc(urlFor(''))}</link>\n    <description>${esc(DESC)}</description>\n    <language>ko</language>\n${items.join('\n')}\n  </channel>\n</rss>\n`
      );
    } else {
      warnings.push('사이트 주소(siteUrl)가 없어 사이트맵, RSS, 대표 주소, 공유 이미지 주소를 만들지 못했어요. site.config.json에 siteUrl을 넣거나 --site-url=https://내주소 로 빌드하세요.');
    }
  }

  // ---- 관리자 화면 (파이어베이스 로그인과 데이터베이스에 연결) ----
  // 비공개 메뉴(회고)의 이름은 공개되는 이 파일들에 넣지 않아요. 관리자가 로그인한 뒤 데이터베이스에서 불러와요.
  const catsJson = JSON.stringify(Object.fromEntries(publicCats.map((c) => [c.slug, c.title]))).replace(/</g, '\\u003c');
  const appScripts = `\n<script type="application/json" id="cats">${catsJson}</script>\n<script src="../assets/markdown.js"></script>\n<script type="module" src="../assets/admin-app.js"></script>`;

  write(
    'admin/login.html',
    `<!doctype html>
<html lang="ko">
<head>
${headHtml({ title: `관리자 로그인 · ${cfg.name}`, root: '../', seo: { noindex: true } })}
</head>
<body class="login" data-page="login">
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
</form>
</section>
</div>
<script type="module" src="../assets/admin-app.js"></script>
</body>
</html>
`
  );

  write(
    'admin/posts.html',
    layout({
      title: `글 관리 · ${cfg.name}`,
      active: 'posts',
      root: '../',
      admin: true,
      bodyAttr: ' data-page="posts"',
      extraScripts: appScripts,
      seo: { noindex: true },
      body: `<p id="gate" class="empty">로그인 확인 중…</p>
<div id="adminapp" hidden>
<div class="head"><h1 class="page-title">글 관리</h1><a class="btn pri" href="write.html">새 글 쓰기</a></div>
<p class="notice" id="msg" role="status" hidden></p>
<p class="hint">공개 글은 사이트를 다시 빌드하고 배포해야 방문자에게 보여요. · 글 <span id="count">0</span>개</p>
<div class="tblwrap"><table class="tbl"><thead><tr><th scope="col">제목</th><th scope="col">카테고리</th><th scope="col">공개 범위</th><th scope="col">날짜</th><th scope="col"><span class="sr">작업</span></th></tr></thead><tbody id="rows"></tbody></table></div>
</div>`,
    })
  );

  write(
    'admin/write.html',
    layout({
      title: `글쓰기 · ${cfg.name}`,
      active: 'write',
      root: '../',
      admin: true,
      bodyAttr: ' data-page="write"',
      extraScripts: appScripts,
      seo: { noindex: true },
      body: `<p id="gate" class="empty">로그인 확인 중…</p>
<div id="adminapp" hidden>
<div class="head"><h1 class="page-title" id="heading">새 글 쓰기</h1></div>
<p class="notice" id="msg" role="status" hidden></p>
<form id="form" novalidate>
<label><span class="sr">제목</span><input class="title" id="wtitle" type="text" maxlength="120" placeholder="제목을 입력하세요"></label>
<div class="meta">
<label class="field" for="wcat">카테고리<select id="wcat">${publicCats.map((c) => `<option value="${c.slug}">${esc(c.title)}</option>`).join('')}</select></label>
<div class="field" id="vgroup">공개 범위
<div class="vis" role="group" aria-label="공개 범위"><button type="button" id="pub" aria-pressed="true">공개글</button><button type="button" id="priv" aria-pressed="false">나만 보기</button></div>
<span class="hint" id="vhint">누구나 읽을 수 있어요.</span></div>
<div class="field" id="vfixed" hidden>공개 범위<p class="fixed">나만 보기 (고정)</p><span class="hint">이 메뉴는 항상 나만 볼 수 있어요. 공개로 바꿀 수 없어요.</span></div>
<label class="field" for="wdate">날짜<input id="wdate" type="date"></label>
<label class="field" for="wslug">글 주소 (영어, 선택)<input id="wslug" type="text" maxlength="80" placeholder="예: ai-chatbot-planning"></label>
<label class="field" for="wsum">한 줄 요약<input id="wsum" type="text" maxlength="300" placeholder="목록에 보일 한두 문장"></label>
<label class="field" for="wdesc">검색 결과 설명 (선택)<input id="wdesc" type="text" maxlength="300" placeholder="비우면 요약을 써요"></label>
</div>
<div class="tabs" role="tablist" aria-label="편집 방식"><button role="tab" type="button" id="tw" aria-selected="true">작성</button><button role="tab" type="button" id="tp" aria-selected="false">미리보기</button></div>
<label id="bodywrap"><span class="sr">본문</span><textarea id="wbody" placeholder="## 제목&#10;&#10;본문을 마크다운으로 쓰세요. 제목은 ##, 목록은 -, 굵게는 **글자** 예요."></textarea></label>
<div class="preview body" id="pv" hidden></div>
<div class="btns"><button class="btn pri" id="save" type="submit">저장하기</button><a class="btn" href="posts.html">글 관리로</a></div>
</form>
</div>`,
    })
  );

  console.log(`완료: 글 ${posts.length}개 (파이어베이스 ${remote.length}개, 파일 ${local.length}개), 카테고리 ${visCats.length}개${WITH_PRIVATE ? ' (나만 보기 글 포함, 올리지 마세요)' : ''} → ${DIST}`);

  // ---- 공개 전에 고쳐야 할 자리표시자 점검 ----
  if (isPlaceholder(cfg.author)) warnings.push('작성자 이름이 자리표시자([이름])예요. 공개 전에 site.config.json의 author를 바꿔 주세요. (구조화 데이터의 작성자 정보도 비어 있어요.)');
  if (isPlaceholder(cfg.contact)) warnings.push('연락처가 자리표시자예요. 공개 전에 바꾸거나 about.md에서 지워 주세요.');
  if (posts.some((p) => /^\[샘플\]/.test(p.title))) warnings.push('[샘플]이 붙은 글이 있어요. 공개 전에 지워 주세요.');
  if (SITE_URL) console.log(`사이트 주소: ${SITE_URL}`);
  if (warnings.length) console.log('\nSEO 점검 알림:\n' + warnings.map((w) => ' - ' + w).join('\n'));
}

main().catch((e) => {
  console.error('\n빌드 실패: ' + e.message);
  process.exit(1);
});
