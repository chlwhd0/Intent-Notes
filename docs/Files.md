# 파일 목록 (무슨 파일인지 한글로 설명)

파일 이름은 짧은 영어로 짓기 때문에, 나중에 무슨 파일인지 잊을 수 있어서 만든 목록입니다. **파일을 새로 만들거나 이름을 바꾸거나 지우면 이 문서도 함께 고칩니다.** (작성일 2026-11-24)

## 맨 위 (프로젝트 바로 아래)

- `CLAUDE.md` → 에이전트(Claude Code)가 지킬 규칙을 적은 개발 지침. 명령, 배포 후 확인, 필수 요구사항, 유저스토리, 주의사항이 있다
- `AGENTS.md` → `CLAUDE.md`를 가리키는 바로가기(심볼릭 링크). 다른 도구(Codex 등)도 같은 지침을 읽게 한다
- `README.md` → 사람이 읽는 안내 문서(블로그 소개, 쓰는 법)
- `build.js` → 모든 페이지(홈, 글, 소개, 관리자 화면 등)를 만드는 파일. 서버 함수 `site`도 이 파일을 복사해서 쓴다
- `site.config.json` → 블로그 이름, 한 줄 소개, 사이트 주소, 분석 ID, 작성자 이름 같은 기본 설정
- `about.md` → 소개(ABOUT) 페이지의 글 원문
- `privacy.md` → 개인정보 처리방침 페이지의 글 원문
- `firebase.json` → 파이어베이스 배포 설정. 호스팅, 서버 함수, 보안 규칙, 주소 연결(`/api/weather`, `/api/cat`, `/api/ai`)
- `.firebaserc` → 이 폴더가 연결된 파이어베이스 프로젝트(`my-blog-test-b439a`) 지정
- `firestore.rules` → 데이터베이스(글·댓글·조회수) 보안 규칙. 누가 읽고 쓸 수 있는지 정한다
- `firestore.indexes.json` → 데이터베이스 검색을 빠르게 하는 색인 설정
- `storage.rules` → 파일 저장소(이미지·첨부 파일) 보안 규칙. 용량과 파일 형식 제한이 있다
- `.gitignore` → 깃에 올리지 않을 파일 목록(`dist/`, `private/`, `.env`, `.claude/` 등)

## `assets/` (방문자·관리자 브라우저에서 도는 스크립트와 스타일)

- `style.css` → 모든 화면의 모양(색, 글꼴, 배치)
- `site.js` → 방문자 화면 동작. 조회수 세기, 구글 로그인, 댓글, @ 알림
- `admin-app.js` → 관리자 화면 동작. 글쓰기(AI 도우미 포함), 회고 정리, AI 이용 현황, 글 관리, 메뉴 관리, 관리자 로그인, 로그인 상태의 사이드바
- `boot.js` → 관리자 로그인 표시가 있는 브라우저에서만 관리자 코드를 불러오는 시작 코드
- `list.js` → 글 목록의 검색과 정렬 동작
- `share.js` → 공유하기(링크 복사, X·Facebook·LinkedIn). 공유했다는 사실도 구글 애널리틱스로 보낸다
- `check.js` → 발행 전 점검 규칙(자리표시자·전화번호·정확한 수치)과 글 지문(해시). 관리자 화면과 빌드가 함께 쓴다
- `admin-ai.js` → 관리자 글쓰기 화면의 AI 도우미 패널 화면 조각, 오류 문구
- `post-ai.js` → 글 상세의 3줄 요약 펼침·접힘, 이어서 읽을 글 클릭을 구글 애널리틱스로 보낸다
- `post-events.js` → 공개 글의 읽기 진행도(25·50·75·100%), 완독, 첨부 파일 내려받기를 구글 애널리틱스로 보낸다
- `analytics.js` → 구글 애널리틱스(GA4) 연결. 관리자 브라우저는 측정에서 뺀다
- `cat.js` → 오늘의 고양이 사진을 불러와 화면에 보여 주는 코드
- `weather.js` → 서울 날씨를 불러와 화면에 보여 주는 코드
- `markdown.js` → 마크다운 글을 화면용 HTML로 바꾸는 코드
- `sanitize.js` → 글에 심은 위험한 코드를 걸러내는 코드(빌드, 관리자, 서버가 함께 쓴다)
- `thumbs.js` → 기본 썸네일 6개 모양을 그리는 코드
- `firebase-config.json` → 파이어베이스 웹 연결 설정(공개되어도 되는 값)
- `favicon.svg` → 브라우저 탭에 보이는 작은 아이콘
- `icon-192.png` → 앱 아이콘(192픽셀)
- `apple-touch-icon.png` → 아이폰 홈 화면에 추가할 때 쓰는 아이콘
- `og-default.png` → 링크를 공유할 때 보이는 기본 대표 이미지(1200x630)

