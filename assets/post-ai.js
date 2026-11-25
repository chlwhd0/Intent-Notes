// 글 상세의 AI 요약 상자와 "이어서 읽을 글" 카드 사용을 구글 애널리틱스로 보내요. (방문자 열람 중에는 AI를 부르지 않아요)
//   summary_toggle: 요약 상자를 펼치거나 접을 때 {post_id, action: open|close}
//   select_content: 이어서 읽을 글 카드를 눌렀을 때 {post_id, location: related}
(function () {
  var send = function (name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch (e) { /* 측정이 안 돼도 화면은 그대로예요 */ } };
  var box = document.getElementById('tldr');
  // 요약 상자는 처음부터 펼쳐져 있어서, 페이지가 열릴 때 브라우저가 "펼침" 이벤트를 한 번 보내요. 방문자가 누른 게 아니니 상태가 바뀔 때만 보내요.
  var last = box ? box.open : false;
  if (box) box.addEventListener('toggle', function () {
    if (box.open === last) return;
    last = box.open;
    send('summary_toggle', { post_id: box.getAttribute('data-post') || '', action: box.open ? 'open' : 'close' });
  });
  var rel = document.getElementById('related');
  if (rel) rel.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.relc');
    if (a) send('select_content', { post_id: a.getAttribute('data-post') || '', location: 'related' });
  });
})();
