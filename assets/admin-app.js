// 관리자 화면의 동작. 파이어베이스 로그인(Authentication), 데이터베이스(Firestore), 파일 저장소(Storage)를 써요.
// 관리자인지는 로그인 정보의 admin 표시(custom claim)로 확인하고, 실제로 막는 일은 firestore.rules와 storage.rules가 해요.
// 같은 파일이 (1) 관리자 화면 6개와 (2) 관리자가 로그인한 채로 보는 공개 화면의 사이드바를 맡아요.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, query, orderBy, where, limit,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref as sref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import './sanitize.js';
import './markdown.js';
import './thumbs.js';
import { IC, aiErr, extractText, checkHtml, panelHtml } from './admin-ai.js';

const { sanitizeHtml, textOf, FAM } = self.IntentSan;
const MD = self.IntentMd;
const TH = self.IntentThumbs;

const cfg = await (await fetch(new URL('./firebase-config.json', import.meta.url))).json();
const app = initializeApp(cfg, 'admin');
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const body = document.body;
const page = body.dataset.page;
const root = body.dataset.root || '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fd = (d) => String(d || '').replace(/-/g, '.');
const today = () => new Date().toLocaleDateString('sv-SE');
const params = new URLSearchParams(location.search);
const setHint = (on) => { try { on ? localStorage.setItem('intentAdmin', '1') : localStorage.removeItem('intentAdmin'); } catch (e) { /* 무시 */ } };

const firstUser = () => new Promise((resolve) => { const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); }); });
const isAdmin = async (user) => (await user.getIdTokenResult()).claims.admin === true;

function authMsg(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '로그인 창이 닫혔어요. 다시 눌러 주세요.';
  if (c === 'auth/popup-blocked') return '팝업이 막혀 있어요. 팝업을 허용한 뒤 다시 눌러 주세요.';
  if (c === 'auth/unauthorized-domain') return '이 주소에서는 구글 로그인을 쓸 수 없어요. 파이어베이스의 승인된 도메인에 이 주소를 추가해야 해요.';
  if (c === 'auth/operation-not-allowed') return '구글 로그인이 아직 켜져 있지 않아요. 파이어베이스에서 구글 로그인을 켜 주세요.';
  if (c === 'auth/too-many-requests') return '시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.';
  if (c === 'auth/network-request-failed') return '인터넷 연결을 확인해 주세요.';
  return '로그인하지 못했어요. 잠시 뒤에 다시 해 주세요.';
}
function dbMsg(e) {
  const c = (e && e.code) || '';
  if (c === 'permission-denied' || c === 'storage/unauthorized') return '권한이 없어요. 관리자로 다시 로그인해 주세요.';
  if (c === 'unavailable' || c === 'storage/retry-limit-exceeded') return '인터넷 연결을 확인해 주세요.';
  if (c === 'storage/bucket-not-found' || c === 'storage/project-not-found') return '이미지 저장소가 아직 준비되지 않았어요. 파이어베이스 콘솔에서 Storage를 시작해 주세요.';
  return '저장하지 못했어요. 잠시 뒤에 다시 해 주세요.';
}

// ---------- 로그인 ----------
if (page === 'login') {
  const err = $('err'), btn = $('google');
  if (params.get('denied')) err.textContent = '이 계정에는 관리자 권한이 없어요.';
  const u = await firstUser();
  if (u && (await isAdmin(u))) { setHint(true); location.replace('posts.html'); }
  // 관리자는 구글 계정으로 로그인해요. 로그인한 계정에 admin 표시가 있어야만 들어갈 수 있어요.
  btn.addEventListener('click', async () => {
    btn.disabled = true; err.textContent = '';
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      if (!(await isAdmin(cred.user))) {
        await signOut(auth); setHint(false);
        err.textContent = '이 구글 계정에는 관리자 권한이 없어요. 관리자로 지정한 계정으로 로그인해 주세요.';
        btn.disabled = false;
        return;
      }
      setHint(true);
      sessionStorage.setItem('flash', JSON.stringify(['로그인했어요. 관리자 페이지에서 블로그를 관리하세요.', false]));
      location.replace('posts.html');
    } catch (ex) { err.textContent = authMsg(ex); btn.disabled = false; }
  });
}

// ---------- 공통: 로그인 확인, 메뉴, 사이드바 ----------
const embedded = JSON.parse(($('cats') || { textContent: '[]' }).textContent); // 공개 메뉴 [{slug,name}]
let cats = []; // 모든 메뉴(공개 + 나만 보기), 정한 순서대로 [{slug,name,priv}]
const catOf = (slug) => cats.find((c) => c.slug === slug);
const catName = (slug) => (catOf(slug) ? catOf(slug).name : '(삭제된 메뉴)');
const isPrivCat = (slug) => !!(catOf(slug) && catOf(slug).priv);
const nm = (c) => c.name || c.label || c.title || c.slug;

async function loadMenus() {
  let pub = embedded, priv = [], order = [];
  try { const m = await getDoc(doc(db, 'settings', 'menus')); if (m.exists() && Array.isArray(m.data().categories)) pub = m.data().categories; } catch (e) { /* 빌드 때 넣어 둔 메뉴를 써요 */ }
  try {
    const p = await getDoc(doc(db, 'settings', 'private'));
    if (p.exists()) { priv = Array.isArray(p.data().categories) ? p.data().categories : []; order = Array.isArray(p.data().order) ? p.data().order : []; }
  } catch (e) { /* 나만 보기 메뉴가 없는 것으로 봐요 */ }
  const all = [...pub.map((c) => ({ slug: c.slug, name: nm(c), priv: false })), ...priv.map((c) => ({ slug: c.slug, name: nm(c), priv: true }))];
  const idx = (s) => { const i = order.indexOf(s); return i < 0 ? 999 : i; };
  cats = all.map((c, i) => [c, i]).sort((a, b) => idx(a[0].slug) - idx(b[0].slug) || a[1] - b[1]).map((x) => x[0]);
}

async function persistMenus() {
  const pub = cats.filter((c) => !c.priv), priv = cats.filter((c) => c.priv);
  const b = writeBatch(db);
  b.set(doc(db, 'settings', 'private'), { categories: priv.map((c) => ({ slug: c.slug, name: c.name })), slugs: priv.map((c) => c.slug), order: cats.map((c) => c.slug) });
  b.set(doc(db, 'settings', 'menus'), { categories: pub.map((c) => ({ slug: c.slug, name: c.name })), updatedAt: serverTimestamp() });
  await b.commit();
}

let user = null;
async function requireAdmin() {
  user = await firstUser();
  if (!user) { setHint(false); location.replace(root + 'admin/login.html'); return false; }
  if (!(await isAdmin(user))) { await signOut(auth); setHint(false); location.replace(root + 'admin/login.html?denied=1'); return false; }
  setHint(true);
  return true;
}

