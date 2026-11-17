# AI PM 블로그

시안 2 디자인으로 만든 정적 블로그입니다. 따로 설치할 것 없이 Node.js만 있으면 됩니다.

## 글 쓰기

`posts/` 폴더에 `.md` 파일을 하나 만들면 글 한 편이 됩니다. 파일 맨 위에 아래 다섯 줄을 적어 주세요.

```
---
title: 글 제목
date: 2026-11-20
category: portfolio
summary: 목록에 보일 한두 문장 요약
---
```

`category`는 `portfolio`, `retrospective`, `study` 중 하나입니다. 공개 글(`portfolio`, `study`)은 `posts/` 폴더에 둡니다. 본문은 마크다운(제목 `##`, 목록 `-`, 굵게 `**`, 링크, 이미지, 코드, 인용)을 쓸 수 있습니다.

## 회고는 나만 보는 글

회고(`retrospective`)는 `private/` 폴더에 쓰세요. 이 폴더는 깃헙에 올라가지 않고, 기본 빌드에도 들어가지 않습니다. `posts/`에 회고 글을 두면 빌드가 오류로 알려 줍니다. 내 컴퓨터에서 회고까지 포함해 보려면 아래처럼 빌드하세요. 이 결과(`dist/`)는 인터넷에 올리지 마세요.

```
node build.js --with-private
```

## 만들고 확인하기

```
node build.js
```

`dist/` 폴더가 만들어집니다. 그 안의 `index.html`을 열면 바로 볼 수 있어요.

## 이름과 문구 바꾸기

`site.config.json`에서 블로그 이름, 메인 문구, 소개 한 줄, 메뉴를 바꿉니다. 소개 페이지는 `about.md`입니다. 이미지는 `assets/` 폴더에 넣고 글에서 `![설명](../assets/파일.jpg)`로 넣어 주세요.

## 인터넷에 올리기

`dist/` 폴더를 Vercel, Netlify, GitHub Pages 같은 곳에 올리면 됩니다.

## 검색 노출(SEO) 설정

`site.config.json`에서 아래 값을 채워 주세요. 값이 없으면 해당 기능은 건너뛰고, 빌드가 끝날 때 알림으로 알려 줘요.

| 설정 | 하는 일 |
|---|---|
| `siteUrl` | 사이트 주소(예: `https://내주소.com`). 대표 주소(canonical), 사이트맵, RSS, 공유 이미지 주소를 만드는 데 꼭 필요해요. 빌드할 때 `node build.js --site-url=https://내주소.com`로 넣어도 돼요. |
| `description` | 첫 화면과 공유 카드에 쓰는 사이트 설명(80~150자 정도) |
| `cleanUrls` | `true`로 하면 주소에서 `.html`을 뗀 형태(`/posts/글이름`)를 대표 주소로 써요. 호스팅도 같은 방식으로 설정해야 해요. |
| `ogImage` | 글에 이미지가 없을 때 공유 카드에 쓰는 기본 이미지(1200x630 PNG/JPG) |
| `googleVerification`, `naverVerification` | 구글 서치콘솔, 네이버 서치어드바이저에서 받은 확인 코드 |

글 머리말에 `description`(검색 결과 설명)과 `image`(공유 이미지 경로, PNG/JPG)를 적으면 그 글에만 따로 적용돼요. 없으면 `summary`와 기본 이미지를 써요.

빌드하면 자동으로 만들어지는 것: 글마다 설명(description)·공유 카드·구조화 데이터(BlogPosting, 글 경로), `sitemap.xml`, `robots.txt`, `rss.xml`, `404.html`, 아이콘. 관리자 화면과 404는 검색에서 빠지도록(noindex) 표시돼요. 비공개 메뉴(회고)는 어디에도 들어가지 않아요.

## 배포 후 할 일

1. 구글 서치콘솔과 네이버 서치어드바이저에 사이트를 등록하고 `sitemap.xml`을 제출해요.
2. 공유 카드가 잘 보이는지 카카오톡·X·LinkedIn에 주소를 붙여 확인해요.
3. 구글 PageSpeed Insights로 속도를 확인해요.
4. 공개 전에 `[샘플]` 글, `[이름]`, `[이메일 주소]`를 모두 바꾸거나 지워요.
