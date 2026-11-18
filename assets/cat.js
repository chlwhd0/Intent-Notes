// 사이드바 하단 "오늘의 고양이". 서버 함수(/api/cat)가 알려 주는 사진 하나를 보여 줘요.
// 불러오지 못하면 아무것도 보이지 않게 두어서 글 읽기에는 영향이 없어요.
(function () {
  var el = document.getElementById('cat');
  if (!el) return;
  fetch('/api/cat', { headers: { Accept: 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); })
    .then(function (d) {
      if (!d || typeof d.url !== 'string' || d.url.indexOf('https://cdn2.thecatapi.com/') !== 0) return;
      var img = document.createElement('img');
      img.className = 'cimg'; img.alt = '무작위 고양이 사진'; img.loading = 'lazy'; img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload = function () { el.hidden = false; };
      img.onerror = function () { el.hidden = true; };
      img.src = d.url;
      var cap = document.createElement('div'); cap.className = 'ccap';
      var a = document.createElement('b'); a.textContent = '오늘의 고양이';
      var b = document.createElement('span'); b.textContent = '출처: TheCatAPI';
      cap.appendChild(a); cap.appendChild(b);
      el.textContent = '';
      el.appendChild(img); el.appendChild(cap);
    })
    .catch(function () { /* 사진은 덤이라 조용히 넘어가요 */ });
})();