function renderSidebar(active) {
  const a = (href, label, key, cls) => `<a${cls ? ` class="${cls}${active === key ? ' on' : ''}"` : active === key ? ' class="on"' : ''} href="${root}admin/${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  $('nav').setAttribute('aria-label', '관리자 메뉴');
  $('nav').innerHTML =
    a('list.html', 'ALL POSTS', 'all') + cats.map((c) => a('list.html?cat=' + encodeURIComponent(c.slug), esc(c.name), 'cat:' + c.slug)).join('') +
    '<span class="sep" role="presentation"></span>' + a('write.html', 'NEW POST', 'write') +
    '<span class="grp">ADMIN</span>' + a('menus.html', 'MANAGE MENUS', 'menus', 'subl') + a('posts.html', 'MANAGE POSTS', 'posts', 'subl') + a('retro.html', 'RETRO SUMMARY', 'retro', 'subl') + a('ai.html', 'AI USAGE', 'ai', 'subl');
  $('bottom').innerHTML = `<span class="who">로그인: 관리자</span><a href="${root}index.html">블로그 보기</a><button type="button" class="linkbtn" id="logout">로그아웃</button>`;
  $('logout').addEventListener('click', async () => { await signOut(auth); setHint(false); location.href = root + 'index.html'; });
}

// 화면을 옮길 때 보여 줄 안내 문구
const takeFlash = () => { try { const f = JSON.parse(sessionStorage.getItem('flash') || 'null'); sessionStorage.removeItem('flash'); return f; } catch (e) { return null; } };
const sendFlash = (msg, warn) => { try { sessionStorage.setItem('flash', JSON.stringify([msg, !!warn])); } catch (e) { /* 무시 */ } };
let flash = takeFlash();
const say = (msg, warn) => { flash = [msg, !!warn]; };
const notice = () => { const f = flash; flash = null; return f ? `<p class="notice${f[1] ? ' warn' : ''}" role="${f[1] ? 'alert' : 'status'}">${esc(f[0])}</p>` : ''; };
const MAX_IMG = 10485760; // 이미지 한 장의 한도(10MB). storage.rules의 값과 같아야 해요.
// 첨부 파일: 확장자 허용 목록과 한도. storage.rules의 값(25MB, 확장자)과 같아야 해요.
const MAX_FILE = 26214400, MAX_FILES = 5;
const FILE_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
  zip: 'application/zip', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();
const cleanFiles = (arr) => (Array.isArray(arr) ? arr : []).filter((f) => f && typeof f.name === 'string' && typeof f.url === 'string').map((f) => ({ name: f.name, url: f.url, size: Number(f.size) || 0, ...(typeof f.summary === 'string' && f.summary.trim() ? { summary: f.summary.trim().slice(0, 300), ai: f.ai === true } : {}) }));
const filesHtml = (files) => (files && files.length ? `<section class="files" aria-labelledby="fh"><h2 class="sec" id="fh">첨부 파일</h2><ul>${files.map((f) => `<li><a href="${esc(f.url)}" rel="noopener noreferrer">${esc(f.name)}</a> <small>${fmtSize(f.size)} · ${esc(extOf(f.name).toUpperCase())}</small></li>`).join('')}</ul></section>` : '');
const dropFiles = (files) => Promise.all((files || []).map((f) => deleteObject(sref(storage, f.url)).catch(() => {}))); // 저장소 파일 지우기(이미 없으면 넘어가요)
const NOTE_DEPLOY = ''; // 글·메뉴 변경은 서버가 방문할 때 최신으로 그려서 따로 배포하지 않아도 바로 반영돼요.

// ---------- 글 데이터 ----------
let posts = [], views = {};
async function loadPosts() {
  const snap = await getDocs(query(collection(db, 'posts'), orderBy('date', 'desc')));
  posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  try { views = {}; (await getDocs(collection(db, 'views'))).forEach((d) => { views[d.id] = Number(d.data().count) || 0; }); } catch (e) { views = {}; }
}
const sorted = () => posts.slice().sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
const thumbHtml = (p, cls = '') => `<span class="thumb ${cls}">${TH.inner(p)}</span>`;
const lock = (p) => (p.visibility === 'private' ? '<span class="lock">나만 보기</span>' : '');
const viewsOf = (p) => (isPrivCat(p.category) ? '-' : String(views[p.id] || 0));
const adminHead = (title) => `<div class="head"><div><p class="hint" style="margin:0">관리자 페이지</p><h1 class="ptitle">${title}</h1></div><a class="btn pri" href="${root}admin/write.html">새 글 쓰기</a></div>`;
const bodyHtml = (p) => (p.format === 'html' ? sanitizeHtml(p.body) : MD.markdown(p.body || ''));

// 글이 지워지거나 나만 보기로 바뀌면 그 글의 댓글도 지워요. (나만 보기 글의 댓글이 주소만 알면 읽히는 일을 막아요.)
async function deleteComments(postId) {
  const cs = await getDocs(query(collection(db, 'comments'), where('post', '==', postId)));
  await Promise.all(cs.docs.map((d) => deleteDoc(d.ref)));
  return cs.size;
}
async function removePost(p) {
  let files = p.files;
  if (!files) { try { const s = await getDoc(doc(db, 'posts', p.id)); files = s.exists() ? cleanFiles(s.data().files) : []; } catch (e) { files = []; } }
  await deleteDoc(doc(db, 'posts', p.id));
  try { await dropFiles(files); } catch (e) { /* 파일이 남아도 글 삭제는 끝난 상태예요 */ }
  try { await deleteDoc(doc(db, 'views', p.id)); } catch (e) { /* 조회수 문서가 없으면 넘어가요 */ }
  try { await deleteComments(p.id); } catch (e) { /* 댓글이 없거나 지우지 못해도 글 삭제는 끝난 상태예요 */ }
}

const main = $('adminapp');
const show = (html) => { $('gate').hidden = true; main.hidden = false; main.innerHTML = html; };
let delArm = '', aCat = 'all', aVis = 'all', aq = '', sort = 'desc', q = '', menuDel = '';
const armReset = (key, cb) => setTimeout(() => { if (key() ) { cb(); } }, 3500);

// ---------- 글 관리 (MANAGE POSTS) ----------
function mrows() {
  const w = aq.trim().toLowerCase();
  const v = sorted().filter((p) => (aCat === 'all' || p.category === aCat) && (aVis === 'all' || p.visibility === aVis) && (!w || (p.title + ' ' + (p.summary || '')).toLowerCase().includes(w)));
  if (!v.length) return { n: 0, html: '<tr><td colspan="6"><p class="empty" style="padding:12px 0">조건에 맞는 글이 없어요.</p></td></tr>' };
  return {
    n: v.length,
    html: v.map((p) => {
      const fixed = isPrivCat(p.category);
      const toggle = fixed ? '' : `<button class="btn sm" type="button" data-a="toggle" data-id="${esc(p.id)}">${p.visibility === 'public' ? '나만 보기로' : '공개로'}</button>`;
      return `<tr><td class="t">${thumbHtml(p, 'sm')}<a href="${root}admin/view.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></td><td>${esc(catName(p.category))}</td><td><span class="badge${p.visibility === 'private' ? ' pv' : ''}">${p.visibility === 'public' ? '공개' : '나만 보기'}${fixed ? ' · 고정' : ''}</span></td><td class="d">${fd(p.date)}</td><td class="d">${viewsOf(p)}</td><td><div class="acts"><a class="btn sm" href="${root}admin/write.html?id=${encodeURIComponent(p.id)}">수정</a>${toggle}<button class="btn sm danger${delArm === p.id ? ' sure' : ''}" type="button" data-a="del" data-id="${esc(p.id)}">${delArm === p.id ? '정말 삭제할까요?' : '삭제'}</button></div></td></tr>`;
    }).join(''),
  };
}
function postsPage() {
  const chip = (a, cur, val, label) => `<button class="chip" type="button" data-a="${a}" data-v="${esc(val)}" aria-pressed="${cur === val}">${label}</button>`;
  const r = mrows();
  show(notice() + adminHead('글 관리') +
    `<section class="section"><div class="fgroup"><div class="chips" role="group" aria-label="카테고리 필터"><span class="flabel">카테고리</span>${chip('acat', aCat, 'all', '전체')}${cats.map((c) => chip('acat', aCat, c.slug, esc(c.name))).join('')}</div><div class="chips" role="group" aria-label="공개 범위 필터"><span class="flabel">공개 범위</span>${chip('avis', aVis, 'all', '전체')}${chip('avis', aVis, 'public', '공개')}${chip('avis', aVis, 'private', '나만 보기')}</div><label><span class="sr">글 검색</span><input class="search" id="aq" type="search" placeholder="제목으로 검색" value="${esc(aq)}"></label></div>` +
    `<div class="bar"><span><b>글 목록</b> <span id="acount">${r.n}</span>개</span></div><div class="tblwrap"><table class="tbl"><thead><tr><th scope="col">제목</th><th scope="col">카테고리</th><th scope="col">공개 범위</th><th scope="col">날짜</th><th scope="col">조회수</th><th scope="col"><span class="sr">작업</span></th></tr></thead><tbody id="arows">${r.html}</tbody></table></div></section>`);
}

// ---------- 메뉴 관리 (MANAGE MENUS) ----------
function menuRows() {
  return cats.map((c, i) => {
    const n = posts.filter((p) => p.category === c.slug).length;
    return `<tr><td><label><span class="sr">메뉴 이름</span><input class="mname" type="text" maxlength="12" data-mname="${esc(c.slug)}" value="${esc(c.name)}"></label></td>` +
      `<td><label class="chk"><input type="checkbox" data-mpriv="${esc(c.slug)}"${c.priv ? ' checked' : ''}> 나만 보기 메뉴</label></td><td class="d">글 ${n}개</td>` +
      `<td><div class="acts"><button class="btn sm" type="button" data-a="mup" data-id="${esc(c.slug)}" aria-label="${esc(c.name)} 위로"${i === 0 ? ' disabled' : ''}>↑</button><button class="btn sm" type="button" data-a="mdown" data-id="${esc(c.slug)}" aria-label="${esc(c.name)} 아래로"${i === cats.length - 1 ? ' disabled' : ''}>↓</button><button class="btn sm danger${menuDel === c.slug ? ' sure' : ''}" type="button" data-a="mdel" data-id="${esc(c.slug)}">${menuDel === c.slug ? '정말 삭제할까요?' : '삭제'}</button></div></td></tr>`;
  }).join('');
}
function menusPage() {
  show(notice() + adminHead('메뉴 관리') +
    `<section class="section"><p class="hint" style="margin:0">여기서 정한 이름이 사이드바, 글 목록, 글쓰기, 글 관리 필터에 똑같이 쓰여요. 영문 대문자로 쓰면 사이드바와 가장 잘 어울려요.</p>` +
    `<div class="tblwrap"><table class="tbl"><thead><tr><th scope="col">메뉴 이름</th><th scope="col">공개 설정</th><th scope="col">글</th><th scope="col"><span class="sr">작업</span></th></tr></thead><tbody>${cats.length ? menuRows() : '<tr><td colspan="4"><p class="empty" style="padding:12px 0">메뉴가 없어요. 아래에서 추가하세요.</p></td></tr>'}</tbody></table></div>` +
    `<form class="addrow" id="mf" novalidate><label class="field" for="mnew">새 메뉴 이름<input id="mnew" type="text" maxlength="12" placeholder="예: PROJECT"></label><button class="btn pri" type="submit">메뉴 추가</button></form></section>`);
}
async function menuSave(okMsg) {
  try { await persistMenus(); say(okMsg); } catch (e) { say(dbMsg(e), true); await loadMenus(); }
  renderSidebar(sideKey); menusPage();
}
const slugFor = (name) => {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  if (!s || catOf(s)) s = 'menu-' + Date.now().toString(36);
  return s;
};

