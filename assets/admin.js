// 관리자 화면(로그인, 글쓰기)의 화면 동작. 저장과 로그인은 파이어베이스를 연결할 때 붙입니다.
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // ---- 로그인 ----
  var f = $('f');
  if (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var em = $('em'), pw = $('pw'), err = $('err');
      em.setAttribute('aria-invalid', !em.value);
      pw.setAttribute('aria-invalid', !pw.value);
      err.textContent = !em.value || !pw.value
        ? '이메일과 비밀번호를 모두 입력해 주세요.'
        : '아직 파이어베이스와 연결되지 않아 로그인되지 않아요.';
    });
  }

  // ---- 글쓰기 ----
  var pub = $('pub');
  if (!pub) return;
  var priv = $('priv'), hint = $('vhint');
  function vis(isPub) {
    pub.setAttribute('aria-pressed', isPub);
    priv.setAttribute('aria-pressed', !isPub);
    hint.textContent = isPub ? '누구나 읽을 수 있어요.' : '로그인한 관리자만 볼 수 있어요.';
  }
  pub.onclick = function () { vis(true); };
  priv.onclick = function () { vis(false); };

  var tw = $('tw'), tp = $('tp'), wrap = $('bodywrap'), pv = $('pv'), ta = $('body');
  function inline(parent, text) {
    text.split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        var s = document.createElement('strong');
        s.textContent = part.slice(2, -2);
        parent.appendChild(s);
      } else if (part) {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }
  function preview() {
    pv.textContent = '';
    var ul = null;
    ta.value.split('\n').forEach(function (line) {
      var el;
      if (/^[-*] /.test(line)) {
        if (!ul) { ul = document.createElement('ul'); pv.appendChild(ul); }
        el = document.createElement('li');
        inline(el, line.slice(2));
        ul.appendChild(el);
        return;
      }
      ul = null;
      if (/^#{1,3} /.test(line)) {
        el = document.createElement('h2');
        inline(el, line.replace(/^#+ /, ''));
      } else if (/^> /.test(line)) {
        el = document.createElement('blockquote');
        inline(el, line.slice(2));
      } else if (line.trim()) {
        el = document.createElement('p');
        inline(el, line);
      }
      if (el) pv.appendChild(el);
    });
    if (!pv.firstChild) pv.textContent = '미리 볼 내용이 없어요.';
  }
  function tab(isWrite) {
    tw.setAttribute('aria-selected', isWrite);
    tp.setAttribute('aria-selected', !isWrite);
    wrap.hidden = !isWrite;
    pv.hidden = isWrite;
    if (!isWrite) preview();
  }
  tw.onclick = function () { tab(true); };
  tp.onclick = function () { tab(false); };

  var notice = $('notice');
  document.querySelectorAll('[data-need-backend]').forEach(function (b) {
    b.addEventListener('click', function () {
      notice.hidden = false;
      notice.textContent = '아직 파이어베이스와 연결되지 않아 저장되지 않아요.';
    });
  });
})();
