// 방문자 화면의 데이터 연결: 조회수, 방문자 구글 로그인, 댓글, @ 알림.
// 글 내용은 빌드할 때 이미 HTML에 들어 있어서, 이 파일이 없어도 글은 읽혀요.
// 로그인은 관리자와 같은 구글 로그인이에요. 누가 무엇을 할 수 있는지는 firestore.rules가 정해요.
const body = document.body;
const root = body.dataset.root || '';
const page = body.dataset.page;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const getHint = (k) => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };
const setHint = (k, on) => { try { on ? localStorage.setItem(k, '1') : localStorage.removeItem(k); } catch (e) { /* 무시 */ } };
const adminHint = getHint('intentAdmin');
const visitorHint = getHint('intentVisitor');
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

// ---------- 파이어베이스 (필요할 때만 불러와요) ----------
let FB = null;
const fb = () => FB || (FB = (async () => {
  const cfg = await (await fetch(root + 'assets/firebase-config.json')).json();
  const { initializeApp } = await import(SDK + 'firebase-app.js');
  const A = await import(SDK + 'firebase-auth.js');
  const F = await import(SDK + 'firebase-firestore.js');
  const app = initializeApp(cfg, 'admin'); // 관리자 화면과 같은 앱 이름이라 로그인 상태를 같이 써요
  return { A, F, auth: A.getAuth(app), db: F.getFirestore(app) };
})());

async function getMe() {
  const { A, auth } = await fb();
  const u = await new Promise((resolve) => { const off = A.onAuthStateChanged(auth, (x) => { off(); resolve(x); }); });
  if (!u) return null;
  const admin = (await u.getIdTokenResult()).claims.admin === true;
  return { uid: u.uid, admin, name: admin ? '관리자' : (u.displayName || '방문자').trim().slice(0, 40) || '방문자' };
}

// ---------- 방문자 로그인과 사이드바 아래쪽 ----------
const bottomEl = $('bottom');
const adminLink = () => `<a class="admin" href="${root}admin/login.html" rel="nofollow">관리자 로그인</a>`;
let loginMsg = '';
async function signIn() {
  try {
    const { A, auth } = await fb();
    const p = new A.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    const cred = await A.signInWithPopup(auth, p);
    setHint('intentVisitor', true);
    if ((await cred.user.getIdTokenResult()).claims.admin === true) setHint('intentAdmin', true);
    location.reload();
  } catch (e) {
    const c = (e && e.code) || '';
    loginMsg = c === 'auth/popup-blocked' ? '팝업이 막혀 있어요. 허용한 뒤 다시 눌러 주세요.' : c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' ? '로그인 창이 닫혔어요.' : '로그인하지 못했어요. 잠시 뒤에 다시 해 주세요.';
    renderBottom(null);
  }
}
async function signOutNow() {
  const { A, auth } = await fb();
  await A.signOut(auth);
  setHint('intentVisitor', false); setHint('intentAdmin', false);
  location.reload();
}
function renderBottom(me, unseen) {
  if (!bottomEl) return;
  if (me && me.admin) return; // 관리자일 때 사이드바는 관리자 코드(admin-app.js)가 맡아요
  bottomEl.innerHTML = me
    ? `<span class="who">${esc(me.name)}님</span><a href="${root}mentions.html" id="mlink">@ 알림${unseen ? ` <span class="lock" style="margin-left:4px">${unseen}</span>` : ''}</a><button type="button" class="linkbtn" id="vlogout">로그아웃</button>${adminLink()}`
    : `<button type="button" class="linkbtn" id="vlogin">Google 로그인</button>${loginMsg ? `<span class="hint" role="alert">${esc(loginMsg)}</span>` : ''}${adminLink()}`;
  const li = $('vlogin'), lo = $('vlogout');
  if (li) li.addEventListener('click', signIn);
  if (lo) lo.addEventListener('click', signOutNow);
}

// ---------- 조회수 ----------
async function views(me) {
  const spots = [...document.querySelectorAll('[data-views]')];
  if (!spots.length) return;
  const { F, db } = await fb();
  const counts = {};
  try { (await F.getDocs(F.collection(db, 'views'))).forEach((d) => { counts[d.id] = Number(d.data().count) || 0; }); } catch (e) { return; }
  // 글 상세 화면이면 한 번 세요. 관리자가 연 것과, 이 브라우저에서 이미 센 글은 세지 않아요.
  const detail = body.querySelector('.post [data-views]');
  if (detail && !adminHint && !(me && me.admin)) {
    const id = detail.dataset.views;
    let seen = false;
    try { seen = sessionStorage.getItem('viewed:' + id) === '1'; } catch (e) { seen = false; }
    if (!seen) {
      try {
        await F.setDoc(F.doc(db, 'views', id), { count: F.increment(1) }, { merge: true });
        counts[id] = (counts[id] || 0) + 1;
        try { sessionStorage.setItem('viewed:' + id, '1'); } catch (e) { /* 무시 */ }
      } catch (e) { /* 센 것이 실패해도 글 읽기에는 영향이 없어요 */ }
    }
  }
  spots.forEach((el) => { el.textContent = '조회 ' + (counts[el.dataset.views] || 0); el.hidden = false; });
}