// ---------- 글 목록 (사이드바의 ALL POSTS와 메뉴) ----------
function listBody() {
  const cat = params.get('cat');
  const c = cat ? catOf(cat) : null;
  const w = q.trim().toLowerCase();
  let v = sorted().filter((p) => (!cat || p.category === cat) && (!w || (p.title + ' ' + (p.summary || '')).toLowerCase().includes(w)));
  if (sort === 'asc') v = v.slice().reverse();
  return `<div class="bar"><span><b>전체보기</b> <span id="lcount">${v.length}</span>개의 글</span></div><div id="rows">${v.length ? v.map((p) => `<a class="row" href="${root}admin/view.html?id=${encodeURIComponent(p.id)}">${thumbHtml(p)}<span class="tag">${esc(catName(p.category))}</span><span class="rt"><b>${esc(p.title)}${lock(p)}</b><small>${esc(p.summary || '')}</small></span><span class="meta2"><time>${fd(p.date)}</time>${isPrivCat(p.category) ? '' : `<span class="v">조회 ${views[p.id] || 0}</span>`}</span></a>`).join('') : `<p class="empty">${w ? '검색 결과가 없습니다.' : '아직 글이 없습니다.'}</p>`}</div>`;
}
function listPage() {
  const cat = params.get('cat');
  if (cat && !catOf(cat)) { show('<h1 class="ptitle">메뉴를 찾을 수 없어요</h1><p class="empty">삭제되었거나 없는 메뉴예요.</p><p><a class="btn" href="posts.html">글 관리로</a></p>'); return; }
  show(notice() + `<h1 class="ptitle">${cat ? esc(catName(cat)) : '전체 글'}</h1><div class="tools"><div class="chips" role="group" aria-label="정렬"><button class="chip" type="button" data-a="sort" data-v="desc" aria-pressed="${sort === 'desc'}">최신순</button><button class="chip" type="button" data-a="sort" data-v="asc" aria-pressed="${sort === 'asc'}">오래된순</button></div><label><span class="sr">글 검색</span><input class="search" id="q" type="search" placeholder="제목으로 검색" value="${esc(q)}"></label></div><div id="lbody">${listBody()}</div>`);
}

// ---------- 글 보기 ----------
// 같은 메뉴 안의 이전(더 오래된 글)·다음(더 새 글) 링크. 관리자는 나만 보기 글까지 모두 이어서 봐요.
function neighborsHtml(p) {
  const same = sorted().filter((x) => x.category === p.category);
  const at = same.findIndex((x) => x.id === p.id);
  const prev = same[at + 1], next = same[at - 1];
  const link = (x, rel, arrow) => `<a href="view.html?id=${encodeURIComponent(x.id)}" rel="${rel}">${rel === 'prev' ? '← ' : ''}${esc(x.title)}${lock(x)}${rel === 'next' ? ' →' : ''}</a>`;
  return `<div class="pn">${prev ? link(prev, 'prev') : '<span></span>'}${next ? link(next, 'next') : '<span></span>'}</div>`;
}
function viewPage() {
  const p = posts.find((x) => x.id === params.get('id'));
  if (!p) { show('<h1 class="ptitle">글을 찾을 수 없어요</h1><p class="empty">삭제되었거나 없는 글이에요.</p><p><a class="btn" href="posts.html">글 관리로</a></p>'); return; }
  sideKey = 'cat:' + p.category; renderSidebar(sideKey);
  const bar = `<div class="adminbar" role="region" aria-label="관리자 메뉴"><span>관리자로 보는 중 · ${p.visibility === 'public' ? '공개글' : '나만 보기'}</span><div><a class="btn sm" href="posts.html">관리자 페이지</a><a class="btn sm" href="write.html?id=${encodeURIComponent(p.id)}">수정</a><button class="btn sm danger${delArm === p.id ? ' sure' : ''}" type="button" data-a="vdel" data-id="${esc(p.id)}">${delArm === p.id ? '정말 삭제할까요?' : '삭제'}</button></div></div>`;
  show(bar + notice() + `<article class="post"><a class="tag" href="list.html?cat=${encodeURIComponent(p.category)}">${esc(catName(p.category))}</a><h1>${esc(p.title)}${lock(p)}</h1><p class="summary">${esc(p.summary || '')}</p><div class="meta3"><time>${fd(p.date)}</time>${isPrivCat(p.category) ? '' : `<span class="hint">조회 ${views[p.id] || 0}</span>`}</div>${TH.none(p) ? '' : `<div class="cover">${TH.inner(p)}</div>`}<div class="body">${bodyHtml(p)}</div>${filesHtml(cleanFiles(p.files))}${neighborsHtml(p)}${isPrivCat(p.category) || p.visibility !== 'public' ? '<p class="hint" style="margin-top:32px">나만 보기 글에는 댓글이 달리지 않아요.</p>' : ''}</article>`);
}

