// 관리자 화면의 동작. 파이어베이스 로그인(Authentication), 데이터베이스(Firestore), 파일 저장소(Storage)를 써요.
// 관리자인지는 로그인 정보의 admin 표시(custom claim)로 확인하고, 실제로 막는 일은 firestore.rules와 storage.rules가 해요.
// 같은 파일이 (1) 관리자 화면 6개와 (2) 관리자가 로그인한 채로 보는 공개 화면의 사이드바를 맡아요.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, query, orderBy, where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref as sref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import './sanitize.js';
import './markdown.js';
import './thumbs.js';

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
    '<span class="grp">ADMIN</span>' + a('menus.html', 'MANAGE MENUS', 'menus', 'subl') + a('posts.html', 'MANAGE POSTS', 'posts', 'subl');
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
const cleanFiles = (arr) => (Array.isArray(arr) ? arr : []).filter((f) => f && typeof f.name === 'string' && typeof f.url === 'string').map((f) => ({ name: f.name, url: f.url, size: Number(f.size) || 0 }));
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
function viewPage() {
  const p = posts.find((x) => x.id === params.get('id'));
  if (!p) { show('<h1 class="ptitle">글을 찾을 수 없어요</h1><p class="empty">삭제되었거나 없는 글이에요.</p><p><a class="btn" href="posts.html">글 관리로</a></p>'); return; }
  sideKey = 'cat:' + p.category; renderSidebar(sideKey);
  const bar = `<div class="adminbar" role="region" aria-label="관리자 메뉴"><span>관리자로 보는 중 · ${p.visibility === 'public' ? '공개글' : '나만 보기'}</span><div><a class="btn sm" href="posts.html">관리자 페이지</a><a class="btn sm" href="write.html?id=${encodeURIComponent(p.id)}">수정</a><button class="btn sm danger${delArm === p.id ? ' sure' : ''}" type="button" data-a="vdel" data-id="${esc(p.id)}">${delArm === p.id ? '정말 삭제할까요?' : '삭제'}</button></div></div>`;
  show(bar + notice() + `<article class="post"><a class="tag" href="list.html?cat=${encodeURIComponent(p.category)}">${esc(catName(p.category))}</a><h1>${esc(p.title)}${lock(p)}</h1><p class="summary">${esc(p.summary || '')}</p><div class="meta3"><time>${fd(p.date)}</time>${isPrivCat(p.category) ? '' : `<span class="hint">조회 ${views[p.id] || 0}</span>`}</div><div class="cover">${TH.inner(p)}</div><div class="body">${bodyHtml(p)}</div>${filesHtml(cleanFiles(p.files))}${isPrivCat(p.category) || p.visibility !== 'public' ? '<p class="hint" style="margin-top:32px">나만 보기 글에는 댓글이 달리지 않아요.</p>' : ''}</article>`);
}

