// 글 목록의 정렬과 검색
(function () {
  var list = document.getElementById('list');
  var q = document.getElementById('q');
  if (!list || !q) return;
  var rows = Array.prototype.slice.call(list.children);
  var count = document.getElementById('count');
  var empty = document.getElementById('empty');
  var chips = document.querySelectorAll('[data-sort]');
  var order = 'desc'; // 처음 순서가 최신순

  function render() {
    var word = q.value.trim().toLowerCase();
    var shown = 0;
    var sorted = order === 'desc' ? rows : rows.slice().reverse();
    sorted.forEach(function (r) {
      list.appendChild(r);
      var hit = !word || r.getAttribute('data-q').indexOf(word) !== -1;
      r.hidden = !hit;
      if (hit) shown++;
    });
    if (count) count.textContent = shown;
    if (empty) {
      empty.hidden = shown !== 0;
      empty.textContent = rows.length ? '검색 결과가 없습니다.' : '아직 글이 없습니다.';
    }
  }

  q.addEventListener('input', render);
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      order = c.getAttribute('data-sort');
      chips.forEach(function (o) { o.setAttribute('aria-pressed', o === c); });
      render();
    });
  });
})();