// ---------- 글쓰기·수정 (NEW POST) ----------
// 회고 정리에서 보낸 초안(마크다운)을 글 본문으로 바꿔요. 한 번 쓰면 지워요.
function retroInit() {
  const none = { html: '', title: '', sum: '', desc: '' };
  if (!params.get('retro')) return none;
  try {
    const raw = sessionStorage.getItem('intentRetro') || ''; sessionStorage.removeItem('intentRetro');
    if (!raw) return none;
    const r = JSON.parse(raw);
    return { html: r.body ? sanitizeHtml(MD.markdown(r.body)) : '', title: String(r.title || '').slice(0, 120), sum: String(r.summary || '').slice(0, 300), desc: String(r.description || '').slice(0, 300) };
  } catch (e) { return none; }
}
// 저장된 3줄 요약 상태. 승인했어도 본문이 그 뒤에 바뀌었다면(지문이 다르면) 승인을 풀어서 보여 줘요.
function aiOf(p) {
  const lines = Array.isArray(p.aiSummary) ? p.aiSummary.filter((t) => typeof t === 'string').slice(0, 3) : [];
  const fresh = p.aiSummaryOn === true && p.aiSummaryFor === IC.hash(IC.plain(sanitizeHtml(bodyHtml(p))));
  return { lines, on: fresh, for: fresh ? p.aiSummaryFor : '' };
}
let draft = null, wtab = 'write', existing = null, savedRange = null, uploading = false, attaching = false;
// AI 도우미 상태: 요청 중인 기능(busy), 안내 글(msg), 글쓰기 보조 제안(sug), AI가 찾은 점검 항목(aiHits), 점검 목록 보이기(showChk), "확인했어요" 표시(acks)
const ai = { busy: '', msg: '', tab: '', sug: null, aiHits: [], aiNote: '', chkRan: false, showChk: false, acks: {} };
const fileText = new Map(); // 첨부 파일 주소 → 요약에 쓸 글자(이번에 올린 파일만 있어요)
const logAi = (kind, feature) => addDoc(collection(db, 'aiLogs'), { kind, feature, post: existing ? existing.id : '', at: serverTimestamp() }).catch(() => {}); // 기록이 안 돼도 글쓰기는 계속돼요
async function aiCall(action, input) {
  const u = auth.currentUser;
  if (!u) throw new Error(aiErr('FORBIDDEN'));
  let res;
  try { res = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await u.getIdToken()) }, body: JSON.stringify({ action, input }) }); } catch (e) { throw new Error(aiErr('')); }
  let j = {}; try { j = await res.json(); } catch (e) { /* 본문이 없어도 돼요 */ }
  if (!res.ok) throw new Error(aiErr(j.error));
  return j.result;
}
const edEl = () => $('wed');
function syncDraft() {
  if (!draft || !$('wtitle')) return;
  draft.title = $('wtitle').value; draft.cat = $('wcat').value; draft.sum = $('wsum').value; draft.date = $('wdate').value; if ($('wdesc')) draft.desc = $('wdesc').value;
  document.querySelectorAll('[data-fsum]').forEach((el) => { const f = draft.files[Number(el.dataset.fsum)]; if (f) { f.summary = el.value; if (!el.value.trim()) f.ai = false; } });
  document.querySelectorAll('.ail').forEach((el, i) => { if (draft.ai.lines[i] !== undefined) draft.ai.lines[i] = el.value; });
  if ($('aion')) draft.ai.on = $('aion').checked;
  const ed = edEl(); if (ed) draft.html = ed.innerHTML;
}
function thumbPicker(d) {
  const bs = TH.THUMBS.map((sv, i) => `<button type="button" class="thb" data-a="thumb" data-v="${i}" aria-label="썸네일 모양 ${i + 1}" aria-pressed="${!d.img && d.thumb === i}">${sv}</button>`).join('');
  return `<div class="field" id="thl">썸네일<div class="thpick"><div class="thcur">${TH.none(d) ? '<span class="thumb none">없음</span>' : thumbHtml(d)}</div><button type="button" class="thb thnone" data-a="thumb" data-v="-1" aria-label="썸네일 없음" aria-pressed="${!d.img && d.thumb === -1}">없음</button>${bs}<label class="thfile btn sm" for="thfile">${uploading ? '올리는 중…' : '이미지 올리기'}</label><input class="sr" id="thfile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"${uploading ? ' disabled' : ''}>${d.img ? '<button type="button" class="btn sm" data-a="thumbclear">올린 이미지 지우기</button>' : ''}</div><span class="hint">모양을 고르거나, “없음”을 고르거나, 내 이미지(PNG, JPG, WebP, GIF, 10MB 이하)를 올려요.</span></div>`;
}
function filePicker(d) {
  const items = d.files.map((f, i) => `<li><span class="fname">${esc(f.name)}</span> <small>${fmtSize(f.size)}</small> <button type="button" class="btn sm" data-a="fdel" data-v="${i}" aria-label="${esc(f.name)} 빼기">빼기</button>${fileText.has(f.url) ? ` <button type="button" class="btn sm" data-a="aifile" data-v="${i}"${ai.busy ? ' disabled' : ''}>${ai.busy === 'aifile' + i ? '요약 중…' : 'AI 요약'}</button>` : ''}${f.summary !== undefined ? `<div class="fsum"><label for="fs${i}">방문자에게 보일 요약${f.ai ? ' <span class="aib">AI</span>' : ''} <small>(고쳐 써도 돼요. 비우면 요약 없이 올라가요)</small></label><input id="fs${i}" data-fsum="${i}" type="text" maxlength="300" value="${esc(f.summary)}"></div>` : ''}</li>`).join('');
  const full = d.files.length >= MAX_FILES;
  return `<div class="field" id="fl">첨부 파일${items ? `<ul class="flist">${items}</ul>` : ''}<div class="thpick"><label class="thfile btn sm" for="ffile"${full ? ' aria-disabled="true"' : ''}>${attaching ? '올리는 중…' : '파일 올리기'}</label><input class="sr" id="ffile" type="file" accept="${Object.keys(FILE_TYPES).map((x) => '.' + x).join(',')}"${attaching || full ? ' disabled' : ''}><span class="hint" id="fnote" role="status">${full ? '파일은 글당 ' + MAX_FILES + '개까지예요.' : ''}</span></div><span class="hint">방금 올린 PDF·텍스트 파일은 “AI 요약”으로 방문자용 요약을 만들 수 있어요.</span><span class="hint">PDF, 문서(Word·Excel·PowerPoint·한글), 텍스트, 압축(zip), 이미지 · 파일당 25MB 이하 · 글당 5개까지. 실행 파일과 HTML은 올릴 수 없어요. 방문자는 공개 글에서 내려받을 수 있어요.</span></div>`;
}
function toolbarHtml() {
  const b = (v, label, title) => `<button type="button" class="tbb" data-a="fmt" data-v="${v}" title="${title}" aria-label="${title}">${label}</button>`;
  const sel = (k, label, opts) => `<label class="tbs"><span class="sr">${label}</span><select data-tb="${k}"><option value="">${label}</option>${opts.map((o) => `<option value="${esc(o[0])}">${o[1]}</option>`).join('')}</select></label>`;
  return '<div class="tb" role="toolbar" aria-label="글 서식">' +
    `<div class="tbg">${sel('font', '글꼴', [[FAM.sans, '고딕'], [FAM.serif, '명조'], [FAM.disp, 'Cormorant'], [FAM.mono, '고정폭']])}${sel('size', '크기', [['14px', '작게 14'], ['16px', '보통 16'], ['20px', '크게 20'], ['28px', '아주 크게 28'], ['36px', '제목 36']])}${sel('weight', '굵기', [['300', '가늘게'], ['400', '보통'], ['500', '중간'], ['700', '굵게']])}</div>` +
    `<div class="tbg">${b('bold', '<b>B</b>', '굵게')}${b('italic', '<i>I</i>', '기울임')}${b('underline', '<u>U</u>', '밑줄')}${b('strike', '<s>S</s>', '취소선')}${sel('color', '글자색', [['#222222', '검정'], ['#b5573f', '테라코타'], ['#2f4a6d', '파랑'], ['#3f5d4a', '초록'], ['#767676', '회색']])}</div>` +
    `<div class="tbg">${b('h2', '제목', '제목 크기로')}${b('h3', '소제목', '소제목 크기로')}${b('p', '본문', '본문으로')}</div>` +
    `<div class="tbg">${b('left', '왼쪽', '왼쪽 정렬')}${b('center', '가운데', '가운데 정렬')}${b('right', '오른쪽', '오른쪽 정렬')}</div>` +
    `<div class="tbg">${b('ul', '• 목록', '글머리 목록')}${b('ol', '1. 목록', '번호 목록')}${b('quote', '인용', '인용')}${b('link', '링크', '링크 넣기')}${b('image', '이미지', '본문에 이미지 넣기')}${b('clear', '서식 지우기', '서식 지우기')}</div></div>` +
    '<p class="hint" id="tbnote" role="status" hidden></p>' +
    '<div class="imgrow" id="imgrow" hidden><label class="sr" for="imgfile">본문에 넣을 이미지</label><input id="imgfile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><label class="sr" for="imgalt">이미지 설명</label><input id="imgalt" type="text" maxlength="200" placeholder="이미지 설명(대체 글): 눈이 불편한 분과 검색에 쓰여요"><button type="button" class="btn sm" data-a="imgcancel">닫기</button><span class="hint" id="imgnote" role="status"></span></div>' +
    '<div class="linkrow" id="linkrow" hidden><label class="sr" for="linkurl">링크 주소</label><input id="linkurl" type="url" placeholder="https://"><button type="button" class="btn sm pri" data-a="linkok">적용</button><button type="button" class="btn sm" data-a="linkcancel">취소</button></div>';
}
// 지금 글에서 찾은 점검 항목: 규칙(항상) + AI가 찾아 준 것 중 지금 글에 아직 있는 문장
function liveHits(d) {
  const text = IC.plain(sanitizeHtml(d.html));
  return IC.run(text).concat(IC.fromAi(ai.aiHits, text));
}
const bodyText = () => { syncDraft(); return IC.plain(sanitizeHtml(draft.html)); };
const aiRender = () => { syncDraft(); writePage(); const el = $('aip'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); };
async function runAi(feature, action, input, onOk) {
  ai.busy = feature; ai.msg = ''; aiRender();
  try { onOk(await aiCall(action, input)); logAi('suggest', feature); } catch (e) { ai.msg = e.message; }
  ai.busy = ''; aiRender();
}