## `functions/` (서버 함수, 파이어베이스에서 돌아간다)

- `index.js` → 서버 함수 4개를 정의. `site`(페이지를 그려서 돌려줌), `weather`(날씨), `cat`(고양이 사진), `ai`(AI 도우미, 관리자만)
- `ai.js` → AI 도우미의 두뇌. 글 내용을 Anthropic에 물어보고 요약·점검·회고 결과를 정해진 모양으로 돌려준다
- `weather.js` → 기상청에서 서울 실시간 날씨를 가져와 정리하는 코드
- `cat.js` → TheCatAPI에서 고양이 사진 주소를 가져오는 코드
- `package.json` → 서버 함수가 쓰는 라이브러리 목록과 실행 환경(Node 22)
- `package-lock.json` → 라이브러리의 정확한 버전을 고정한 파일
- `.gitignore` → 서버 폴더에서 올리지 않을 것(`node_modules/`, `site/`)

## `docs/` (문서)

- `Files.md` → 이 문서. 파일 이름이 무슨 내용인지 한글로 설명
- `decisions.md` → 의사결정 기록. 정한 것을 날짜 순서로 적었다
- `PRD-Blog.md` → 블로그 기획서(기획 단계의 요구사항 정의서, v0.3)
- `PRD-Improve1.md` → 1차 개선 기획서. 데이터 분석(GA4 측정) 개선
- `PRD-Improve2.md` → 2차 개선 기획서. AI 기능(글쓰기 보조, 발행 전 점검 등)
- `PRD-Improve2-Short.md` → 2차 개선(AI 기능) 기획서를 줄여 쓴 문서. 원본(`PRD-Improve2.md`)은 그대로 두고 따로 저장한 것
- `GA-Taxonomy.pdf`, `GA-Taxonomy.html` → GA 이벤트 택소노미 보고서 v1.0(지금 적용된 이벤트 체계). PDF와 HTML은 같은 내용
- `Test-Admin.pdf` → 관리자 글쓰기 기능 테스트 결과 보고서
- `Test-Blog.pdf` → 블로그 화면 전체 테스트 결과 보고서
- `Test-AI.pdf` → AI 기능(글쓰기 보조, 발행 전 점검, 3줄 요약 등) 테스트 결과 보고서. 23개 항목, 2026-11-24 실제 사이트에서 시험
- `Test-AI-Short.pdf` → `Test-AI.pdf`의 2쪽 요약본(23개 항목의 입력·기대값·출력·결과 표, 발견한 문제, 확인하지 못한 것)
- `Test-Improve2.md` → 2차 개선 PRD의 기획 의도(문제 4개, 원칙 3개, 성공 지표)를 기준으로 한 시험 보고서. 44개 항목의 입력·기대값·결과값·판정, 발견한 문제 3개, 확인하지 못한 것, 기획 의도별 판정(2026-11-25)

### `docs/failures/` (막혔던 일과 푼 방법)

- `template.md` → 실패 로그를 쓸 때 복사해서 쓰는 양식
- `deploy-cache.md` → 배포 후 옛 스크립트가 캐시에 남아 관리자 화면이 "로그인 확인 중…"에서 멈춘 일
- `deploy-hosting.md` → 함수를 배포한 뒤 새 화면 파일이 사이트에 나가지 않은 일(호스팅이 공개되지 않음)
- `func-memory.md` → 날씨·고양이 함수가 메모리 초과로 오류(500)를 낸 일
- `hidden-lazy-img.md` → 숨겨 둔 칸 안의 고양이 사진이 화면에 안 뜬 일
- `login-wipes-sidebar.md` → 로그인 상태를 그리는 코드가 사이드바에 넣어 둔 칸을 지운 일

## `posts/`

- `.gitkeep` → 빈 폴더를 깃에 남겨 두기 위한 표시 파일. 지금 글은 파일이 아니라 데이터베이스에 있다

