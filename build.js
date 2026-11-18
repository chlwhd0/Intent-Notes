// 사용법: node build.js  →  dist/ 폴더에 완성된 블로그가 만들어집니다.
// 같은 코드를 서버(functions/)에서도 써요. 서버는 방문할 때마다 파이어베이스의 최신 글로 페이지를 만들어 줘서,
// 글을 쓰고 고치고 지우면 배포 없이 바로 사이트에 반영돼요. (require('./build.js').generate)
// 글은 두 곳에서 와요. (1) 관리자 화면에서 쓴 공개 글은 파이어베이스에서 가져오고, (2) posts/ 폴더의 .md 파일도 그대로 써요.
// 소개글은 about.md에 씁니다.
// 사이트 주소는 site.config.json의 "siteUrl"이나 `node build.js --site-url=https://내주소` 로 알려 주세요.
// 주소가 있어야 대표 주소(canonical), 사이트맵, RSS, 공유 이미지 주소가 만들어져요.
// 옵션: --with-private (내 컴퓨터에서 private/ 폴더의 회고까지 보기), --no-remote (파이어베이스에서 글을 가져오지 않기)
const fs = require('fs');
const path = require('path');
const { markdown, esc } = require('./assets/markdown.js');
const { sanitizeHtml, textOf } = require('./assets/sanitize.js');
const T = require('./assets/thumbs.js');

// 명령줄(node build.js)로 실행했을 때만 옵션(--site-url 등)을 읽어요. 서버에서는 옵션이 없어요.
const CLI = require.main === module;
const ARGV = CLI ? process.argv : [];

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const fbCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/firebase-config.json'), 'utf8'));

const isPlaceholder = (s) => !s || /^\[.*\]$/.test(String(s).trim());
let warnings = [];

// ---- 사이트 주소와 기본 설정 ----
const argSite = (ARGV.find((a) => a.startsWith('--site-url=')) || '').split('=')[1];
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
const WITH_PRIVATE = ARGV.includes('--with-private');
// 메뉴(카테고리)는 파이어베이스의 settings/menus에서 가져와요. 관리자 화면의 "MANAGE MENUS"에서 고치는 값이에요.
// 가져오지 못하거나 아직 없으면 site.config.json의 공개 메뉴를 써요. 이름은 하나(label)만 써서 어디서나 똑같이 보여요.
let catBySlug = {};
let visCats = [];
let publicCats = [];
const toCat = (c, priv) => ({ slug: c.slug, label: c.label || c.name || c.title, title: c.label || c.name || c.title, private: !!priv });
function setCats(list) {
  const priv = cfg.categories.filter((c) => c.private).map((c) => toCat(c, true));
  publicCats = list;
  visCats = WITH_PRIVATE ? [...list, ...priv] : list;
  catBySlug = Object.fromEntries([...list, ...priv].map((c) => [c.slug, c]));
}
setCats(cfg.categories.filter((c) => !c.private).map((c) => toCat(c, false)));