// ---------- 글쓰기·수정 (NEW POST) ----------
let draft = null, wtab = 'write', existing = null, savedRange = null, uploading = false, attaching = false;
const edEl = () => $('wed');
function syncDraft() {
  if (!draft || !$('wtitle')) return;
  draft.title = $('wtitle').value; draft.cat = $('wcat').value; draft.sum = $('wsum').value; draft.date = $('wdate').value;
  const ed = edEl(); if (ed) draft.html = ed.innerHTML;
}
function thumbPicker(d) {
  const bs = TH.THUMBS.map((sv, i) => `<button type="button" class="thb" data-a="thumb" data-v="${i}" aria-label="썸네일 모양 ${i + 1}" aria-pressed="${!d.img && d.thumb === i}">${sv}</button>`).join('');
  return `<div class="field" id="thl">썸네일<div class="thpick"><div class="thcur">${thumbHtml(d)}</div>${bs}<label class="thfile btn sm" for="thfile">${uploading ? '올리는 중…' : '이미지 올리기'}</label><input class="sr" id="thfile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"${uploading ? ' disabled' : ''}>${d.img ? '<button type="button" class="btn sm" data-a="thumbclear">올린 이미지 지우기</button>' : ''}</div><span class="hint">모양을 고르거나 내 이미지(PNG, JPG, WebP, GIF, 10MB 이하)를 올려요.</span></div>`;
}
function filePicker(d) {
  const items = d.files.map((f, i) => `<li><span class="fname">${esc(f.name)}</span> <small>${fmtSize(f.size)}</small> <button type="button" class="btn sm" data-a="fdel" data-v="${i}" aria-label="${esc(f.name)} 빼기">빼기</button></li>`).join('');
  const full = d.files.length >= MAX_FILES;
  return `<div class="field" id="fl">첨부 파일${items ? `<ul class="flist">${items}</ul>` : ''}<div class="thpick"><label class="thfile btn sm" for="ffile"${full ? ' aria-disabled="true"' : ''}>${attaching ? '올리는 중…' : '파일 올리기'}</label><input class="sr" id="ffile" type="file" accept="${Object.keys(FILE_TYPES).map((x) => '.' + x).join(',')}"${attaching || full ? ' disabled' : ''}><span class="hint" id="fnote" role="status">${full ? '파일은 글당 ' + MAX_FILES + '개까지예요.' : ''}</span></div><span class="hint">PDF, 문서(Word·Excel·PowerPoint·한글), 텍스트, 압축(zip), 이미지 · 파일당 25MB 이하 · 글당 5개까지. 실행 파일과 HTML은 올릴 수 없어요. 방문자는 공개 글에서 내려받을 수 있어요.</span></div>`;
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
  show(`<div class="head"><h1 class="ptitle">${editing ? '글 수정' : '새 글 쓰기'}</h1><div class="btns"><button class="btn" type="button" data-a="cancel">취소</button><button class="btn pri" type="button" data-a="save" id="save">${editing ? '저장하기' : '발행하기'}</button></div></div>${notice()}` +
    `<label><span class="sr">제목</span><input class="title" id="wtitle" type="text" maxlength="120" placeholder="제목을 입력하세요" value="${esc(d.title)}"></label>` +
    `<div class="meta"><label class="field" for="wcat">카테고리<select id="wcat">${opts}</select></label>${visHtml}<label class="field" for="wdate">날짜<input id="wdate" type="date" value="${esc(d.date)}"></label><label class="field" for="wsum">한 줄 요약<input id="wsum" type="text" maxlength="300" placeholder="목록과 검색 결과에 보일 한두 문장" value="${esc(d.sum)}"></label></div>` +
    thumbPicker(d) + filePicker(d) +
    `<div class="tabs" role="tablist" aria-label="편집 방식"><button role="tab" type="button" data-a="tab" data-v="write" aria-selected="${wtab === 'write'}">작성</button><button role="tab" type="button" data-a="tab" data-v="preview" aria-selected="${wtab === 'preview'}">미리보기</button></div>` + edit);
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
    draft.files.push({ name, url: await getDownloadURL(r), size: file.size });
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
    summary: d.sum.trim(), description: existing ? existing.description || '' : '', body: html, format: 'html', thumb: d.thumb, img: d.img || '', files: cleanFiles(d.files), date: d.date,
  };
  const bad = (m) => { say(m, true); writePage(); };
  if (!data.title) return bad('제목을 입력해 주세요.');
  if (!textOf(html) && !/<img /.test(html)) return bad('본문을 입력해 주세요.');
  if (html.length > 100000) return bad('본문이 너무 길어요. 나눠서 써 주세요.');
  if (data.summary.length > 300) return bad('요약은 300자 이하로 써 주세요.');
  if (data.files.length > MAX_FILES) return bad('첨부 파일은 글당 ' + MAX_FILES + '개까지예요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return bad('날짜를 입력해 주세요.');
  data.updatedAt = serverTimestamp();
  $('save').disabled = true;
  try {
    let id;
    if (existing) { data.createdAt = existing.createdAt; id = existing.id; await setDoc(doc(db, 'posts', id), data); }
    else { data.createdAt = serverTimestamp(); id = (await addDoc(collection(db, 'posts'), data)).id; }
    if (existing) { const keep = new Set(data.files.map((f) => f.url)); await dropFiles(cleanFiles(existing.files).filter((f) => !keep.has(f.url))); } // 글에서 뺀 파일은 저장소에서도 지워요
    sendFlash(data.visibility === 'public' ? (existing ? '저장했어요.' : '발행했어요.') + NOTE_DEPLOY : '나만 보기 글로 저장했어요. 방문자에게는 보이지 않아요.');
    location.href = `view.html?id=${encodeURIComponent(id)}`;
  } catch (e) { say(dbMsg(e), true); writePage(); }
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
if (['posts', 'menus', 'write', 'list', 'view'].includes(page)) {
  if (await requireAdmin()) {
    try { await loadMenus(); await loadPosts(); } catch (e) { $('gate').textContent = dbMsg(e); throw e; }
    if (page === 'posts') { sideKey = 'posts'; renderSidebar(sideKey); postsPage(); }
    else if (page === 'menus') { sideKey = 'menus'; renderSidebar(sideKey); menusPage(); }
    else if (page === 'list') { sideKey = params.get('cat') ? 'cat:' + params.get('cat') : 'all'; renderSidebar(sideKey); listPage(); }
    else if (page === 'view') { viewPage(); }
    else if (page === 'write') {
      sideKey = 'write'; renderSidebar(sideKey);
      const id = params.get('id');
      existing = id ? posts.find((p) => p.id === id) || null : null;
      if (id && !existing) { show('<h1 class="ptitle">글을 찾을 수 없어요</h1><p class="empty">삭제되었거나 없는 글이에요.</p><p><a class="btn" href="posts.html">글 관리로</a></p>'); }
      else {
        draft = existing
          ? { title: existing.title, cat: existing.category, vis: existing.visibility, sum: existing.summary || '', date: existing.date, html: bodyHtml(existing), thumb: Number.isInteger(existing.thumb) ? existing.thumb : 0, img: existing.img || '', files: cleanFiles(existing.files) }
          : { title: '', cat: (params.get('cat') && catOf(params.get('cat')) ? params.get('cat') : cats.length ? cats[0].slug : ''), vis: 'public', sum: '', date: today(), html: '', thumb: Math.floor(Math.random() * 6), img: '', files: [] };
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
