# 함수 배포 뒤 새 화면 파일이 사이트에 안 나감

## 막힌 일
`firebase deploy --only functions,hosting`을 하면 끝에 이런 오류가 나왔어요.

```
Error: Functions successfully deployed but could not set up cleanup policy in location asia-northeast3.
```

그 뒤 실제 사이트에서 새 스타일·스크립트(`/assets/cat.js` 등)가 404이고, `/api/...` 주소도 연결되지 않았어요.

## 원인
함수는 배포됐지만 오류 때문에 명령이 **호스팅 공개 단계 전에** 끝났어요. 호스팅 파일은 올라갔지만 공개(release)되지 않았어요. 오류의 직접 원인은 함수 빌드 이미지의 정리 정책을 아직 설정하지 않은 것이에요.

## 푼 방법
`deploy --only hosting`을 한 번 더 실행했어요. 그러면 "release complete"가 나오고 새 파일이 공개돼요. 실제 주소에서 새 파일이 보이는지 확인했어요.

## 다음에 조심할 것
함수와 호스팅을 함께 배포하면 이 오류가 보여도 호스팅을 한 번 더 배포하고 실제 주소를 확인해요(배포 스킬 `blog-ship`에 이 절차가 들어 있어요). 근본 해결은 `firebase functions:artifacts:setpolicy`로 정리 정책을 설정하는 것인데 아직 하지 않았어요.
