// 구글 애널리틱스(GA4). site.config.json의 analyticsId(G-로 시작)가 있을 때만 페이지에 들어가요.
// 관리자가 로그인한 브라우저에서는 측정하지 않아요. 내 방문이 방문자 숫자에 섞이지 않게 하려는 거예요.
(function () {
  var s = document.currentScript;
  var id = s && s.getAttribute('data-id');
  if (!id || !/^G-[A-Z0-9]{6,14}$/.test(id)) return;
  try { if (localStorage.getItem('intentAdmin') === '1') { window['ga-disable-' + id] = true; return; } } catch (e) { /* 저장소를 못 쓰면 그대로 측정해요 */ }
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id);
  var g = document.createElement('script');
  g.async = true;
  g.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.appendChild(g);
})();