## `docs/sample-posts/`

- `pf-*.md` 13개 → 포트폴리오 메뉴의 AI PM 샘플 글(이 블로그를 만든 과정 11편, 연습용 가상 사례 2편). 머리말에 메뉴·날짜·썸네일 번호가 있다
- `st-*.md` 13개 → 스터디 메뉴의 AI PM 학습 노트 샘플 글(역할, LLM 기초, 프롬프트, 환각, 평가, RAG, 비용, 지표, 신뢰 UX, 개인정보, 에이전트, PRD 체크리스트, 모델 선택)
- 이 글들은 2026-11-25에 관리자 글쓰기로 **데이터베이스에 올렸다.** 이 폴더는 내용을 남겨 두는 원본이고, 사이트는 이 파일을 읽지 않는다. `posts/`로 옮기면 내 컴퓨터 미리보기에만 보이고(서버는 파일 글을 쓰지 않는다), 다시 올리면 중복이 된다

## `prototypes/` (코드에 반영하지 않은 시안과 체험판)

아래는 모두 실제 블로그에 반영되지 않은 시안이다. 처음 만든 체험판(`trial.html`)도 2026-11-24에 여기로 합쳤다(예전 `prototype/` 폴더).

- `index-tailwind.html` → 블로그 전체 화면을 Tailwind CSS로 다시 꾸민 리디자인 시안
- `asis-tobe-comparison.html` → 지금 화면(AS-IS)과 리디자인(TO-BE)을 화면 캡처로 비교한 문서
- `ai-features-mockups.html` → AI 기능 6가지(글쓰기 보조, 발행 전 점검, 첨부 요약, 회고 정리, 3줄 요약, 관련 글 추천) 시안
- `admin-views-A-simple.html` → 관리자 조회수 화면의 간단한 시안(막대와 숫자)
- `admin-views-B-chartjs.html` → 관리자 조회수 화면의 Chart.js 그래프 시안
- `proto-1-hacker-news.html` → 홈에 Hacker News 인기 글을 보여 주는 시안(Hacker News API)
- `proto-2-wikipedia.html` → 글 속 용어에 위키백과 설명 카드를 보여 주는 시안(Wikipedia API)
- `proto-3-weather-sidebar.png` → 사이드바 하단 서울 날씨 화면 캡처
- `proto-4-cat-weather-sidebar.png` → 사이드바 하단 오늘의 고양이 + 날씨 화면 캡처
- `trial.html` → 처음 디자인한 체험판. 파일 하나로 열리는 모형(실제 로그인·저장은 되지 않는다). 이전 이름 `prototype/intent-notes-trial.html`
- `trial-readme.md` → 체험판 사용 안내(무엇을 눌러 볼 수 있는지, 모형이라 알아 둘 점). 이전 이름 `prototype/README.md`

## 깃에 올라가지 않는 폴더와 파일 (이 컴퓨터에만 있다)

- `dist/` → `node build.js`가 만든 결과물(이미지·스타일·스크립트). 배포할 때 쓰고 깃에는 올리지 않는다
- `functions/site/` → `build.js`가 서버 함수용으로 복사해 둔 파일. 자동으로 만들어진다
- `functions/node_modules/`, `node_modules/` → 설치된 라이브러리
- `private/` → 회고 글(나만 보기). 깃에 올리지 않는다. 지금은 샘플 파일 `sample-retrospective.md`(회고 글 예시) 하나가 있다
- `.claude/` → 이 컴퓨터의 Claude Code 설정과 스킬(`skills/blog-ship/` = 배포·확인·커밋 루틴, `skills/mock-first/` = 화면 수정을 시안으로 먼저 보여 주는 루틴, `skills/local-harness/` = 가짜 파이어베이스·AI로 관리자 화면을 로컬에서 눌러 보는 루틴(`scripts/server.js`가 시험용 서버), `skills/wrap-docs/` = 문서 갱신과 한국어 커밋 마무리, `skills/prd-gap/` = PRD와 구현 비교 점검, `skills/key-rotate/` = API 키 등록·교체 안내)
- `.firebase/` → 파이어베이스 배포 도구가 만드는 임시 기록
- `.env`, `.env.*` → 비밀 값을 두는 파일(있다면). 깃에 올리지 않는다
