// 공개 글의 읽기 측정을 구글 애널리틱스로 보내요. 공개 글 페이지에만 들어 있어요. (회고 같은 나만 보기 글에는 없어요)
//   read_progress: 본문의 25·50·75·100%에 처음 닿을 때 {post_id, depth}. 값마다 한 번만
//   post_read: 본문 끝을 봤고, 글 화면에 머문 "활성 시간"이 기준 이상일 때 {post_id}. 글당 한 번만
//   attachment_download: 첨부 파일 링크를 눌렀을 때 {post_id, file_ext}
// 완독 기준: 활성 시간 >= 예상 읽기 시간(글자 수 ÷ 분당 500자)의 40%. 최소 15초, 최대 90초. (측정 2주 뒤 분포를 보고 조정해요)
// 활성 시간은 탭이 보이고 창이 선택된 동안만 1초씩 세요. 방문자가 아무것도 누르지 않아도 이벤트가 나갈 수 있으니, 읽는 동작(스크롤·체류)이 기준이에요.
(function () {
  var send = function (name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch (e) { /* 측정이 안 돼도 화면은 그대로예요 */ } };
  var cm = document.getElementById('comments');
  var postId = (cm && cm.getAttribute('data-post')) || '';
  var body = document.querySelector('.post .body');
  if (!postId || !body) return;

  // ---- 첨부 파일 내려받기 ----
  var files = document.querySelector('.post .files');
  if (files) files.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var m = (a.textContent || '').trim().toLowerCase().match(/\.([a-z0-9]{1,6})$/);
    send('attachment_download', { post_id: postId, file_ext: m ? m[1] : '' });
  });

  // ---- 읽기 진행도와 완독 ----
  var chars = (body.textContent || '').replace(/\s+/g, '').length;
  var need = Math.min(90, Math.max(15, Math.round(chars / 500 * 60 * 0.4))); // 기준 활성 시간(초)
  var steps = [25, 50, 75, 100], sentSteps = {}, endSeen = false, active = 0, readSent = false;
  var readKey = 'pr:' + postId;
  try { if (sessionStorage.getItem(readKey)) readSent = true; } catch (e) { /* 저장소를 못 쓰면 이 화면에서만 한 번 보내요 */ }

  function check() {
    var r = body.getBoundingClientRect();
    if (!r.height) return;
    var pct = Math.max(0, Math.min(100, (window.innerHeight - r.top) / r.height * 100));
    steps.forEach(function (s) {
      if (!sentSteps[s] && pct >= s) { sentSteps[s] = 1; send('read_progress', { post_id: postId, depth: s }); }
    });
    if (r.bottom <= window.innerHeight) endSeen = true;
    if (!readSent && endSeen && active >= need) {
      readSent = true;
      try { sessionStorage.setItem(readKey, '1'); } catch (e) { /* 위와 같아요 */ }
      send('post_read', { post_id: postId });
    }
  }
  window.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check);
  setInterval(function () {
    if (document.visibilityState === 'visible' && document.hasFocus()) active++;
    check();
  }, 1000);
  check();
})();