// ---- 데이터를 가져오는 방법(provider) ----
// provider.menus()  → [{slug, name}] 또는 null(설정이 아직 없음)
// provider.posts()  → 공개 글 [{id, title, slug, category, summary, description, body, format, thumb, img, date}]
// 명령줄 빌드는 파이어베이스 REST(로그인 없이 읽는 공개 데이터)를, 서버는 관리자 SDK를 써요. 둘 다 공개 글만 가져와요.
const rf = (f, k) => (f[k] && f[k].stringValue) || '';
const restProvider = {
  async menus() {
    const url = `https://firestore.googleapis.com/v1/projects/${fbCfg.projectId}/databases/(default)/documents/settings/menus`;
    let res;
    try { res = await fetch(url); } catch (e) { throw new Error('파이어베이스에서 메뉴를 가져오지 못했어요. 인터넷 연결을 확인하거나 --no-remote 옵션을 쓰세요.'); }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`파이어베이스에서 메뉴를 가져오지 못했어요 (오류 ${res.status}).`);
    const doc = await res.json();
    const vals = (((doc.fields || {}).categories || {}).arrayValue || {}).values || [];
    return vals.map((v) => { const f = (v.mapValue || {}).fields || {}; return { slug: rf(f, 'slug'), name: rf(f, 'name') }; });
  },
  async posts() {
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
    return (await res.json()).filter((r) => r.document).map((r) => {
      const f = r.document.fields || {};
      return {
        id: r.document.name.split('/').pop(), title: rf(f, 'title'), slug: rf(f, 'slug'), category: rf(f, 'category'), summary: rf(f, 'summary'),
        description: rf(f, 'description'), body: rf(f, 'body'), format: rf(f, 'format'), img: rf(f, 'img'), date: rf(f, 'date'),
        thumb: f.thumb && f.thumb.integerValue !== undefined ? Number(f.thumb.integerValue) : undefined,
        files: (((f.files || {}).arrayValue || {}).values || []).map((v) => { const m = (v.mapValue || {}).fields || {}; return { name: rf(m, 'name'), url: rf(m, 'url'), size: Number((m.size || {}).integerValue || 0) }; }),
      };
    });
  },
};
const noRemoteProvider = {
  async menus() { return null; },
  async posts() {
    warnings.push('--no-remote로 빌드해서 파이어베이스의 글을 가져오지 않았어요. 이 빌드를 배포하면 파이어베이스에 쓴 글이 사이트에서 빠져요.');
    return [];
  },
};

async function loadMenus(provider) {
  const raw = await provider.menus();
  if (raw === null) { if (provider !== noRemoteProvider) warnings.push('파이어베이스에 메뉴 설정(settings/menus)이 아직 없어서 site.config.json의 메뉴를 썼어요.'); return; }
  const list = raw.filter((c) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug) && c.name);
  if (list.length) setCats(list.map((c) => toCat(c, false)));
}

