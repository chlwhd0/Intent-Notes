// 관리자 화면(로그인, 글 관리, 글쓰기)의 동작. 파이어베이스 로그인(Authentication)과 데이터베이스(Firestore)를 써요.
// 관리자인지는 로그인 정보의 admin 표시(custom claim)로 확인하고, 실제 막는 일은 firestore.rules가 해요.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const cfg = await (await fetch(new URL('./firebase-config.json', import.meta.url))).json();
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;

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
  if (c === 'permission-denied') return '권한이 없어요. 관리자로 다시 로그인해 주세요.';
  if (c === 'unavailable') return '인터넷 연결을 확인해 주세요.';
  return '저장하지 못했어요. 잠시 뒤에 다시 해 주세요.';
}
function note(el, text, kind) {
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'notice' + (kind === 'warn' ? ' warn' : '');
}

// ---------- 로그인 ----------
if (page === 'login') {
  const err = $('err'), btn = $('google');
  if (new URLSearchParams(location.search).get('denied')) err.textContent = '이 계정에는 관리자 권한이 없어요.';
  const u = await firstUser();
  if (u && (await isAdmin(u))) location.replace('posts.html');
  // 관리자는 구글 계정으로 로그인해요. 로그인한 계정에 admin 표시가 있어야만 들어갈 수 있어요.
  btn.addEventListener('click', async () => {
    btn.disabled = true; err.textContent = '';
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      if (!(await isAdmin(cred.user))) {
        await signOut(auth);
        err.textContent = '이 구글 계정에는 관리자 권한이 없어요. 관리자로 지정한 계정으로 로그인해 주세요.';
        btn.disabled = false;
        return;
      }
      location.replace('posts.html');
    } catch (ex) {
      err.textContent = authMsg(ex);
      btn.disabled = false;
    }
  });
}

// ---------- 관리자 공통 ----------
async function guard() {
  const user = await firstUser();
  if (!user) { location.replace('login.html'); return null; }
  if (!(await isAdmin(user))) { await signOut(auth); location.replace('login.html?denied=1'); return null; }
  $('who').textContent = '로그인: ' + user.email;
  $('logout').addEventListener('click', async () => { await signOut(auth); location.replace('login.html'); });
  $('gate').hidden = true;
  $('adminapp').hidden = false;
  return user;
}
const publicCats = JSON.parse(($('cats') || { textContent: '{}' }).textContent); // { slug: 이름 }
async function privateCats() {
  try {
    const s = await getDoc(doc(db, 'settings', 'private'));
    return s.exists() && Array.isArray(s.data().categories) ? s.data().categories : [];
  } catch (e) { return []; }
}

// ---------- 글 관리 ----------
if (page === 'posts') {
  if (await guard()) {
    const priv = await privateCats();
    const privMap = Object.fromEntries(priv.map((c) => [c.slug, c.title]));
    const titleOf = (slug) => publicCats[slug] || privMap[slug] || slug;
    const body = $('rows'), msg = $('msg');
    let armed = '';
    async function load() {
      body.textContent = '';
      let snap;
      try { snap = await getDocs(query(collection(db, 'posts'), orderBy('date', 'desc'))); } catch (e) { note(msg, dbMsg(e), 'warn'); return; }
      $('count').textContent = snap.size;
      if (snap.empty) { const tr = body.insertRow(); const td = tr.insertCell(); td.colSpan = 5; td.className = 'empty'; td.textContent = '아직 글이 없어요. “새 글 쓰기”로 첫 글을 써 보세요.'; return; }
      snap.forEach((d) => {
        const p = d.data(), id = d.id, fixed = p.category in privMap;
        const tr = body.insertRow();
        const a = document.createElement('a'); a.href = 'write.html?id=' + encodeURIComponent(id); a.textContent = p.title;
        tr.insertCell().appendChild(a);
        tr.insertCell().textContent = titleOf(p.category);
        const bc = tr.insertCell(); const badge = document.createElement('span'); badge.className = 'badge' + (p.visibility === 'private' ? ' pv' : ''); badge.textContent = (p.visibility === 'public' ? '공개' : '나만 보기') + (fixed ? ' · 고정' : ''); bc.appendChild(badge);
        tr.insertCell().textContent = p.date;
        const ac = tr.insertCell(); ac.className = 'acts';
        const edit = document.createElement('a'); edit.className = 'btn sm'; edit.href = a.href; edit.textContent = '수정'; ac.appendChild(edit);
        if (!fixed) {
          const t = document.createElement('button'); t.type = 'button'; t.className = 'btn sm'; t.textContent = p.visibility === 'public' ? '나만 보기로' : '공개로';
          t.addEventListener('click', async () => {
            try { await updateDoc(doc(db, 'posts', id), { visibility: p.visibility === 'public' ? 'private' : 'public', updatedAt: serverTimestamp() }); note(msg, '공개 범위를 바꿨어요. 사이트에 반영하려면 다시 빌드하고 배포해야 해요.'); load(); } catch (e) { note(msg, dbMsg(e), 'warn'); }
          });
          ac.appendChild(t);
        }
        const del = document.createElement('button'); del.type = 'button'; del.className = 'btn sm danger' + (armed === id ? ' sure' : ''); del.textContent = armed === id ? '정말 삭제할까요?' : '삭제';
        del.addEventListener('click', async () => {
          if (armed !== id) { armed = id; load(); setTimeout(() => { if (armed === id) { armed = ''; load(); } }, 3500); return; }
          try { await deleteDoc(doc(db, 'posts', id)); armed = ''; note(msg, '글을 삭제했어요.'); load(); } catch (e) { note(msg, dbMsg(e), 'warn'); }
        });
        ac.appendChild(del);
      });
    }
    load();
  }
}

