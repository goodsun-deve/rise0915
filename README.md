# 가짜뉴스 판별 웹서비스 (rise0915)

받은 정치 관련 글이나 유튜브 링크를 붙여넣으면, Claude API가 **가짜뉴스 가능성(높음/낮음) · 확신도(%) · 판단 이유**를 알려주는 웹서비스입니다. 로그인·결제·DB가 없습니다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 전체 (첫 화면 ↔ 결과 화면을 한 페이지에서 전환) |
| `api/analyze.js` | 판정 API: 입력 검사 → 사용량 제한 → (유튜브면 자막) → Claude 판정 → 결과 검사 |
| `api/config.js` | 브라우저에 공개해도 되는 설정(카카오 JS 키)만 전달 |
| `api/transcript-test.js` | **임시** — 배포 서버에서 유튜브 자막을 가져올 수 있는지 시험 (시험 후 삭제) |
| `api/_lib/youtube.js` | 유튜브 링크 구분, 영상 ID 추출, 자막 가져오기 |
| `api/_lib/judge.js` | Claude 호출, 시스템 프롬프트, 응답 검사 |
| `api/_lib/rateLimit.js` | IP당 하루 사용 횟수 제한 |
| `api/_lib/messages.js` | 오류 문구 모음 |
| `vercel.json` | 판정 API 최대 실행 시간 30초 |
| `.env.example` | 환경변수 견본 |

> `api/_lib` 폴더처럼 이름이 `_`로 시작하면 Vercel이 주소(API)로 만들지 않고, 코드 안에서 불러다 쓰기만 합니다.

---

## 1. 준비물

