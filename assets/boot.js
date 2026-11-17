// 관리자 로그인 표시가 있는 브라우저에서만 관리자 코드를 불러와요. 일반 방문자의 화면은 가볍게 유지해요.
(function () {
  try {
    if (localStorage.getItem('intentAdmin') !== '1') return;
    var s = document.createElement('script');
    s.type = 'module';
    s.src = (document.body.getAttribute('data-root') || '') + 'assets/admin-app.js';
    document.head.appendChild(s);
  } catch (e) { /* 저장소를 못 쓰는 브라우저는 방문자 화면 그대로 둬요 */ }
})();
