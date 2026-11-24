# 날씨·고양이 함수가 500 오류를 냄 (메모리 초과)

## 막힌 일
`/api/cat`과 `/api/weather`가 가끔 "500 Server Error"를 돌려줘서 사진이나 날씨가 뜨다 말다 했어요. 관리자로 본 홈에서 고양이만 안 보이기도 했어요. 서버 기록(`functions:log`)에는 이런 줄이 반복됐어요.

```
Memory limit of 128 MiB exceeded with 134 MiB used.
The request failed because the instance could not start successfully.
```

## 원인
`weather`와 `cat` 함수를 메모리 128MiB로 설정했는데, 두 함수가 사이트를 그리는 함수(`site`)와 같은 `functions/index.js` 안에 있어서 시작할 때 그 코드까지 모두 불러와요. 시작만으로 134~142MiB를 써서 한도를 넘었어요.

## 푼 방법
- 두 함수의 메모리를 256MiB로 올렸어요(`functions/index.js`).
- 서버가 막 켜지는 중이라 한 번 실패해도 2.5초 뒤 한 번 더 시도하게 했어요(`assets/cat.js`, `assets/weather.js`).
- 배포 뒤 두 주소를 15번씩 불러 모두 200인지, 기록에 메모리 오류가 더 없는지 확인했어요.

## 다음에 조심할 것
같은 `index.js`에 있는 함수는 가벼워 보여도 파일 전체를 불러와요. 새 함수를 만들면 배포 뒤 연속 호출과 `functions:log`로 메모리 오류가 없는지 확인해요.
