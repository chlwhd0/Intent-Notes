// 글 썸네일의 기본 모양 6개와 썸네일 만드는 도우미. 빌드(build.js)와 관리자 화면이 같이 써요.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IntentThumbs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const open = '<svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
  let dots = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) dots += `<circle cx="${20 + c * 20}" cy="${18 + r * 22}" r="5"/>`;
  const THUMBS = [
    open + '<rect width="120" height="80" fill="#e5e0d8"/><circle cx="84" cy="34" r="22" fill="#b5573f"/><circle cx="46" cy="52" r="14" fill="#8d8a85"/></svg>',
    open + '<rect width="120" height="80" fill="#b5573f"/><rect x="18" y="14" width="84" height="8" fill="#fff" opacity=".9"/><rect x="18" y="32" width="64" height="8" fill="#fff" opacity=".7"/><rect x="18" y="50" width="74" height="8" fill="#fff" opacity=".5"/></svg>',
    open + '<rect width="120" height="80" fill="#8d8a85"/><g fill="#fff" opacity=".8">' + dots + '</g></svg>',
    open + '<rect width="120" height="80" fill="#2f4a6d"/><polygon points="14,70 46,16 78,70" fill="#e5e0d8"/><polygon points="58,70 84,32 110,70" fill="#b5573f"/></svg>',
    open + '<rect width="120" height="80" fill="#3f5d4a"/><path d="M20 66 A40 40 0 0 1 100 66Z" fill="#e5e0d8"/><circle cx="60" cy="30" r="8" fill="#b5573f"/></svg>',
    open + '<rect width="120" height="80" fill="#c9b79c"/><g stroke="#fff" stroke-width="5" opacity=".85"><line x1="0" y1="70" x2="70" y2="0"/><line x1="30" y1="80" x2="100" y2="10"/><line x1="70" y1="80" x2="120" y2="30"/></g></svg>',
  ];
  // 올린 이미지는 우리 파일 저장소(Firebase Storage) 주소만 받아요.
  const okImg = (u) => /^https:\/\/firebasestorage\.googleapis\.com\/[^\s"'<>]+$/.test(u || '') && String(u).length <= 800;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // thumb가 -1이면 "없음"이에요. 올린 이미지가 없을 때 썸네일을 그리지 않아요.
  const none = (p) => !(p && p.img && okImg(p.img)) && p && Number(p.thumb) === -1;
  const inner = (p) => (p && p.img && okImg(p.img) ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : none(p) ? '' : THUMBS[(Number(p && p.thumb) || 0) % THUMBS.length]);
  return { THUMBS, okImg, inner, none };
});
