// 오늘의 고양이. 서버 함수(/api/cat)가 알려 주는 사진 하나를 보여 줘요.
// 컴퓨터 화면은 사이드바 하단, 모바일 화면은 맨 아래 푸터 위 칸을 써요. (같은 칸이 두 군데 있고 CSS가 하나만 보이게 해요)
// 불러오지 못하면 아무것도 보이지 않게 두어서 글 읽기에는 영향이 없어요.
(function () {
  var els = document.querySelectorAll('.cat');
  if (!els.length) return;
  // 서버가 막 켜지는 중이면 한 번 실패할 수 있어서, 2.5초 뒤 한 번만 다시 시도해요.
  function getJson(u, n) {
    return fetch(u, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); })
      .catch(function (e) {
        if (n > 0) return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return getJson(u, n - 1); });
        throw e;
      });
  }
  getJson('/api/cat', 1)
    .then(function (d) {
      if (!d || typeof d.url !== 'string' || d.url.indexOf('https://cdn2.thecatapi.com/') !== 0) return;
      Array.prototype.forEach.call(els, function (el) {
        var img = document.createElement('img');
        img.className = 'cimg'; img.alt = '무작위 고양이 사진'; img.decoding = 'async';
        img.referrerPolicy = 'no-referrer'; img.title = '오늘의 고양이 · 출처: TheCatAPI';
        img.onerror = function () { el.hidden = true; };
        img.src = d.url;
        var cap = document.createElement('div'); cap.className = 'ccap';
        var a = document.createElement('b'); a.textContent = '오늘의 고양이';
        var b = document.createElement('span'); b.textContent = '출처: TheCatAPI';
        cap.appendChild(a); cap.appendChild(b);
        el.textContent = '';
        el.appendChild(img); el.appendChild(cap);
        el.hidden = false; // 먼저 보이게 해야 사진을 불러와요 (숨긴 칸 안의 사진은 브라우저가 불러오지 않아요)
        if (el.parentNode) el.parentNode.classList.add('on');
      });
    })
    .catch(function () { /* 사진은 덤이라 조용히 넘어가요 */ });
})();