// AI 도우미 탭: 이미 만든 결과가 있으면 그대로 보여 주고, 없을 때만 새로 만들어요. [새로고침]은 airef가 강제로 다시 만들어요.
const aiHas = (t) => (t === 'sug' ? !!ai.sug : t === 'chk' ? ai.chkRan : draft.ai.lines.length > 0);
function aiPick(t) { syncDraft(); ai.tab = t; ai.msg = ''; if (aiHas(t)) aiRender(); else aiRun(t); }
async function aiRun(t) {
  const body = bodyText();
  if (t === 'sug') return runAi('aisug', 'suggest', { body }, (r) => { ai.sug = r; ai.msg = '제안을 가져왔어요.'; });
  if (t === 'tl') return runAi('aitl', 'tldr', { body }, (r) => { syncDraft(); draft.ai.lines = r.lines || []; draft.ai.on = false; draft.ai.for = ''; ai.msg = r.lines && r.lines.length ? '3줄 요약을 만들었어요. 고쳐 쓰고 체크하면 공개 글에 보여요.' : '요약을 만들지 못했어요. 다시 눌러 주세요.'; });
  ai.showChk = true; ai.busy = 'aichk'; ai.msg = ''; aiRender();
  try { const r = await aiCall('check', { body }); ai.aiHits = r.items || []; ai.aiNote = 'AI가 실명·내부 자료로 보이는 표현도 살펴봤어요. AI는 놓칠 수 있으니 마지막 확인은 내가 해요.'; logAi('suggest', 'aichk'); }
  catch (e) { ai.aiHits = []; ai.aiNote = e.message + ' (규칙 점검 결과만 보여 드려요.)'; }
  ai.chkRan = true; ai.busy = ''; aiRender();
}
function writePage() {
  if (!cats.length) { show('<h1 class="ptitle">새 글 쓰기</h1><p class="notice warn" role="alert">글을 올릴 메뉴가 없어요. 메뉴 관리에서 메뉴를 먼저 추가하세요.</p><p><a class="btn" href="menus.html">메뉴 관리로</a></p>'); return; }
  const d = draft;
  const fixed = isPrivCat(d.cat); if (fixed) d.vis = 'private';
  const visHtml = fixed
    ? `<div class="field">공개 범위<p class="fixed">나만 보기 (고정)</p><span class="hint">“${esc(catName(d.cat))}” 메뉴는 항상 나만 볼 수 있어요. 공개로 바꿀 수 없어요.</span></div>`
    : `<div class="field" id="vl">공개 범위<div class="vis" role="group" aria-labelledby="vl"><button type="button" data-a="vis" data-v="public" aria-pressed="${d.vis === 'public'}">공개글</button><button type="button" data-a="vis" data-v="private" aria-pressed="${d.vis === 'private'}">나만 보기</button></div><span class="hint">${d.vis === 'public' ? '누구나 읽을 수 있어요.' : '로그인한 관리자만 볼 수 있어요.'}</span></div>`;
  const opts = cats.map((c) => `<option value="${esc(c.slug)}"${d.cat === c.slug ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const clean = sanitizeHtml(d.html);
  const edit = wtab === 'write'
    ? toolbarHtml() + `<div id="wed" class="ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="본문" data-ph="본문을 입력하세요. 글자를 선택한 뒤 위의 도구로 서식을 바꿔요.">${clean}</div>`
    : `<div class="preview">${textOf(clean) || /<img /.test(clean) ? clean : '<p style="color:var(--mute)">미리 볼 내용이 없어요.</p>'}</div>`;
  const editing = !!existing;
  const aiPanel = panelHtml(d, { ...ai, pub: d.vis === 'public' && !isPrivCat(d.cat) }, checkHtml(liveHits(d), ai.acks, ai.aiNote));
  show(`<div class="wlayout"><div class="wmain"><div class="head"><h1 class="ptitle">${editing ? '글 수정' : '새 글 쓰기'}</h1><div class="btns"><button class="btn" type="button" data-a="cancel">취소</button><button class="btn pri" type="button" data-a="save" id="save">${editing ? '저장하기' : '발행하기'}</button></div></div>${notice()}` +
    `<label><span class="sr">제목</span><input class="title" id="wtitle" type="text" maxlength="120" placeholder="제목을 입력하세요" value="${esc(d.title)}"></label>` +
    `<div class="meta"><label class="field" for="wcat">카테고리<select id="wcat">${opts}</select></label>${visHtml}<label class="field" for="wdate">날짜<input id="wdate" type="date" value="${esc(d.date)}"></label><label class="field" for="wsum">한 줄 요약<input id="wsum" type="text" maxlength="300" placeholder="목록과 글 위쪽에 보일 한두 문장" value="${esc(d.sum)}"></label><label class="field" for="wdesc">검색용 설명<input id="wdesc" type="text" maxlength="300" placeholder="검색 결과와 공유 미리보기에 보일 설명(비우면 요약을 써요)" value="${esc(d.desc)}"></label></div>` +
    thumbPicker(d) + filePicker(d) +
    `<div class="tabs" role="tablist" aria-label="편집 방식"><button role="tab" type="button" data-a="tab" data-v="write" aria-selected="${wtab === 'write'}">작성</button><button role="tab" type="button" data-a="tab" data-v="preview" aria-selected="${wtab === 'preview'}">미리보기</button></div>` + edit + `</div>${aiPanel}</div>`);
}

// ---- 글 서식 도구 ----
const restoreSel = () => { const ed = edEl(); if (!ed) return false; ed.focus(); const s = getSelection(); if (savedRange) { s.removeAllRanges(); s.addRange(savedRange); } return s.rangeCount > 0 && ed.contains(s.anchorNode); };
const hasSel = () => { const s = getSelection(); return s.rangeCount > 0 && !s.isCollapsed; };
const syncEd = () => { const ed = edEl(); if (ed && draft) draft.html = ed.innerHTML; };
const tbNote = (msg) => { const n = $('tbnote'); if (n) { n.textContent = msg; n.hidden = !msg; } };
// 글꼴, 크기, 굵기, 색은 선택한 글자에만 적용해요.
function applyStyle(st) {
  if (!restoreSel() || !hasSel()) { tbNote('먼저 서식을 바꿀 글자를 드래그해서 선택하세요.'); return; }
  tbNote('');
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('foreColor', false, '#010203');
  edEl().querySelectorAll('span,font').forEach((s0) => {
    let s = s0;
    const c = (s.style && s.style.color) || s.getAttribute('color') || '';
    if (c === 'rgb(1, 2, 3)' || String(c).toLowerCase() === '#010203') {
      if (s.tagName === 'FONT') { const sp = document.createElement('span'); while (s.firstChild) sp.appendChild(s.firstChild); s.parentNode.replaceChild(sp, s); s = sp; }
      s.style.color = '';
      Object.keys(st).forEach((k) => { s.style[k] = st[k]; });
      if (!s.getAttribute('style')) s.removeAttribute('style');
    }
  });
  document.execCommand('styleWithCSS', false, false);
  syncEd();
}
function fmt(v) {
  if (v === 'image') { restoreSel(); tbNote(''); $('imgrow').hidden = false; $('imgalt').focus(); $('imgnote').textContent = 'PNG, JPG, WebP, GIF · 10MB 이하. 설명을 먼저 쓰고 이미지를 고르세요.'; return; }
  if (v === 'link') { if (!restoreSel() || !hasSel()) { tbNote('링크로 만들 글자를 먼저 선택하세요.'); return; } tbNote(''); $('linkrow').hidden = false; $('linkurl').focus(); return; }
  if (!restoreSel()) return;
  const m = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough', ul: 'insertUnorderedList', ol: 'insertOrderedList' };
  const al = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' };
  document.execCommand('styleWithCSS', false, !!al[v]);
  if (m[v]) document.execCommand(m[v]);
  else if (al[v]) document.execCommand(al[v]);
  else if (v === 'h2' || v === 'h3' || v === 'p') document.execCommand('formatBlock', false, v.toUpperCase());
  else if (v === 'quote') document.execCommand('formatBlock', false, 'BLOCKQUOTE');
  else if (v === 'clear') { document.execCommand('removeFormat'); document.execCommand('formatBlock', false, 'P'); }
  document.execCommand('styleWithCSS', false, false);
  syncEd();
}

// 이미지를 파일 저장소에 올리고 주소를 돌려줘요. 형식과 크기가 맞지 않으면 이유를 담은 오류를 던져요.
async function uploadImage(file, folder) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('PNG, JPG, WebP, GIF 이미지만 올릴 수 있어요.');
  if (file.size > MAX_IMG) throw new Error('이미지는 10MB 이하만 올릴 수 있어요.');
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
  const r = sref(storage, `${folder}/${crypto.randomUUID()}.${ext}`);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}
const uploadErr = (e) => (e && e.message && !e.code ? e.message : dbMsg(e));

async function uploadThumb(file) {
  syncDraft();
  uploading = true; writePage();
  try { draft.img = await uploadImage(file, 'thumbs'); say('이미지를 올렸어요. 글을 저장하면 썸네일로 쓰여요.'); } catch (e) { say(uploadErr(e), true); }
  uploading = false; writePage();
}

