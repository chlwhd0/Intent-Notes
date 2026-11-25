// 공개 글의 "공유하기": 링크 복사, X, Facebook, LinkedIn. 공개 글 페이지에만 들어 있어요.
(function () {
  var btn = document.getElementById('sharebtn');
  var panel = document.getElementById('sharep');
  if (!btn || !panel) return;
  var input = document.getElementById('surl');
  var msg = document.getElementById('smsg');
  var links = document.getElementById('slinks');
  var canon = document.querySelector('link[rel="canonical"]');
  var url = (canon && canon.href) || location.href.split('#')[0].split('?')[0];
  var title = (document.querySelector('h1') || {}).textContent || document.title;
  var e = encodeURIComponent(url), t = encodeURIComponent(title);
  input.value = url;
  // 구글 애널리틱스 이벤트 share {post_id, method: copy|x|facebook|linkedin}. 링크 복사는 복사에 성공했을 때만 보내요.
  var cm = document.getElementById('comments');
  var postId = (cm && cm.getAttribute('data-post')) || '';
  var track = function (method) { try { if (postId && typeof window.gtag === 'function') window.gtag('event', 'share', { post_id: postId, method: method }); } catch (x) { /* 측정이 안 돼도 공유는 그대로예요 */ } };
  [['X에 공유', 'https://twitter.com/intent/tweet?url=' + e + '&text=' + t, 'x'],
   ['Facebook에 공유', 'https://www.facebook.com/sharer/sharer.php?u=' + e, 'facebook'],
   ['LinkedIn에 공유', 'https://www.linkedin.com/sharing/share-offsite/?url=' + e, 'linkedin']].forEach(function (l) {
    var a = document.createElement('a');
    a.href = l[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = l[0];
    a.addEventListener('click', function () { track(l[2]); });
    links.appendChild(a);
  });
  btn.addEventListener('click', function () {
    var open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open);
    msg.textContent = '';
  });
  document.getElementById('copybtn').addEventListener('click', function () {
    function done(m) { msg.textContent = m; }
    function fallback() {
      input.focus(); input.select();
      try { if (document.execCommand('copy')) { done('복사했어요.'); track('copy'); return; } } catch (x) { /* 아래 안내로 */ }
      done('주소를 선택했어요. Ctrl+C(Mac은 Cmd+C)로 복사해 주세요.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done('복사했어요.'); track('copy'); }, fallback);
    else fallback();
  });
})();