// ---------- 댓글 ----------
const two = (n) => ('0' + n).slice(-2);
const tsOf = (t) => (t && t.toDate ? t.toDate() : new Date());
const fdt = (t) => { const d = tsOf(t); return `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const hnd = (n) => String(n).replace(/\s+/g, '');
const COLORS = ['#8d8a85', '#b5573f', '#6f7f6a', '#7b6f8f', '#a08460'];
const colorOf = (id) => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const errMsg = (e) => ((e && e.code) === 'permission-denied' ? '권한이 없어요. 다시 로그인한 뒤 시도해 주세요.' : '저장하지 못했어요. 잠시 뒤에 다시 해 주세요.');

async function comments(me) {
  const box = $('comments');
  if (!box) return;
  const postId = box.dataset.post;
  const { F, db } = await fb();
  let list = [], replyTo = '', editing = '', cDel = '', msg = '', warn = false;
  const draft = { new: '', reply: '', edit: '' };

  async function load() {
    const snap = await F.getDocs(F.query(F.collection(db, 'comments'), F.where('post', '==', postId)));
    list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt));
  }
  const people = () => {
    const m = { '관리자': '관리자' };
    list.forEach((c) => { if (!c.gone) m[hnd(c.name)] = c.name; });
    return Object.keys(m);
  };
  const rich = (t) => { const hs = new Set(people()); return esc(t).replace(/@([^\s@&]+)/g, (m0, h) => (hs.has(h) ? `<span class="mention">@${esc(h)}</span>` : m0)); };
  const mentionsIn = (t) => { const hs = new Set(people()), out = new Set(); (t.match(/@([^\s@]+)/g) || []).forEach((x) => { const h = x.slice(1); if (hs.has(h)) out.add(h); }); return [...out].slice(0, 10); };

  const composer = (key, val, label, act, id, cancel) =>
    `<div class="cmp"><label><span class="sr">댓글 내용</span><textarea data-ta="${key}" maxlength="500" rows="3" placeholder="${key === 'new' ? '댓글을 입력하세요' : ''}">${esc(val)}</textarea></label><div class="sug" data-sug="${key}" role="listbox" aria-label="부를 사람" hidden></div><div class="cmp-f"><span class="hint">@를 입력하면 사람을 부를 수 있어요.</span><div class="btns">${cancel ? `<button class="btn sm" type="button" data-a="${cancel}">취소</button>` : ''}<button class="btn sm pri" type="button" data-a="${act}" data-id="${esc(id || '')}">${label}</button></div></div></div>`;

  function item(c, all) {
    const mine = !!me && me.uid === c.uid, canDel = !!me && (mine || me.admin);
    const kids = all.filter((k) => k.parent === c.id);
    const head = `<div class="cm-h"><span class="av" style="background:${colorOf(c.uid)}" aria-hidden="true">${esc(String(c.name || '?').charAt(0))}</span><b>${esc(c.name)}</b>${c.admin ? '<span class="lock" style="margin-left:0">관리자</span>' : ''}<time datetime="${tsOf(c.createdAt).toISOString()}">${fdt(c.createdAt)}</time>${c.editedAt && !c.gone ? '<span class="hint">(수정됨)</span>' : ''}</div>`;
    let main = '', acts = '';
    if (c.gone) main = '<p class="cm-t gone">삭제된 댓글입니다.</p>';
    else if (editing === c.id) main = composer('edit', draft.edit, '저장', 'esave', c.id, 'ecancel');
    else {
      main = `<p class="cm-t">${rich(c.text)}</p>`;
      acts = `<div class="cm-a">${me ? `<button class="btn sm" type="button" data-a="reply" data-id="${esc(c.id)}">답글</button>` : ''}${mine ? `<button class="btn sm" type="button" data-a="edit" data-id="${esc(c.id)}">수정</button>` : ''}${canDel ? `<button class="btn sm danger${cDel === c.id ? ' sure' : ''}" type="button" data-a="cdel" data-id="${esc(c.id)}">${cDel === c.id ? '정말 삭제할까요?' : '삭제'}</button>` : ''}</div>`;
    }
    const rc = replyTo === c.id && me ? composer('reply', draft.reply, '답글 등록', 'rpost', c.id, 'rcancel') : '';
    return `<li class="cm" id="c-${esc(c.id)}">${head}${main}${acts}${rc}${kids.length ? `<ul class="cm-k">${kids.map((k) => item(k, all)).join('')}</ul>` : ''}</li>`;
  }

  function render(keepFocus) {
    const roots = list.filter((c) => !c.parent), n = list.filter((c) => !c.gone).length;
    const policy = `<a href="${root}privacy.html">개인정보 처리방침</a>`;
    const compose = me
      ? `<span class="hint">${esc(me.name)}(으)로 댓글을 쓰고 있어요. 이름과 작성 시각이 공개돼요 · ${policy}</span>${composer('new', draft.new, '댓글 등록', 'cpost', '', '')}`
      : `<div class="cm-login"><p>댓글을 쓰려면 Google로 로그인하세요. 글은 로그인하지 않아도 읽을 수 있어요.</p><p class="hint">로그인하면 구글 프로필 이름이 댓글에 표시돼요 · ${policy}</p><button class="btn gbtn" type="button" data-a="glogin"><span class="gdot" aria-hidden="true">G</span> Google로 로그인</button></div>`;
    box.innerHTML = `<h2 class="sec" id="cmh">댓글 ${n}</h2>${msg ? `<p class="notice${warn ? ' warn' : ''}" role="${warn ? 'alert' : 'status'}">${esc(msg)}</p>` : ''}${compose}${roots.length ? `<ul class="cm-l">${roots.map((r) => item(r, list)).join('')}</ul>` : '<p class="empty">아직 댓글이 없어요. 첫 댓글을 남겨 보세요.</p>'}`;
    msg = ''; warn = false;
    if (keepFocus) focusTa(keepFocus);
  }
  const focusTa = (k) => { const t = box.querySelector(`[data-ta="${k}"]`); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } };
  const say = (m, w) => { msg = m; warn = !!w; };
  const syncTa = () => { ['new', 'reply', 'edit'].forEach((k) => { const t = box.querySelector(`[data-ta="${k}"]`); if (t) draft[k] = t.value; }); };
  const byId = (id) => list.find((c) => c.id === id);
  async function refresh(k) { try { await load(); } catch (e) { say('댓글을 불러오지 못했어요.', true); } render(k); }

  function suggest(ta, key) {
    const sug = box.querySelector(`[data-sug="${key}"]`); if (!sug) return;
    const pos = ta.selectionStart, m = ta.value.slice(0, pos).match(/(^|\s)@([^\s@]*)$/);
    if (!m) { sug.hidden = true; sug.innerHTML = ''; return; }
    const q = m[2].toLowerCase(), mine = me ? hnd(me.name) : '';
    const found = people().filter((h) => h !== mine && h.toLowerCase().startsWith(q)).slice(0, 5);
    if (!found.length) { sug.hidden = true; sug.innerHTML = ''; return; }
    sug.dataset.start = pos - m[2].length - 1;
    sug.innerHTML = found.map((h) => `<button type="button" class="sg" role="option" data-a="mention" data-key="${key}" data-h="${esc(h)}">@${esc(h)}</button>`).join('');
    sug.hidden = false;
  }

  box.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.sg')) e.preventDefault(); });
  box.addEventListener('input', (e) => { const t = e.target; if (t.dataset && t.dataset.ta) { draft[t.dataset.ta] = t.value; suggest(t, t.dataset.ta); } });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, id = b.dataset.id;
    if (a === 'glogin') return signIn();
    if (a === 'mention') {
      const key = b.dataset.key, ta = box.querySelector(`[data-ta="${key}"]`), sug = box.querySelector(`[data-sug="${key}"]`);
      const start = Number(sug.dataset.start), pos = ta.selectionStart;
      ta.value = ta.value.slice(0, start) + '@' + b.dataset.h + ' ' + ta.value.slice(pos);
      const np = start + b.dataset.h.length + 2; ta.focus(); ta.setSelectionRange(np, np); draft[key] = ta.value; sug.hidden = true; sug.innerHTML = '';
      return;
    }
    if (!me) return;
    syncTa();
    try {
      if (a === 'cpost') {
        const text = draft.new.trim(); if (!text) return;
        await F.addDoc(F.collection(db, 'comments'), { post: postId, parent: '', uid: me.uid, name: me.name, admin: me.admin, text, mentions: mentionsIn(text), createdAt: F.serverTimestamp() });
        draft.new = ''; say('댓글을 등록했어요.'); await refresh();
      } else if (a === 'reply') {
        const t = byId(id); if (!t) return;
        replyTo = id; editing = ''; draft.reply = t.uid !== me.uid ? '@' + hnd(t.name) + ' ' : ''; render('reply');
      } else if (a === 'rcancel') { replyTo = ''; draft.reply = ''; render();
      } else if (a === 'rpost') {
        const t = byId(id), text = draft.reply.trim(); if (!t || !text) return;
        await F.addDoc(F.collection(db, 'comments'), { post: postId, parent: t.parent || t.id, uid: me.uid, name: me.name, admin: me.admin, text, mentions: mentionsIn(text), createdAt: F.serverTimestamp() });
        replyTo = ''; draft.reply = ''; say('답글을 등록했어요.'); await refresh();
      } else if (a === 'edit') {
        const t = byId(id); if (!t || t.uid !== me.uid) return;
        editing = id; replyTo = ''; draft.edit = t.text; render('edit');
      } else if (a === 'ecancel') { editing = ''; draft.edit = ''; render();
      } else if (a === 'esave') {
        const t = byId(id), text = draft.edit.trim(); if (!t || !text || t.uid !== me.uid) return;
        await F.updateDoc(F.doc(db, 'comments', id), { text, mentions: mentionsIn(text), editedAt: F.serverTimestamp() });
        editing = ''; draft.edit = ''; say('댓글을 수정했어요.'); await refresh();
      } else if (a === 'cdel') {
        const t = byId(id); if (!t || (t.uid !== me.uid && !me.admin)) return;
        if (cDel !== id) { cDel = id; render(); setTimeout(() => { if (cDel === id) { cDel = ''; render(); } }, 3500); return; }
        cDel = '';
        if (list.some((k) => k.parent === id)) await F.updateDoc(F.doc(db, 'comments', id), { text: '', gone: true, mentions: [] }); // 답글이 있으면 자리만 남겨요
        else {
          await F.deleteDoc(F.doc(db, 'comments', id));
          const p = t.parent && byId(t.parent); // 지워진 부모에 남은 답글이 없으면 부모도 정리해요(권한이 없으면 그대로 둬요)
          if (p && p.gone && !list.some((k) => k.parent === p.id && k.id !== id)) { try { await F.deleteDoc(F.doc(db, 'comments', p.id)); } catch (x) { /* 그대로 둬요 */ } }
        }
        say('댓글을 삭제했어요.'); await refresh();
      }
    } catch (ex) { say(errMsg(ex), true); render(); }
  });

  await refresh();
}

// ---------- @ 알림 ----------
const seenKey = 'intentSeen';
const getSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch (e) { return []; } };
async function myMentions(me) {
  const { F, db } = await fb();
  const snap = await F.getDocs(F.query(F.collection(db, 'comments'), F.where('mentions', 'array-contains', hnd(me.name))));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => !c.gone && c.uid !== me.uid).sort((a, b) => tsOf(b.createdAt) - tsOf(a.createdAt));
}
async function mentionsPage(me) {
  const box = $('mentions'); if (!box) return;
  if (!me) { box.innerHTML = '<p class="empty">로그인하면 나를 @로 부른 댓글을 볼 수 있어요.</p><p><button class="btn gbtn" type="button" id="mlogin"><span class="gdot" aria-hidden="true">G</span> Google로 로그인</button></p>'; $('mlogin').addEventListener('click', signIn); return; }
  let list = [];
  try { list = await myMentions(me); } catch (e) { box.innerHTML = '<p class="empty">알림을 불러오지 못했어요.</p>'; return; }
  const seen = new Set(getSeen()); list.forEach((c) => seen.add(c.id));
  try { localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-500))); } catch (e) { /* 무시 */ }
  box.innerHTML = list.length
    ? list.map((c) => `<div class="row nt"><span class="tag">${esc(c.name)}</span><span class="rt"><b>${esc(c.text.slice(0, 60))}</b><small><a href="${root}posts/${esc(c.post.replace(/^md-/, ''))}.html#c-${esc(c.id)}">글에서 보기</a></small></span><time>${fdt(c.createdAt)}</time></div>`).join('')
    : '<p class="empty">아직 나를 부른 댓글이 없어요.</p>';
}

// ---------- 시작 ----------
async function start() {
  const needDb = document.querySelector('[data-views], #comments, #mentions');
  const wantUser = visitorHint || adminHint || $('comments') || page === 'mentions';
  if (!needDb && !wantUser) return renderBottom(null);
  let me = null;
  if (visitorHint || adminHint) { try { me = await getMe(); } catch (e) { me = null; } if (!me) setHint('intentVisitor', false); }
  renderBottom(me);
  if (me && !me.admin) myMentions(me).then((l) => { const seen = new Set(getSeen()); renderBottom(me, l.filter((c) => !seen.has(c.id)).length); }).catch(() => {});
  await Promise.all([views(me), comments(me), mentionsPage(me)].map((p) => p.catch(() => {})));
}
const go = () => start().catch(() => {});
if (document.readyState === 'complete') go(); else addEventListener('load', go);