// 첨부 파일 올리기: 확장자·크기·개수를 확인하고 진행률을 보여 주며 올려요.
async function attachFile(file) {
  syncDraft();
  const note = () => $('fnote');
  const fail = (m) => { say(m, true); writePage(); };
  const ext = extOf(file.name);
  if (!FILE_TYPES[ext]) return fail('올릴 수 없는 파일 형식이에요. PDF, 문서(Word·Excel·PowerPoint·한글), 텍스트, 압축(zip), 이미지만 올릴 수 있어요.');
  if (file.size > MAX_FILE) return fail('첨부 파일은 25MB 이하만 올릴 수 있어요. (이 파일: ' + fmtSize(file.size) + ')');
  if (draft.files.length >= MAX_FILES) return fail('파일은 글당 ' + MAX_FILES + '개까지 첨부할 수 있어요.');
  const name = file.name.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_').slice(0, 100);
  attaching = true; writePage();
  try {
    const r = sref(storage, `files/${crypto.randomUUID()}.${ext}`);
    const task = uploadBytesResumable(r, file, { contentType: FILE_TYPES[ext], contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
    await new Promise((resolve, reject) => task.on('state_changed', (s) => { if (note()) note().textContent = '올리는 중… ' + Math.round((s.bytesTransferred / s.totalBytes) * 100) + '%'; }, reject, resolve));
    const furl = await getDownloadURL(r);
    draft.files.push({ name, url: furl, size: file.size });
    const txt = await extractText(file, ext); if (txt.length >= 30) fileText.set(furl, txt);
    say('“' + name + '” 파일을 올렸어요. 글을 저장하면 첨부돼요.');
  } catch (e) { say(uploadErr(e), true); }
  attaching = false; writePage();
}

// 본문 이미지: 올린 뒤 글 안의 커서 자리에 넣어요.
async function insertBodyImage(file) {
  const note = $('imgnote'), alt = ($('imgalt').value || '').trim();
  note.textContent = '올리는 중…';
  try {
    const url = await uploadImage(file, 'images');
    const html = `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`;
    if (restoreSel()) document.execCommand('insertHTML', false, html);
    else edEl().insertAdjacentHTML('beforeend', html);
    syncEd();
    $('imgfile').value = ''; $('imgalt').value = '';
    note.textContent = '이미지를 넣었어요. 또 넣으려면 설명을 쓰고 이미지를 고르세요.';
  } catch (e) { note.textContent = uploadErr(e); $('imgfile').value = ''; }
}

async function savePost() {
  syncDraft();
  const d = draft;
  const html = sanitizeHtml(d.html);
  const priv = isPrivCat(d.cat);
  const data = {
    title: d.title.trim(), slug: existing ? existing.slug || '' : '', category: d.cat, visibility: priv ? 'private' : d.vis,
    summary: d.sum.trim(), description: d.desc.trim(), body: html, format: 'html', thumb: d.thumb, img: d.img || '', files: cleanFiles(d.files), date: d.date,
  };
  const bad = (m) => { say(m, true); writePage(); };
  if (!data.title) return bad('제목을 입력해 주세요.');
  if (!textOf(html) && !/<img /.test(html)) return bad('본문을 입력해 주세요.');
  if (html.length > 100000) return bad('본문이 너무 길어요. 나눠서 써 주세요.');
  if (data.summary.length > 300) return bad('요약은 300자 이하로 써 주세요.');
  if (data.files.length > MAX_FILES) return bad('첨부 파일은 글당 ' + MAX_FILES + '개까지예요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return bad('날짜를 입력해 주세요.');
  if (data.description.length > 300) return bad('검색용 설명은 300자 이하로 써 주세요.');
  // 3줄 요약: 승인한 뒤 본문이 바뀌었으면 승인을 풀어요. (공개 화면은 승인된 요약만 보여 줘요)
  const lines = d.ai.lines.map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const hNow = IC.hash(IC.plain(html));
  const approved = d.ai.on && lines.length > 0 && d.ai.for === hNow;
  data.aiSummary = lines; data.aiSummaryOn = approved; data.aiSummaryFor = approved ? hNow : '';
  if (d.ai.on && lines.length && !approved) { d.ai.on = false; ai.msg = '본문이 바뀌어서 3줄 요약 승인이 풀렸어요. 요약을 다시 확인하고 체크해 주세요.'; }
  // 발행 전 점검: 공개 글은 "해결 필요"가 없고 "확인 필요"를 모두 확인해야 저장돼요. (firestore.rules도 해결 필요 항목은 한 번 더 막아요)
  if (data.visibility === 'public') {
    const g = IC.gate(liveHits(d), ai.acks);
    if (!g.ok) {
      ai.showChk = true; ai.tab = 'chk'; logAi('gate', 'check');
      return bad(g.bad.length ? `공개 글로 저장하기 전에 해결할 것이 ${g.bad.length}개 있어요. 아래 AI 도우미의 점검 결과를 확인해 주세요.` : `확인이 필요한 것이 ${g.pending.length}개 있어요. 아래 점검 결과에서 “확인했어요”를 눌러 주세요.`);
    }
  }
  data.updatedAt = serverTimestamp();
  $('save').disabled = true;
  try {
    let id;
    if (existing) { data.createdAt = existing.createdAt; id = existing.id; await setDoc(doc(db, 'posts', id), data); }
    else { data.createdAt = serverTimestamp(); id = (await addDoc(collection(db, 'posts'), data)).id; }
    if (existing) { const keep = new Set(data.files.map((f) => f.url)); await dropFiles(cleanFiles(existing.files).filter((f) => !keep.has(f.url))); } // 글에서 뺀 파일은 저장소에서도 지워요
    { const had = new Set(existing ? cleanFiles(existing.files).filter((f) => f.ai).map((f) => f.url) : []); if (data.files.some((f) => f.ai && !had.has(f.url))) logAi('apply', 'aifile'); } // 새로 저장하는 첨부 요약은 적용으로 세요
    sendFlash(data.visibility === 'public' ? (existing ? '저장했어요.' : '발행했어요.') + NOTE_DEPLOY : '나만 보기 글로 저장했어요. 방문자에게는 보이지 않아요.');
    location.href = `view.html?id=${encodeURIComponent(id)}`;
  } catch (e) { say(dbMsg(e), true); writePage(); }
}

// ---------- 회고 정리 (RETRO SUMMARY) ----------
// 나만 보기 메뉴(예: 회고)의 글을 골라 반복되는 배움을 찾고, 공개 글 초안으로 만들어 글쓰기로 보내요.
// 기본은 회고 본문을 AI로 보내요. "요약만 보내기"를 켜면 원문 대신 내가 쓴 한두 줄 요약만 보내요.
const rt = { sel: new Set(), only: false, sums: {}, noQuote: true, themes: null, pick: new Set(), draft: '', title: '', summary: '', description: '', busy: '', msg: '' };
const retroPosts = () => posts.filter((p) => isPrivCat(p.category));
function retroPage() {
  const list = retroPosts();
  if (!list.length) { show('<h1 class="ptitle">회고 정리</h1><p class="empty">나만 보기 메뉴(예: 회고)에 쓴 글이 아직 없어요. 회고를 먼저 써 주세요.</p><p><a class="btn" href="write.html">글쓰기</a></p>'); return; }
  const busy = rt.busy;
  const rows = list.map((p) => `<li class="rpost"><label class="ackl"><input type="checkbox" data-rt="${esc(p.id)}"${rt.sel.has(p.id) ? ' checked' : ''}> <a href="view.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a> <small>${fd(p.date)}</small></label>${rt.only && rt.sel.has(p.id) ? `<div class="fsum"><label for="rs${esc(p.id)}">AI에 보낼 요약 (원문은 보내지 않아요)</label><input id="rs${esc(p.id)}" data-rtsum="${esc(p.id)}" type="text" maxlength="300" value="${esc(rt.sums[p.id] !== undefined ? rt.sums[p.id] : p.summary || '')}"></div>` : ''}</li>`).join('');
  const th = rt.themes
    ? `<div class="abox"><p class="hint">AI가 찾은 반복되는 배움이에요. 초안에 쓸 것만 고르세요. “몇 편에서” 나왔는지와 근거 글을 함께 보여 드려요.</p><ul class="ahits">${rt.themes.map((t, i) => `<li class="warn"><label class="ackl"><input type="checkbox" data-rtp="${i}"${rt.pick.has(i) ? ' checked' : ''}> <b>${esc(t.name)}</b> <span class="aib">AI</span> <small>${t.titles.length}편에서</small></label><div>${t.titles.map((x) => { const q = retroPosts().find((p) => p.title === x); return q ? `<a href="view.html?id=${encodeURIComponent(q.id)}">${esc(x)}</a>` : esc(x); }).join(' · ')}</div></li>`).join('')}</ul><button type="button" class="btn sm pri" data-a="rtdraft"${busy ? ' disabled' : ''}>${busy === 'rtdraft' ? '쓰는 중…' : '고른 배움으로 공개 글 초안 만들기'}</button></div>`
    : '';
  const dr = rt.draft
    ? `<div class="abox"><p class="hint"><span class="aib">AI 초안</span> 고쳐 쓴 뒤 글쓰기로 보내세요. 글쓰기에서는 STUDY 메뉴·공개로 시작하고, 발행할 때 발행 전 점검이 먼저 돌아요.</p><label class="field" for="rtt">제목<input id="rtt" type="text" maxlength="120" value="${esc(rt.title)}"></label><label class="field" for="rts">한 줄 요약<input id="rts" type="text" maxlength="300" value="${esc(rt.summary)}"></label><label class="field" for="rtdesc">검색용 설명<input id="rtdesc" type="text" maxlength="300" value="${esc(rt.description)}"></label><label class="field" for="rtd">본문</label><textarea id="rtd" style="min-height:320px">${esc(rt.draft)}</textarea><button type="button" class="btn sm pri" data-a="rtsend">글쓰기로 보내기</button></div>`
    : '';
  show(`<h1 class="ptitle">회고 정리 <span class="aib">AI</span></h1>${notice()}<p class="hint">나만 보기 회고를 읽고 반복되는 배움을 찾아 공개 글 초안으로 만들어 줘요. AI는 제안만 하고, 글은 내가 확인하고 고쳐서 발행해요.</p>` +
    `<div class="wlayout rlayout"><div class="wmain"><div class="abox"><h2 class="rsec">1. 정리할 회고 고르기 <small>(나만 보기 글 ${list.length}개)</small></h2><ul class="flist rlist">${rows}</ul><h2 class="rsec">2. AI에 보내는 방식</h2><label class="ackl"><input type="checkbox" id="rtquote"${rt.noQuote ? ' checked' : ''}> 회고 원문 문장을 그대로 쓰지 않기</label><label class="ackl"><input type="checkbox" id="rtonly"${rt.only ? ' checked' : ''}> 원문 대신 내가 쓴 요약만 AI로 보내기</label><p class="hint">${rt.only ? '고른 글마다 보낼 요약을 적어요. 원문은 서버로도 가지 않아요.' : '켜지 않으면 고른 회고의 본문 글자가 AI 서비스로 보내져요. 방문자 정보는 보내지 않아요.'}</p><button type="button" class="btn pri" data-a="rtthemes"${busy ? ' disabled' : ''}>${busy === 'rtthemes' ? '찾는 중…' : '반복되는 배움 찾기'}</button><p class="hint" role="status">${esc(rt.msg)}</p></div>${th}</div><div class="rdraft">${dr || '<div class="abox"><p class="hint"><span class="aib">AI 초안</span> 왼쪽에서 배움을 찾고 초안을 만들면 여기에 나타나요.</p></div>'}</div></div>`);
}
const retroTexts = () => retroPosts().filter((p) => rt.sel.has(p.id)).map((p) => ({ title: p.title, body: rt.only ? (rt.sums[p.id] !== undefined ? rt.sums[p.id] : p.summary || '') : IC.plain(bodyHtml(p)).slice(0, 6000) }));
async function retroRun(kind, input, onOk) {
  rt.busy = kind; rt.msg = ''; retroPage();
  try { onOk(await aiCall(kind === 'rtthemes' ? 'themes' : 'retro', input)); logAi('suggest', 'retro'); } catch (e) { rt.msg = e.message; }
  rt.busy = ''; retroPage();
}
main && main.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b || page !== 'retro') return;
  if (b.dataset.a === 'rtthemes') {
    const texts = retroTexts();
    if (!texts.length) { rt.msg = '회고를 하나 이상 골라 주세요.'; return retroPage(); }
    retroRun('rtthemes', { texts }, (r) => { rt.themes = r.themes || []; rt.pick = new Set(rt.themes.map((_, i) => i)); rt.draft = ''; rt.msg = rt.themes.length ? '' : '반복되는 주제를 찾지 못했어요. 글을 더 고르거나 요약을 보강해 보세요.'; });
  } else if (b.dataset.a === 'rtdraft') {
    const themes = rt.themes.filter((_, i) => rt.pick.has(i));
    if (!themes.length) { rt.msg = '초안에 쓸 배움을 하나 이상 골라 주세요.'; return retroPage(); }
    retroRun('rtdraft', { themes, texts: retroTexts(), noQuote: rt.noQuote }, (r) => { rt.draft = r.draft || ''; rt.title = r.title || ''; rt.summary = r.summary || ''; rt.description = r.description || ''; rt.msg = rt.draft ? '' : '초안을 만들지 못했어요. 다시 눌러 주세요.'; });
  } else if (b.dataset.a === 'rtsend') {
    const t = $('rtd') ? $('rtd').value : rt.draft;
    try { sessionStorage.setItem('intentRetro', JSON.stringify({ title: rt.title, summary: rt.summary, description: rt.description, body: t })); } catch (x) { /* 저장소를 못 쓰면 가져가지 못해요 */ }
    logAi('apply', 'retro');
    const pub = cats.find((c) => c.slug === 'study' && !c.priv) || cats.find((c) => !c.priv); // 기본은 STUDY 메뉴예요(없으면 첫 공개 메뉴)
    location.href = 'write.html?retro=1' + (pub ? '&cat=' + encodeURIComponent(pub.slug) : '');
  }
});
main && main.addEventListener('change', (e) => {
  const t = e.target; if (page !== 'retro') return;
  if (t.dataset.rt) { t.checked ? rt.sel.add(t.dataset.rt) : rt.sel.delete(t.dataset.rt); retroPage(); }
  else if (t.id === 'rtonly') { rt.only = t.checked; retroPage(); }
  else if (t.id === 'rtquote') rt.noQuote = t.checked;
  else if (t.dataset.rtp !== undefined) { const i = Number(t.dataset.rtp); t.checked ? rt.pick.add(i) : rt.pick.delete(i); }
});
main && main.addEventListener('input', (e) => {
  const t = e.target; if (page !== 'retro') return;
  if (t.dataset.rtsum) rt.sums[t.dataset.rtsum] = t.value; else if (t.id === 'rtd') rt.draft = t.value; else if (t.id === 'rtt') rt.title = t.value; else if (t.id === 'rts') rt.summary = t.value; else if (t.id === 'rtdesc') rt.description = t.value;
});