1. **Node.js 20 이상** — https://nodejs.org 에서 LTS 설치 (설치 후 PowerShell을 새로 여세요)
2. **Claude API 키** — https://console.anthropic.com → API Keys → Create Key (결제 수단 등록 필요)
3. **Vercel 계정** — https://vercel.com (GitHub 계정으로 가입하면 편해요)
4. **카카오 JavaScript 키** — 아래 [5. 카카오톡 공유 설정](#5-카카오톡-공유-설정) 참고 (없어도 동작하며, 공유 버튼만 숨겨져요)

## 2. 설치 (PowerShell)

한 줄씩 실행하세요.

```powershell
cd C:\rise0915
```
```powershell
npm install
```
```powershell
npm install -g vercel
```
```powershell
vercel login
```

> `vercel : 이 시스템에서 스크립트를 실행할 수 없으므로…` 오류가 나오면 아래를 한 번 실행한 뒤 다시 시도하세요.
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

## 3. 로컬에서 실행

```powershell
Copy-Item .env.example .env.local
```
```powershell
notepad .env.local
```
메모장에서 `ANTHROPIC_API_KEY=` 뒤에 키를 붙여넣고 저장합니다. (카카오 키가 있으면 `KAKAO_JS_KEY=` 에도)

```powershell
vercel dev
```
처음 실행하면 질문이 몇 개 나옵니다. `Set up and develop?` → **Y**, 계정 선택 → Enter, `Link to existing project?` → **N**, 프로젝트 이름 → Enter, 디렉터리 `./` → Enter, 설정 변경 → **N**.

브라우저에서 http://localhost:3000 을 엽니다. 끝낼 때는 PowerShell에서 `Ctrl + C`.

## 4. 배포

### 4-1. Vercel에 환경변수 넣기

한 줄씩 실행하고, 물어보면 값을 붙여넣으세요.

```powershell
vercel env add ANTHROPIC_API_KEY production
```
```powershell
vercel env add KAKAO_JS_KEY production
```
```powershell
vercel env add DAILY_LIMIT production
```
(`DAILY_LIMIT`은 선택입니다. 안 넣으면 하루 20회. 모델을 바꾸고 싶으면 `ANTHROPIC_MODEL`도 같은 방법으로 추가)

> Vercel 웹사이트 → 프로젝트 → **Settings → Environment Variables** 에서 넣어도 됩니다. 환경변수를 바꾼 뒤에는 **다시 배포**해야 적용돼요.

### 4-2. 배포하기

```powershell
vercel --prod
```
마지막에 나오는 `Production: https://○○○.vercel.app` 주소가 서비스 주소입니다.

### 4-3. [최우선] 유튜브 자막 시험 (리스크 A1)

유튜브는 클라우드 서버에서 오는 요청을 막는 경우가 많습니다. **배포된 주소에서** 아래처럼 열어 보세요. (자막이 있는 영상 링크로)

```
https://○○○.vercel.app/api/transcript-test?url=https://www.youtube.com/watch?v=영상ID
```

| 화면에 나온 결과 | 뜻 |
|---|---|
| `"ok": true` 와 `"preview": "자막 앞부분…"` | **통과** — 유튜브 판정(F2) 사용 가능 |
| `"ok": false`, `"error": "FETCH_FAILED"` | **차단됨** — 유튜브 판정은 이후 과제로. 링크를 넣으면 "자막을 가져오지 못했어요" 안내가 나옵니다 |
| `"ok": false`, `"error": "NO_CAPTIONS"` | 그 영상에 자막이 없음 — 다른 영상으로 다시 시험 |

2~3개 영상으로 시험해 보고 결과를 기록하세요. 시험이 끝나면 임시 파일을 지우고 다시 배포합니다.

```powershell
Remove-Item api\transcript-test.js
```
```powershell
vercel --prod
```

## 5. 카카오톡 공유 설정

1. https://developers.kakao.com 로그인 → **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름 예: 가짜뉴스 판별)
2. 앱 선택 → **앱 키**(또는 플랫폼 키)에서 **JavaScript 키** 복사 → `.env.local`과 Vercel 환경변수 `KAKAO_JS_KEY`에 입력
3. **플랫폼 → Web → 사이트 도메인 등록**에 아래 두 개를 추가
   - `https://○○○.vercel.app` (4-2에서 받은 배포 주소)
   - `http://localhost:3000`
4. 다시 배포 (`vercel --prod`)

- 키가 없거나 카카오 SDK를 불러오지 못하면 공유 버튼은 자동으로 숨겨집니다.
- 공유 내용에는 판정 결과·확신도·요약 1문장·"AI 참고용" 문구와 서비스 링크만 들어가고, **사용자가 넣은 원문은 들어가지 않습니다.**
- (권장) 카카오 문서의 [SDK 다운로드](https://developers.kakao.com/docs/latest/ko/javascript/download) 페이지에서 2.8.3 버전의 `integrity` 값을 복사해 `index.html`의 `KAKAO_SDK_URL` 로드 부분에 `s.integrity = '복사한 값';` 한 줄을 추가하면 더 안전합니다. SDK 버전을 올릴 때는 주소의 버전 숫자도 함께 바꾸세요.

## 6. 하루 사용량 제한에 대해

- 같은 IP에서 하루(한국 시간 자정 기준) `DAILY_LIMIT`회(기본 20회)를 넘으면 "오늘 사용할 수 있는 횟수를 모두 사용했어요" 안내가 나옵니다. 빈 입력·글자 수 초과는 횟수에 세지 않습니다.
- **한계**: 기본 방식은 서버 메모리에 기록합니다. 비용은 없지만, Vercel 서버리스 함수는 필요할 때 새로 켜지거나 여러 개가 동시에 뜨기 때문에 **횟수가 초기화되거나 따로 세어질 수 있습니다.** 비용 폭탄을 완전히 막는 장치는 아니므로, Anthropic 콘솔에서 **월 사용 한도(Spend limit)** 도 함께 설정해 두세요.
- 정확하게 세고 싶다면 https://upstash.com 에서 무료 Redis를 만들고 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`을 환경변수에 넣으면 자동으로 그쪽을 사용합니다.

## 7. 완료 기준 점검 방법

| # | 확인 방법 | 기대 결과 |
|---|---|---|
| 1 | 배포 주소를 **휴대폰(다른 기기)**으로 열기 | 제목 + 입력창 + 판정하기 버튼만 보이고 주의 문구 없음 |
| 2 | 허위로 보이는 글 1개, 사실인 글 1개 판정 | 높음/낮음, 확신도 %, 판단 이유(근거 목록), 주의 문구가 모두 보임 |
| 3 | 자막 있는 유튜브 링크 판정 (A1 통과 시) | 2와 같은 형식의 결과 |
| 4 | 자막 없는 영상 / `https://youtu.be/abc` 같은 깨진 링크 | 빈 화면이 아니라 안내 문구 |
| 5 | 평소 판정 시간 확인 | 30초 안에 결과 (넘으면 "판정이 예상보다 오래 걸리고 있어요") |
| 6 | 결과 화면에서 **카카오톡으로 공유** 클릭 | 카카오톡 공유창이 뜸 |
| 7 | 테스트용으로 `DAILY_LIMIT`을 `2`로 바꿔 배포 후 3번 판정 | 3번째에 사용량 초과 안내 (확인 후 원래 값으로) |
| 8 | PC 크롬에서 `F12` → 기기 모양 아이콘 → 폭 390 | 좌우 스크롤 없이 모두 읽힘 |
| 9 | 결과 화면에서 **다시 검증하기** | 같은 페이지가 빈 입력창 상태로 돌아감 |
| 10 | `F12` → Sources 탭 / 페이지 소스 보기에서 `sk-ant` 검색 | 아무것도 안 나옴 (API 키 노출 없음) |

**남겨둘 증거**: 배포 주소 / 입력·판정 중·결과 상태 스크린샷 / 허위·정상·유튜브 케이스 결과 화면 / 카카오 공유창 화면 / Vercel 대시보드 → 프로젝트 → **Logs** 화면(오류 코드만 기록되고 입력 원문은 남지 않음).

## 8. 자주 생기는 문제

| 증상 | 확인할 것 |
|---|---|
| 항상 "지금은 판정 결과를 받지 못했어요" | Vercel 환경변수 `ANTHROPIC_API_KEY`가 들어갔는지, 넣은 뒤 다시 배포했는지, Anthropic 콘솔에 잔액이 있는지. Vercel **Logs**에 `[judge]` 줄이 찍혀 있습니다 |
| 모델 관련 오류 (404 등) | `ANTHROPIC_MODEL` 값을 https://platform.claude.com/docs/en/models/overview 의 모델 ID로 바꾸기 |
| 공유 버튼이 안 보임 | `KAKAO_JS_KEY` 설정, 카카오 앱의 Web 도메인 등록, 재배포 |
| 공유창에서 도메인 오류 | 카카오 앱의 사이트 도메인에 배포 주소가 정확히(https 포함) 등록됐는지 |
