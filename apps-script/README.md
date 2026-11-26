# 1:1 비밀글 게시판 백엔드 (Google Apps Script)

`sdmusic.co.kr` 의 `#consult` 1:1 비밀글 게시판이 사용하는 API입니다.
글은 원석님 구글 드라이브의 스프레드시트에 저장되고, 사이트는 배포된 웹 앱 URL로만 접근합니다.

## 구성

| 항목 | 값 |
| --- | --- |
| 스프레드시트 | `SD보컬학원_1대1_비밀글_게시판` (탭 `inquiries`) |
| 시트 ID | `1WJVlqqLc-y4K7EU7-o3eyH7K0oQ461NPeSkMrEE0UYk` |
| Apps Script 프로젝트 | `SD보컬학원 1:1 비밀글 게시판 API` (계정 `cd3000xl@gmail.com`) |
| 배포 방식 | 웹 앱 · 실행: 나 · 액세스: 모든 사용자 |
| 웹 앱 URL | 사이트의 `index.html` 안 `BD_API` 값 |

## 시트 컬럼

`id | created_at | author | title | content | password_hash | status | answer | answered_at | deleted`

- `password_hash` 는 `솔트:SHA-256(솔트+비밀번호)` 형식으로만 저장됩니다. 원문 비밀번호는 어디에도 남지 않습니다.
- `deleted` 는 `TRUE`/`FALSE` 소프트 삭제 표시이며, 목록 API는 `TRUE` 행을 돌려주지 않습니다.
- 목록 API(`action=list`)는 `id, created_at, author, title, status` 만 반환합니다. 본문·비밀번호 해시·답변은 비밀번호를 검증한 열람 요청에서만 나갑니다.

## API

GET 쿼리스트링 또는 POST(`Content-Type: text/plain`, JSON 본문) 둘 다 지원합니다.

| action | 파라미터 | 하는 일 |
| --- | --- | --- |
| `list` | – | 삭제되지 않은 글 목록(최신순) |
| `create` | `author, title, content, password` | 글 저장 + `cd3000xl@naver.com` 으로 알림 메일 |
| `read` | `id, password` | 작성자 비밀번호 또는 관리자 비밀번호 검증 후 원문·답변 |
| `answer` | `id, admin_password, answer` | 답변 저장, 상태 `답변완료` |
| `delete` | `id, password` | 소프트 삭제 |
| `admin` | `admin_password` | 관리자 비밀번호 확인 |
| `ping` | – | 상태 확인 |

## 관리자 비밀번호

- Apps Script 의 `ScriptProperties` 값 `ADMIN_PASS` 에 저장되어 있고, 코드에는 들어 있지 않습니다.
- 잊었을 때: 프로젝트 편집기에서 함수 `resetAdminPassword` 를 실행하면 새 비밀번호가 만들어지고 실행 로그에 찍힙니다. 그 값을 사이트의 `관리자` 링크에서 사용하면 됩니다.
- 최초 설정은 `setup` 함수가 합니다(시트·헤더 준비 + 비밀번호 최초 생성, 실행 로그에 표시).

## 코드를 고쳤을 때

1. 이 폴더의 `Code.gs` 를 Apps Script 편집기에 붙여 넣고 저장합니다.
2. `배포 > 배포 관리 > 수정 > 버전: 새 버전 > 배포` 로 올리면 같은 URL에 반영됩니다.
