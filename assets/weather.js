// 서울 날씨. 서버 함수(/api/weather)가 돌려주는 값만 보여 줘요.
// 컴퓨터 화면은 사이드바 하단, 모바일 화면은 맨 아래 푸터 위 칸을 써요. (같은 칸이 두 군데 있고 CSS가 하나만 보이게 해요)
// 불러오지 못하면 아무것도 보이지 않게 두어서 글 읽기에는 영향이 없어요.
(function () {
  var els = document.querySelectorAll('.wx');
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
  getJson('/api/weather', 1)
    .then(function (d) {
      if (!d || typeof d.temp !== 'number') return;
      Array.prototype.forEach.call(els, function (el) {
        var t = document.createElement('div'); t.className = 'wt';
        t.textContent = d.place + ' ' + d.temp + '°C';
        var s = document.createElement('div'); s.className = 'ws';
        s.textContent = (d.humidity != null ? '습도 ' + d.humidity + '% · ' : '') + d.precip;
        var c = document.createElement('div'); c.className = 'wc'; c.textContent = '출처: 기상청';
        el.textContent = '';
        el.appendChild(t); el.appendChild(s); el.appendChild(c);
        el.hidden = false;
        if (el.parentNode) el.parentNode.classList.add('on');
      });
    })
    .catch(function () { /* 날씨는 덤이라 조용히 넘어가요 */ });
})();
