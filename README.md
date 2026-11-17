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

`category`는 `portfolio`, `retrospective`, `study` 중 하나입니다. 본문은 마크다운(제목 `##`, 목록 `-`, 굵게 `**`, 링크, 이미지, 코드, 인용)을 쓸 수 있습니다.

## 만들고 확인하기

```
node build.js
```

`dist/` 폴더가 만들어집니다. 그 안의 `index.html`을 열면 바로 볼 수 있어요.

## 이름과 문구 바꾸기

`site.config.json`에서 블로그 이름, 메인 문구, 소개 한 줄, 메뉴를 바꿉니다. 소개 페이지는 `about.md`입니다. 이미지는 `assets/` 폴더에 넣고 글에서 `![설명](../assets/파일.jpg)`로 넣어 주세요.

## 인터넷에 올리기

`dist/` 폴더를 Vercel, Netlify, GitHub Pages 같은 곳에 올리면 됩니다.