// ---------- 글쓰기·수정 ----------
if (page === 'write') {
  if (await guard()) {
    const msg = $('msg'), cat = $('wcat'), editId = new URLSearchParams(location.search).get('id');
    const priv = await privateCats();
    priv.forEach((c) => { const o = document.createElement('option'); o.value = c.slug; o.textContent = c.title; o.dataset.private = '1'; cat.appendChild(o); });
    let vis = 'public', existing = null;
    const isPriv = () => !!cat.options[cat.selectedIndex].dataset.private;
    function syncVis() {
      if (isPriv()) vis = 'private';
      $('vfixed').hidden = !isPriv();
      $('vgroup').hidden = isPriv();
      $('pub').setAttribute('aria-pressed', vis === 'public');
      $('priv').setAttribute('aria-pressed', vis === 'private');
      $('vhint').textContent = vis === 'public' ? '누구나 읽을 수 있어요.' : '로그인한 관리자만 볼 수 있어요.';
    }
    $('pub').addEventListener('click', () => { vis = 'public'; syncVis(); });
    $('priv').addEventListener('click', () => { vis = 'private'; syncVis(); });
    cat.addEventListener('change', syncVis);
    $('wdate').value = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
    if (editId) {
      try {
        const s = await getDoc(doc(db, 'posts', editId));
        if (!s.exists()) { note(msg, '글을 찾을 수 없어요.', 'warn'); $('form').hidden = true; }
        else {
          existing = s.data();
          $('wtitle').value = existing.title; cat.value = existing.category; vis = existing.visibility;
          $('wsum').value = existing.summary; $('wdate').value = existing.date; $('wbody').value = existing.body;
          $('heading').textContent = '글 수정';
        }
      } catch (e) { note(msg, dbMsg(e), 'warn'); }
    }
    syncVis();
    if (new URLSearchParams(location.search).get('saved')) note(msg, '저장했어요. 공개 글은 사이트를 다시 빌드하고 배포해야 방문자에게 보여요.');
    // 작성 / 미리보기
    const setTab = (prev) => {
      $('tw').setAttribute('aria-selected', !prev); $('tp').setAttribute('aria-selected', prev);
      $('bodywrap').hidden = prev; $('pv').hidden = !prev;
      if (prev) $('pv').innerHTML = window.IntentMd.markdown($('wbody').value) || '<p class="hint">미리 볼 내용이 없어요.</p>';
    };
    $('tw').addEventListener('click', () => setTab(false));
    $('tp').addEventListener('click', () => setTab(true));
    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = {
        // 글 주소와 검색 설명 입력칸은 없애서, 새 글은 빈 값(주소는 글 번호, 설명은 요약을 씀)이고 기존 값은 그대로 둬요.
        title: $('wtitle').value.trim(), slug: existing ? existing.slug : '', category: cat.value,
        visibility: isPriv() ? 'private' : vis,
        summary: $('wsum').value.trim(), description: existing ? existing.description : '', body: $('wbody').value, date: $('wdate').value,
      };
      if (!d.title) return note(msg, '제목을 입력해 주세요.', 'warn');
      if (d.title.length > 120) return note(msg, '제목은 120자 이하로 써 주세요.', 'warn');
      if (!d.body.trim()) return note(msg, '본문을 입력해 주세요.', 'warn');
      if (d.summary.length > 300) return note(msg, '요약은 300자 이하로 써 주세요.', 'warn');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return note(msg, '날짜를 YYYY-MM-DD 형식으로 입력해 주세요.', 'warn');
      d.updatedAt = serverTimestamp();
      const btn = $('save'); btn.disabled = true;
      try {
        if (editId && existing) {
          d.createdAt = existing.createdAt;
          await setDoc(doc(db, 'posts', editId), d);
          existing = { ...existing, ...d };
          note(msg, d.visibility === 'public' ? '저장했어요. 공개 글은 사이트를 다시 빌드하고 배포해야 방문자에게 보여요.' : '저장했어요. 나만 보기 글이라 방문자에게는 보이지 않아요.');
        } else {
          d.createdAt = serverTimestamp();
          const ref = await addDoc(collection(db, 'posts'), d);
          location.replace('write.html?id=' + encodeURIComponent(ref.id) + '&saved=1');
          return;
        }
      } catch (ex) { note(msg, dbMsg(ex), 'warn'); }
      btn.disabled = false;
    });
  }
}