// 썸네일 모양: 글에 정해 둔 값이 없으면 주소(slug)로 정해요.
const hashN = (s) => [...String(s)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6;

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
        id: 'md-' + slug,
        thumb: /^[0-5]$/.test(meta.thumb || '') ? Number(meta.thumb) : hashN(slug),
        img: '',
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

// 첨부 파일 목록: 이름과 크기, 우리 파일 저장소(Firebase Storage) 주소만 받아요. 다른 주소는 버려요.
const cleanFiles = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .filter((f) => f && typeof f.name === 'string' && f.name && T.okImg(f.url))
    .slice(0, 5)
    .map((f) => ({ name: f.name.slice(0, 100), url: f.url, size: Number(f.size) || 0 }));
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const filesBlock = (files) =>
  files && files.length
    ? `<section class="files" aria-labelledby="fh"><h2 class="sec" id="fh">첨부 파일</h2><ul>${files.map((f) => `<li><a href="${esc(f.url)}" rel="noopener noreferrer">${esc(f.name)}</a> <small>${fmtSize(f.size)} · ${esc((f.name.split('.').pop() || '').toUpperCase().slice(0, 6))}</small></li>`).join('')}</ul></section>`
    : '';

// 파이어베이스의 공개 글을 사이트에서 쓰는 모양으로 바꿔요.
// 가져오지 못하면 멈춰요. (그냥 넘어가면 쓴 글이 사이트에서 사라진 채 나갈 수 있어서예요.)
async function loadRemotePosts(provider) {
  const out = [];
  for (const d of await provider.posts()) {
    const cat = catBySlug[d.category];
    if (!cat || cat.private) {
      warnings.push(`파이어베이스 글 ${d.id}: 알 수 없거나 비공개인 카테고리(${d.category})라 건너뛰었어요.`);
      continue;
    }
    const html = d.format === 'html' ? sanitizeHtml(d.body || '') : markdown(d.body || '');
    const th = Number.isInteger(d.thumb) ? d.thumb : hashN(d.id);
    const post = {
      slug: d.slug || d.id,
      id: d.id,
      thumb: th >= 0 && th < 6 ? th : 0,
      img: T.okImg(d.img) ? d.img : '',
      files: cleanFiles(d.files),
      title: d.title || d.id,
      date: d.date || '',
      category: d.category,
      summary: d.summary || '',
      description: d.description || d.summary || excerpt(html),
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
    // 올린 썸네일 이미지는 공유 카드에도 써요(PNG·JPG·WebP·GIF라서 공유에 쓸 수 있어요).
    const imgUrl = seo.imageUrl || (hasImg ? `${SITE_URL}/${imgRel.replace(/^\//, '')}` : '');
    t.push(`<meta property="og:type" content="${seo.type || 'website'}">`);
    t.push(`<meta property="og:site_name" content="${esc(cfg.name)}">`);
    t.push(`<meta property="og:locale" content="ko_KR">`);
    t.push(`<meta property="og:title" content="${esc(title)}">`);
    t.push(`<meta property="og:description" content="${esc(desc)}">`);
    if (canonical) t.push(`<meta property="og:url" content="${esc(canonical)}">`);
    if (imgUrl) {
      t.push(`<meta property="og:image" content="${esc(imgUrl)}">`);
      if (!seo.imageUrl && imgRel === 'assets/og-default.png') t.push('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
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
  // 구글 애널리틱스: 측정 ID(analyticsId)가 있고, 검색에서 빠지는 화면(관리자, 404, @ 알림)이 아닐 때만 넣어요.
  if (/^G-[A-Z0-9]{6,14}$/.test(cfg.analyticsId || '') && !seo.noindex) t.push(`<script src="${root}assets/analytics.js" data-id="${esc(cfg.analyticsId)}"></script>`);
  (seo.jsonld || []).forEach((o) => t.push(`<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`));
  return t.join('\n');
}

// ---- 공통 레이아웃 ----
// 사이드바는 방문자용 메뉴가 기본이에요. 관리자가 로그인하면 assets/admin-app.js가 관리자 메뉴로 바꿔 줘요.
// 관리자 화면(admin/)의 사이드바는 처음부터 비어 있다가 로그인 확인 뒤에 채워져요.
const catsJson = () => JSON.stringify(publicCats.map((c) => ({ slug: c.slug, name: c.label }))).replace(/</g, '\\u003c');
function layout({ title, body, active, root, admin = false, scripts = [], bodyAttr = '', seo = {} }) {
  const items = [
    { href: root + 'about.html', label: 'ABOUT', key: 'about' },
    ...visCats.map((c) => ({ href: `${root}${c.slug}/`, label: c.label, key: c.slug })),
  ];
  const nav = items.map((n) => `<a href="${n.href}"${n.key === active ? ' class="on" aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
  const side = admin
    ? `<nav id="nav" aria-label="관리자 메뉴"></nav>\n<div class="bottom" id="bottom"></div>`
    : `<nav id="nav" aria-label="주 메뉴">${nav}</nav>\n<div class="sidex sidex-d"><div class="cat" hidden></div><div class="wx" hidden aria-live="polite"></div></div>
<div class="bottom" id="bottom"><button type="button" class="linkbtn" id="vlogin">Google 로그인</button><a class="admin" href="${root}admin/login.html" rel="nofollow">관리자 로그인</a></div>`;
  const tags = (admin ? scripts : [...scripts, 'cat.js', 'weather.js']).map((s) => (/^(admin-app|site)\.js$/.test(s) ? `<script type="module" src="${root}assets/${s}"></script>` : `<script src="${root}assets/${s}"></script>`)).join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
${headHtml({ title, root, seo })}
</head>
<body data-root="${root}"${bodyAttr}>
<div class="wrap">
<aside>
<a class="brand" href="${root || './'}">${esc(cfg.name)}</a>
${side}
</aside>
<main>
${body}
${admin ? '' : '<div class="sidex sidex-m"><div class="cat" hidden></div><div class="wx" hidden aria-live="polite"></div></div>\n'}<footer>© ${new Date().getFullYear()} ${esc(cfg.author)} · ${esc(cfg.name)} · <a href="${root}privacy.html">개인정보 처리방침</a></footer>
</main>
</div>
<script type="application/json" id="cats">${catsJson()}</script>
${tags}
</body>
</html>
`;
}

const fmtDate = (d) => d.replace(/-/g, '.');
const timeTag = (d) => (isoDate(d) ? `<time datetime="${d}">${fmtDate(d)}</time>` : `<time>${fmtDate(d)}</time>`);
const isPrivCat = (slug) => !!(catBySlug[slug] && catBySlug[slug].private);
// 조회수 자리: 나만 보기 메뉴의 글에는 만들지 않아요. 숫자는 assets/site.js가 채워요.
const viewsSpan = (p, cls = 'v') => (isPrivCat(p.category) ? '' : `<span class="${cls}" data-views="${esc(p.id)}" hidden></span>`);
const postRow = (p, root) =>
  `<a class="row" data-q="${esc((p.title + ' ' + p.summary).toLowerCase())}" href="${root}posts/${p.slug}.html"><span class="thumb">${T.inner(p)}</span><span class="tag">${esc(catBySlug[p.category].label)}</span><span class="rt"><b>${esc(p.title)}</b><small>${esc(p.summary)}</small></span><span class="meta2">${timeTag(p.date)}${viewsSpan(p)}</span></a>`;

// 글 목록(정렬·검색 포함). assets/list.js가 동작을 붙입니다.
const listBlock = (list, root) => `<div class="tools">
<div class="chips" role="group" aria-label="정렬"><button class="chip" type="button" data-sort="desc" aria-pressed="true">최신순</button><button class="chip" type="button" data-sort="asc" aria-pressed="false">오래된순</button></div>
<label><span class="sr">글 검색</span><input class="search" id="q" type="search" placeholder="제목으로 검색"></label>
</div>
<div class="bar"><span><b>전체보기</b> <span id="count">${list.length}</span>개의 글</span></div>
<div class="list" id="list">${list.length ? list.map((p) => postRow(p, root)).join('') : ''}</div>
<p class="empty" id="empty"${list.length ? ' hidden' : ''}>${list.length ? '검색 결과가 없습니다.' : '아직 글이 없습니다.'}</p>`;

// 만든 페이지는 메모리에 모아 둬요. 명령줄 빌드는 파일로 쓰고, 서버는 요청된 페이지를 바로 돌려줘요.
let OUT = new Map();
const write = (rel, html) => { OUT.set(rel, html); };

const websiteLd = () => {
  const o = { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.name, description: DESC, inLanguage: 'ko' };
  if (SITE_URL) o.url = urlFor('');
  return o;
};

// ---- 빌드 ----
// 모든 페이지를 만들어 { pages: Map(경로 → 내용), warnings, counts }로 돌려줘요.
async function generate(provider) {
  warnings = [];
  OUT = new Map();
  setCats(cfg.categories.filter((c) => !c.private).map((c) => toCat(c, false)));
  await loadMenus(provider);
  const remote = await loadRemotePosts(provider);
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

  // 홈: 메뉴별 최신 글 최대 3개를 콜라주 타일로(글 썸네일이 타일 배경이에요)
  const latest = (slug) => posts.find((p) => p.category === slug);
  const tile = (c, cls, root) => {
    const p = latest(c.slug);
    if (!p) return `<div class="tile ${cls}"><small>${esc(c.label)}</small><span>아직 글이 없어요</span></div>`;
    return `<a class="tile has ${cls}" href="${root}posts/${p.slug}.html"><div class="tbgi">${T.inner(p)}</div><small>${esc(c.label)}</small><span>${esc(p.title)}</span></a>`;
  };
  const vc = visCats.slice(0, 3);
  const collage = vc.length
    ? `<div class="collage"${vc.length < 2 ? ' style="grid-template-columns:1fr"' : ''}>${tile(vc[0], 't1', '')}${vc.length > 1 ? `<div class="col${vc.length === 2 ? ' one' : ''}">${vc.slice(1).map((c, i) => tile(c, i === 0 ? 't2' : 't3', '')).join('')}</div>` : ''}</div>`
    : '';
  write(
    'index.html',
    layout({
      title: `${cfg.name} · AI PM 블로그`,
      active: '',
      root: '',
      scripts: ['boot.js', 'site.js'],
      bodyAttr: ' data-page="public"',
      seo: { description: DESC, rel: '', jsonld: [websiteLd()] },
      body: `<h1 class="hero">${esc(cfg.headline)}</h1>
<p class="tagline">${esc(cfg.tagline)}</p>
${collage}
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
      scripts: ['boot.js', 'list.js', 'site.js'],
      bodyAttr: ' data-page="public"',
      seo: { description: `${cfg.name}에 올린 글 ${posts.length}편의 목록입니다. 포트폴리오와 스터디 노트를 최신순으로 볼 수 있어요.`, rel: 'posts/' },
      body: `<h1 class="ptitle">전체 글</h1>\n${listBlock(posts, '../')}`,
    })
  );

  // 메뉴(카테고리) 페이지
  visCats.forEach((c) => {
    const list = posts.filter((p) => p.category === c.slug);
    write(
      `${c.slug}/index.html`,
      layout({
        title: `${c.title} · ${cfg.name}`,
        active: c.slug,
        root: '../',
        scripts: ['boot.js', 'list.js', 'site.js'],
        bodyAttr: ' data-page="public"',
        seo: { description: `${cfg.name}의 ${c.title} 글 ${list.length}편. ${list[0] ? `최근 글: ${list[0].title}` : '곧 글이 올라와요.'}`, rel: `${c.slug}/` },
        body: `<h1 class="ptitle">${esc(c.title)}</h1>\n${listBlock(list, '../')}`,
      })
    );
  });

  // 글 페이지
  posts.forEach((p, idx) => {
    // 이전·다음 글은 같은 메뉴 안에서만 골라요. (posts는 최신순이라 이전 = 더 오래된 글, 다음 = 더 새 글)
    const sameMenu = posts.filter((x) => x.category === p.category);
    const at = sameMenu.indexOf(p);
    const prev = sameMenu[at + 1];
    const next = sameMenu[at - 1];
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
      if (p.img) ld.image = p.img;
      else if (fs.existsSync(path.join(ROOT, imgRel))) ld.image = `${SITE_URL}/${imgRel.replace(/^\//, '')}`;
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
    const isPriv = !!c.private;
    // 공유하기는 공개 메뉴의 글에만 있어요. 주소는 assets/share.js가 만들어요.
    const share = isPriv
      ? ''
      : `<div class="share"><button class="btn sm" type="button" id="sharebtn" aria-expanded="false" aria-controls="sharep">공유하기</button><div class="sharep" id="sharep" hidden><label class="sr" for="surl">글 주소</label><input id="surl" type="text" readonly value=""><button class="btn sm pri" type="button" id="copybtn">링크 복사</button><span class="hint" id="smsg" role="status" style="width:100%;text-align:center"></span><div class="slinks" id="slinks"></div></div></div>`;
    const remoteId = p.id.startsWith('md-') ? '' : ` data-pid="${esc(p.id)}"`;
    write(
      rel,
      layout({
        title: `${p.title} · ${cfg.name}`,
        active: p.category,
        root: '../',
        scripts: ['boot.js', ...(isPriv ? [] : ['share.js']), 'site.js'],
        bodyAttr: ` data-page="public"${remoteId}`,
        seo: { description: p.description, rel, type: 'article', image: p.image, imageUrl: p.img, published: p.date, jsonld },
        body: `<article class="post">
<a class="tag" href="../${c.slug}/">${esc(c.label)}</a>
<h1>${esc(p.title)}</h1>
<p class="summary">${esc(p.summary)}</p>
<div class="meta3">${timeTag(p.date)}${viewsSpan(p, 'hint')}</div>
${share}
<div class="cover">${T.inner(p)}</div>
<div class="body">${p.html}</div>
${filesBlock(p.files)}
<div class="pn">${prev ? `<a href="${prev.slug}.html" rel="prev">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="${next.slug}.html" rel="next">${esc(next.title)} →</a>` : '<span></span>'}</div>
${isPriv ? '' : `<section class="cms" id="comments" data-post="${esc(p.id)}" aria-labelledby="cmh"><h2 class="sec" id="cmh">댓글</h2><p class="empty">댓글을 불러오는 중…</p></section>`}
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
      scripts: ['boot.js', 'site.js'],
      bodyAttr: ' data-page="public"',
      seo: { description: excerpt(aboutHtml) || DESC, rel: 'about.html', jsonld: aboutLd },
      body: `<article class="post"><h1>${esc(about.meta.title || 'About')}</h1><div class="body">${aboutHtml}</div></article>`,
    })
  );

  // 개인정보 처리방침: privacy.md를 페이지로 만들어요. {{author}}는 작성자 이름으로 바뀌어요.
  const privacy = parseFile(path.join(ROOT, 'privacy.md'));
  const privacyHtml = markdown(privacy.body.replace(/\{\{author\}\}/g, cfg.author));
  write(
    'privacy.html',
    layout({
      title: `${privacy.meta.title || '개인정보 처리방침'} · ${cfg.name}`,
      active: '',
      root: '',
      scripts: ['boot.js', 'site.js'],
      bodyAttr: ' data-page="public"',
      seo: { description: privacy.meta.description || excerpt(privacyHtml), rel: 'privacy.html' },
      body: `<article class="post"><h1>${esc(privacy.meta.title || '개인정보 처리방침')}</h1><div class="body">${privacyHtml}</div></article>`,
    })
  );

  // @ 알림: 로그인한 방문자가 자신을 @로 부른 댓글을 보는 화면이에요. 검색에서는 빠져요.
  write(
    'mentions.html',
    layout({
      title: `@ 알림 · ${cfg.name}`,
      active: '',
      root: '',
      scripts: ['boot.js', 'site.js'],
      bodyAttr: ' data-page="mentions"',
      seo: { noindex: true },
      body: `<h1 class="ptitle">@ 알림</h1><p class="hint" style="margin:0">나를 @로 부른 댓글이에요.</p><div id="mentions"><p class="empty">불러오는 중…</p></div>`,
    })
  );

  // 찾을 수 없는 주소(404). 어느 폴더에서 열려도 깨지지 않게 주소를 /로 시작해요.
  write(
    '404.html',
    layout({
      title: `페이지를 찾을 수 없어요 · ${cfg.name}`,
      active: '',
      root: '/',
      scripts: ['boot.js'],
      seo: { noindex: true },
      body: `<article class="post"><h1>페이지를 찾을 수 없어요</h1><p class="summary">주소가 바뀌었거나 없는 글이에요.</p><p><a class="btn" href="/">홈으로 가기</a></p></article>`,
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
        { rel: 'privacy.html', last: fs.statSync(path.join(ROOT, 'privacy.md')).mtime.toISOString().slice(0, 10) },
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
  // 나만 보기 메뉴(회고)의 이름은 공개되는 이 파일들에 넣지 않아요. 관리자가 로그인한 뒤 데이터베이스에서 불러와요.
  write(
    'admin/login.html',
    `<!doctype html>
<html lang="ko">
<head>
${headHtml({ title: `관리자 로그인 · ${cfg.name}`, root: '../', seo: { noindex: true } })}
</head>
<body class="login" data-page="login" data-root="../">
<div class="lwrap">
<section class="visual"><a class="brand" href="../index.html">${esc(cfg.name)}</a><p>${esc(cfg.headline)}</p><small>글쓰기와 관리는 로그인한 관리자만 할 수 있어요.</small></section>
<section class="panel">
<form id="f" novalidate>
<h1>관리자 로그인</h1>
<p class="sub">글을 쓰고 블로그를 관리하려면 로그인하세요.</p>
<button class="btn gbtn" id="google" type="button"><span class="gdot" aria-hidden="true">G</span> Google 계정으로 로그인</button>
<p class="err" id="err" role="alert"></p>
<a class="back" href="../index.html">← 블로그로 돌아가기</a>
<p class="note">관리자로 지정한 구글 계정만 들어올 수 있어요.</p>
</form>
</section>
</div>
<script type="application/json" id="cats">${catsJson()}</script>
<script type="module" src="../assets/admin-app.js"></script>
</body>
</html>
`
  );

  // 관리자 화면은 모두 같은 틀이에요. 내용은 로그인 확인 뒤 assets/admin-app.js가 채워요.
  [
    ['posts', 'MANAGE POSTS'],
    ['menus', 'MANAGE MENUS'],
    ['write', 'NEW POST'],
    ['list', '글 목록'],
    ['view', '글 보기'],
  ].forEach(([key, label]) => {
    write(
      `admin/${key}.html`,
      layout({
        title: `${label} · ${cfg.name}`,
        active: key,
        root: '../',
        admin: true,
        scripts: ['admin-app.js'],
        bodyAttr: ` data-page="${key}"`,
        seo: { noindex: true },
        body: `<p id="gate" class="empty">로그인 확인 중…</p>\n<div id="adminapp" hidden></div>`,
      })
    );
  });

  // ---- 공개 전에 고쳐야 할 자리표시자 점검 ----
  if (isPlaceholder(cfg.author)) warnings.push('작성자 이름이 자리표시자([이름])예요. 공개 전에 site.config.json의 author를 바꿔 주세요. (구조화 데이터의 작성자 정보도 비어 있어요.)');
  if (cfg.contact && isPlaceholder(cfg.contact)) warnings.push('연락처가 자리표시자예요. 공개 전에 바꾸거나 about.md에서 지워 주세요.');
  if (posts.some((p) => /^\[샘플\]/.test(p.title))) warnings.push('[샘플]이 붙은 글이 있어요. 공개 전에 지워 주세요.');
  return { pages: OUT, warnings, counts: { posts: posts.length, remote: remote.length, local: local.length, cats: visCats.length } };
}

// ---- 명령줄 실행 ----
// node build.js          → 모든 페이지를 dist/에 파일로 만들어요(내 컴퓨터에서 미리 볼 때).
// node build.js --ssr    → dist/에는 이미지·스타일·스크립트만 넣고, 서버(functions/)가 쓸 꾸러미를 만들어요.
async function run() {
  const provider = ARGV.includes('--no-remote') ? noRemoteProvider : restProvider;
  const res = await generate(provider);
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
  if (ARGV.includes('--ssr')) {
    syncFunctions();
    // 서버 함수 틀이 /robots.txt를 가로채서 404를 돌려주므로, 이 파일만은 정적 파일로 올려요.
    if (res.pages.has('robots.txt')) fs.writeFileSync(path.join(DIST, 'robots.txt'), res.pages.get('robots.txt'));
    console.log(`완료(서버에서 그리기): 이미지·스타일·스크립트만 ${DIST}에 두고, 서버 꾸러미를 functions/site에 만들었어요. 글 ${res.counts.posts}개`);
  } else {
    for (const [rel, body] of res.pages) {
      const f = path.join(DIST, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    }
    console.log(`완료: 글 ${res.counts.posts}개 (파이어베이스 ${res.counts.remote}개, 파일 ${res.counts.local}개), 카테고리 ${res.counts.cats}개${WITH_PRIVATE ? ' (나만 보기 글 포함, 올리지 마세요)' : ''} → ${DIST}`);
  }
  if (SITE_URL) console.log(`사이트 주소: ${SITE_URL}`);
  if (res.warnings.length) console.log('\nSEO 점검 알림:\n' + res.warnings.map((w) => ' - ' + w).join('\n'));
}

// 서버가 페이지를 만드는 데 필요한 파일만 functions/site로 복사해요. (functions/ 폴더만 서버에 올라가기 때문이에요.)
function syncFunctions() {
  const dest = path.join(ROOT, 'functions', 'site');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, 'assets'), { recursive: true });
  ['build.js', 'site.config.json', 'about.md', 'privacy.md'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(dest, f)));
  ['markdown.js', 'sanitize.js', 'thumbs.js', 'firebase-config.json', 'og-default.png'].forEach((f) => fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(dest, 'assets', f)));
  fs.mkdirSync(path.join(dest, 'posts'), { recursive: true }); // 서버에서는 파일 글을 쓰지 않아요(비어 있음)
}

module.exports = { generate };

if (CLI) {
  run().catch((e) => {
    console.error('\n빌드 실패: ' + e.message);
    process.exit(1);
  });
}