// ---------- AI 이용 현황 (AI USAGE) ----------
const AI_FEATURES = { aisug: '글쓰기 보조', aichk: '발행 전 점검', aitl: '3줄 요약', aifile: '첨부 요약', retro: '회고 정리', check: '발행 막기(점검)' };
async function aiPage() {
  show('<h1 class="ptitle">AI 이용 현황</h1><p class="empty">불러오는 중…</p>');
  let usage = null, logs = [], err = '';
  try { usage = await aiCall('usage', {}); } catch (e) { err = e.message; }
  try { logs = (await getDocs(query(collection(db, 'aiLogs'), orderBy('at', 'desc'), limit(2000)))).docs.map((d) => d.data()); } catch (e) { err += ' ' + dbMsg(e); }
  const ym = (usage && usage.month) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7).replace('-', '');
  const inMonth = logs.filter((l) => l.at && l.at.toDate && new Date(l.at.toDate().getTime() + 9 * 3600e3).toISOString().slice(0, 7).replace('-', '') === ym);
  const tab = {};
  inMonth.forEach((l) => { const f = String(l.feature || '').replace(/\d+$/, ''); const r = tab[f] || (tab[f] = { suggest: 0, apply: 0, ignore: 0, gate: 0 }); if (r[l.kind] !== undefined) r[l.kind]++; });
  const pct = usage ? Math.round((usage.count / usage.limit) * 100) : 0;
  const warn = usage && pct >= 80 ? `<p class="notice warn" role="alert">이번 달 한도의 ${pct}%를 썼어요. 한도(${usage.limit}회)를 넘으면 AI 기능만 멈추고 글쓰기·저장은 그대로 돼요.</p>` : '';
  const rows = Object.keys(tab).map((f) => { const r = tab[f]; return `<tr><td>${esc(AI_FEATURES[f] || f)}</td><td>${r.suggest}</td><td>${r.apply}</td><td>${r.suggest ? Math.round((r.apply / r.suggest) * 100) + '%' : '-'}</td><td>${r.ignore}</td><td>${r.gate}</td></tr>`; }).join('');
  show(`<h1 class="ptitle">AI 이용 현황 <span class="aib">AI</span></h1>${err ? `<p class="notice warn" role="alert">${esc(err.trim())}</p>` : ''}${warn}` +
    (usage ? `<table class="atab"><caption>${ym.slice(0, 4)}년 ${ym.slice(4)}월 호출 수</caption><tr><th>이번 달 호출</th><td>${usage.count}회 / 한도 ${usage.limit}회 (${pct}%)</td></tr><tr><th>사용 모델</th><td>${esc(usage.model)}</td></tr></table>` : '') +
    `<table class="atab"><caption>기능별 이용 (최근 기록 최대 2000건 중 이번 달)</caption><tr><th>기능</th><th>제안</th><th>적용</th><th>적용률</th><th>무시</th><th>막은 수</th></tr>${rows || '<tr><td colspan="6">이번 달 기록이 아직 없어요.</td></tr>'}</table><p class="hint">기록에는 본문·회고 원문·PDF 내용이 들어가지 않아요. 종류, 기능 이름, 글 번호, 시간만 남아요.</p>`);
}

// ---------- 이벤트 ----------
let sideKey = '';
main && main.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = b.dataset.v, id = b.dataset.id;
  const arm = (key) => { delArm = key; rerender(); setTimeout(() => { if (delArm === key) { delArm = ''; rerender(); } }, 3500); };
  if (a === 'sort') { sort = v; listPage(); }
  else if (a === 'acat') { aCat = v; postsPage(); }
  else if (a === 'avis') { aVis = v; postsPage(); }
  else if (a === 'toggle') {
    const p = posts.find((x) => x.id === id); if (!p || isPrivCat(p.category)) return;
    const nv = p.visibility === 'public' ? 'private' : 'public';
    try {
      await updateDoc(doc(db, 'posts', id), { visibility: nv, updatedAt: serverTimestamp() }); p.visibility = nv;
      let n = 0; if (nv === 'private') { try { n = await deleteComments(id); } catch (x) { n = 0; } }
      say(`“${p.title}”을(를) ${nv === 'public' ? '공개로' : '나만 보기로'} 바꿨어요.` + (n ? ` 댓글 ${n}개도 함께 지웠어요.` : '') + NOTE_DEPLOY);
    } catch (ex) { say(dbMsg(ex), true); }
    postsPage();
  } else if (a === 'del' || a === 'vdel') {
    if (delArm !== id) return arm(id);
    const p = posts.find((x) => x.id === id);
    try { await removePost(p); posts = posts.filter((x) => x.id !== id); delArm = ''; if (a === 'vdel') { sendFlash('글을 삭제했어요.' + NOTE_DEPLOY); location.href = 'posts.html'; return; } say('글을 삭제했어요.' + NOTE_DEPLOY); } catch (ex) { delArm = ''; say(dbMsg(ex), true); }
    rerender();
  } else if (a === 'mup' || a === 'mdown') {
    const i = cats.findIndex((c) => c.slug === id), j = i + (a === 'mup' ? -1 : 1);
    if (i < 0 || j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    await menuSave('메뉴 순서를 바꿨어요.');
  } else if (a === 'mdel') {
    const c = catOf(id), n = posts.filter((p) => p.category === id).length;
    if (n) { say(`“${c.name}” 메뉴에 글이 ${n}개 있어요. 글을 다른 메뉴로 옮기거나 삭제한 뒤에 지울 수 있어요.`, true); return menusPage(); }
    if (menuDel !== id) { menuDel = id; menusPage(); setTimeout(() => { if (menuDel === id) { menuDel = ''; menusPage(); } }, 3500); return; }
    menuDel = ''; cats = cats.filter((x) => x.slug !== id);
    await menuSave(`“${c.name}” 메뉴를 삭제했어요.`);
  } else if (a === 'vis') { syncDraft(); draft.vis = v; writePage(); }
  else if (a === 'tab') { syncDraft(); wtab = v; writePage(); }
  else if (a === 'cancel') { history.length > 1 ? history.back() : (location.href = 'posts.html'); }
  else if (a === 'save') savePost();
  else if (a === 'thumb') { syncDraft(); draft.thumb = Number(v); draft.img = ''; writePage(); }
  else if (a === 'fdel') { syncDraft(); draft.files.splice(Number(v), 1); say('목록에서 뺐어요. 글을 저장하면 파일도 지워져요.'); writePage(); }
  else if (a === 'thumbclear') { syncDraft(); draft.img = ''; writePage(); }
  else if (a === 'aisug') aiPick('sug');
  else if (a === 'aichk') aiPick('chk');
  else if (a === 'aitl') aiPick('tl');
  else if (a === 'airef') { ai.tab = v; aiRun(v); }
  else if (a === 'aiapply') {
    syncDraft();
    if (v === 'summary') draft.sum = ai.sug.summary; else if (v === 'description') draft.desc = ai.sug.description; else if (/^t\d$/.test(v)) draft.title = ai.sug.titles[Number(v[1])] || draft.title;
    if (!ai.sug.logged) { ai.sug.logged = true; logAi('apply', 'aisug'); } /* 제안 1번당 적용 1회로 세요 */ ai.msg = '적용했어요. 저장하기 전에는 내용을 더 고칠 수 있어요.'; writePage();
  } else if (a === 'aiignore') { ai.sug = null; ai.msg = ''; logAi('ignore', 'aisug'); aiRender(); }
  else if (a === 'aifile') {
    syncDraft();
    const f = draft.files[Number(v)], text = f && fileText.get(f.url);
    if (!text) return;
    runAi('aifile' + v, 'files', { text }, (r) => { const g = draft.files[Number(v)]; if (g && r.summary) { g.summary = r.summary; g.ai = true; ai.msg = '첨부 요약을 만들었어요. 고쳐 쓴 뒤 저장하면 공개 글의 파일 옆에 보여요.'; } });
  }
  else if (a === 'fmt') fmt(v);
  else if (a === 'imgcancel') { $('imgrow').hidden = true; }
  else if (a === 'linkcancel') { $('linkrow').hidden = true; tbNote(''); }
  else if (a === 'linkok') {
    const u = ($('linkurl').value || '').trim();
    if (!/^https?:\/\//i.test(u)) { tbNote('주소는 http:// 또는 https:// 로 시작해야 해요.'); return; }
    if (!restoreSel() || !hasSel()) { tbNote('링크로 만들 글자를 먼저 선택하세요.'); return; }
    document.execCommand('createLink', false, u); $('linkrow').hidden = true; $('linkurl').value = ''; tbNote(''); syncEd();
  }
});
main && main.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'thfile') { const f = t.files && t.files[0]; if (f) uploadThumb(f); }
  else if (t.id === 'ffile') { const f = t.files && t.files[0]; if (f) attachFile(f); }
  else if (t.id === 'imgfile') { const f = t.files && t.files[0]; if (f) insertBodyImage(f); }
  else if (t.dataset && t.dataset.ack) { ai.acks[t.dataset.ack] = t.checked; }
  else if (t.id === 'aion') { syncDraft(); draft.ai.on = t.checked; draft.ai.for = t.checked ? IC.hash(IC.plain(sanitizeHtml(draft.html))) : ''; if (t.checked) logAi('apply', 'aitl'); }
  else if (t.dataset && t.dataset.tb) {
    const map = { font: 'fontFamily', size: 'fontSize', weight: 'fontWeight', color: 'color' };
    if (!t.value) return;
    applyStyle({ [map[t.dataset.tb]]: t.value }); t.value = '';
  } else if (t.id === 'wcat') { syncDraft(); writePage(); }
  else if (t.dataset && t.dataset.mname) {
    const c = catOf(t.dataset.mname), name = t.value.trim();
    if (!c) return;
    if (!name) { say('메뉴 이름을 입력해 주세요.', true); return menusPage(); }
    if (cats.some((o) => o.slug !== c.slug && o.name === name)) { say(`“${name}” 이름의 메뉴가 이미 있어요.`, true); return menusPage(); }
    if (name === c.name) return;
    c.name = name; await menuSave(`메뉴 이름을 “${name}”(으)로 바꿨어요. 사이드바와 글쓰기에도 같은 이름으로 보여요.`);
  } else if (t.dataset && t.dataset.mpriv) {
    const c = catOf(t.dataset.mpriv); if (!c) return;
    c.priv = t.checked;
    try {
      if (c.priv) { // 나만 보기 메뉴로 바꾸면 그 메뉴의 공개 글도 모두 나만 보기로 바꿔요.
        for (const p of posts.filter((x) => x.category === c.slug && x.visibility === 'public')) {
          await updateDoc(doc(db, 'posts', p.id), { visibility: 'private', updatedAt: serverTimestamp() }); p.visibility = 'private';
          try { await deleteComments(p.id); } catch (x) { /* 댓글이 없으면 넘어가요 */ }
        }
      }
    } catch (ex) { c.priv = !c.priv; say(dbMsg(ex), true); return menusPage(); }
    await menuSave(c.priv ? `“${c.name}” 메뉴를 나만 보기로 바꿨어요. 로그인 전에는 메뉴와 글이 보이지 않아요.` + NOTE_DEPLOY : `“${c.name}” 메뉴를 공개 메뉴로 바꿨어요. 글은 하나씩 공개로 바꿀 수 있어요.`);
  }
});
main && main.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'wed') { if (draft) draft.html = t.innerHTML; }
  else if (t.id === 'aq') { aq = t.value; const r = mrows(); $('arows').innerHTML = r.html; $('acount').textContent = r.n; }
  else if (t.id === 'q') { q = t.value; $('lbody').innerHTML = listBody(); }
});
main && main.addEventListener('submit', async (e) => {
  if (e.target.id !== 'mf') return;
  e.preventDefault();
  const name = $('mnew').value.trim();
  if (!name) { say('새 메뉴 이름을 입력해 주세요.', true); return menusPage(); }
  if (cats.some((o) => o.name === name)) { say(`“${name}” 이름의 메뉴가 이미 있어요.`, true); return menusPage(); }
  cats.push({ slug: slugFor(name), name, priv: false });
  await menuSave(`“${name}” 메뉴를 추가했어요. 사이드바와 글쓰기에서 바로 쓸 수 있어요.` + NOTE_DEPLOY);
});
// 도구 버튼을 눌러도 글자 선택이 풀리지 않게 해요.
main && main.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.tbb')) e.preventDefault(); });
main && main.addEventListener('paste', (e) => {
  if (!e.target.closest || !e.target.closest('#wed')) return;
  e.preventDefault();
  const h = e.clipboardData.getData('text/html'), t = e.clipboardData.getData('text/plain');
  document.execCommand('insertHTML', false, h ? sanitizeHtml(h) : esc(t).replace(/\n/g, '<br>'));
  syncEd();
});
document.addEventListener('selectionchange', () => { const ed = edEl(), s = getSelection(); if (ed && s.rangeCount && ed.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); });

function rerender() { if (page === 'posts') postsPage(); else if (page === 'view') viewPage(); }

// ---------- 화면별 시작 ----------
if (['posts', 'menus', 'write', 'list', 'view', 'retro', 'ai'].includes(page)) {
  if (await requireAdmin()) {
    try { await loadMenus(); await loadPosts(); } catch (e) { $('gate').textContent = dbMsg(e); throw e; }
    if (page === 'posts') { sideKey = 'posts'; renderSidebar(sideKey); postsPage(); }
    else if (page === 'menus') { sideKey = 'menus'; renderSidebar(sideKey); menusPage(); }
    else if (page === 'list') { sideKey = params.get('cat') ? 'cat:' + params.get('cat') : 'all'; renderSidebar(sideKey); listPage(); }
    else if (page === 'view') { viewPage(); }
    else if (page === 'retro') { sideKey = 'retro'; renderSidebar(sideKey); retroPage(); }
    else if (page === 'ai') { sideKey = 'ai'; renderSidebar(sideKey); await aiPage(); }
    else if (page === 'write') {
      sideKey = 'write'; renderSidebar(sideKey);
      const id = params.get('id');
      existing = id ? posts.find((p) => p.id === id) || null : null;
      if (id && !existing) { show('<h1 class="ptitle">글을 찾을 수 없어요</h1><p class="empty">삭제되었거나 없는 글이에요.</p><p><a class="btn" href="posts.html">글 관리로</a></p>'); }
      else {
        draft = existing
          ? { title: existing.title, cat: existing.category, vis: existing.visibility, sum: existing.summary || '', date: existing.date, html: bodyHtml(existing), thumb: Number.isInteger(existing.thumb) ? existing.thumb : 0, img: existing.img || '', files: cleanFiles(existing.files), desc: existing.description || '', ai: aiOf(existing) }
          : (() => { const rI = retroInit(); return { title: rI.title, cat: (params.get('cat') && catOf(params.get('cat')) ? params.get('cat') : cats.length ? cats[0].slug : ''), vis: 'public', sum: rI.sum, date: today(), html: rI.html, thumb: Math.floor(Math.random() * 6), img: '', files: [], desc: rI.desc, ai: { lines: [], on: false, for: '' } }; })();
        writePage();
      }
    }
  }
}

// ---------- 공개 화면에서: 관리자가 로그인한 상태면 사이드바를 관리자 메뉴로 바꿔요 ----------
if (page === 'public') {
  const u = await firstUser();
  if (!u || !(await isAdmin(u))) setHint(false);
  else {
    user = u;
    await loadMenus();
    renderSidebar('');
    const pid = body.dataset.pid;
    if (pid) {
      const mainEl = document.querySelector('main');
      const bar = document.createElement('div');
      bar.className = 'adminbar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '관리자 메뉴');
      bar.innerHTML = `<span>관리자로 보는 중</span><div><a class="btn sm" href="${root}admin/posts.html">관리자 페이지</a><a class="btn sm" href="${root}admin/write.html?id=${encodeURIComponent(pid)}">수정</a><button class="btn sm danger" type="button">삭제</button></div>`;
      mainEl.insertBefore(bar, mainEl.firstChild);
      const del = bar.querySelector('.danger'); let armed = false;
      del.addEventListener('click', async () => {
        if (!armed) { armed = true; del.textContent = '정말 삭제할까요?'; del.classList.add('sure'); setTimeout(() => { armed = false; del.textContent = '삭제'; del.classList.remove('sure'); }, 3500); return; }
        try { await removePost({ id: pid }); sendFlash('글을 삭제했어요.' + NOTE_DEPLOY); location.href = root + 'admin/posts.html'; } catch (ex) { del.textContent = dbMsg(ex); }
      });
    }
  }
}
