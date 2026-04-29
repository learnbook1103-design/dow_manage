# dow_manage — Claude Code 컨텍스트

## 배포
- **Vercel** 자동 배포 (`learnbook1103-design/dow_manage` GitHub 레포)
- `server.js` 는 로컬 전용, Vercel에서는 `api/` 폴더를 serverless function으로 인식

## 스택
- 프론트: 바닐라 HTML/JS, Noto Sans KR, Apple-like 디자인 (`--blue: #0071e3`)
- DB: Supabase (`grxslikvzxafmxuepusy`) — anon key HTML 하드코딩, 브라우저 직접 호출
- AI 채팅(근태): `api/chat.js` → Claude Haiku (`ANTHROPIC_API_KEY`)
- AI 채팅(허브): `api/hub-chat.js` → Gemini 2.5 Flash (`GEMINI_API_KEY`)
- 결재 백업: GAS 웹앱 → 공유드라이브

## 페이지

| 파일 | 역할 |
|------|------|
| `index.html` | 로그인 (PIN 인증) |
| `portal.html` | 통합 포털 |
| `portal-settings.html` | 관리자 설정 |
| `admin.html` | 근태 관리자 대시보드 (엑셀 업로드 → 매트릭스) |
| `supplement.html` | 근태 보완 등록 |
| `hub.html` | AI 업무 허브 채팅 |
| `pipeline.html` | 영업 파이프라인 뷰어 |
| `approval.html` | 결재 신청·처리 |

## API

| 파일 | 역할 |
|------|------|
| `api/chat.js` | Claude 기반 근태 AI |
| `api/hub-chat.js` | Gemini tool use (read_file / write_file / list_files) — hub-data/ 읽기·쓰기 |
| `api/hub-files.js` | hub-data GitHub 파일 트리 반환 |
| `api/hub-file.js` | 단일 파일 읽기 |
| `api/hub-stt.js` | 음성 → 텍스트 변환 + 파일 저장 |

## hub-data 구조 (GitHub 레포 내)
```
hub-data/
├── ontology/          숨김 (사이드바 미표시)
├── inbox/             숨김 — 원문 보관
├── companies/
│   ├── _index.md      거래처 마스터 목록
│   └── customers/[회사명]/deals.md
└── sales/
    ├── tasks/[팀명].md     팀 내부 과제
    └── weekly-reports/YYYY-MM-DD/[팀명].md
```

## 주요 규칙
- Supabase 테이블: `employees`, `attendance_*`, `approvals`, `app_settings`
- `app_settings`: module/key/value 구조 (module: approval / attendance)
- 결재 5종: 비품구매·경조사비·출장비·식비·품의서
- 인증: localStorage (`attendance_user_name`, `attendance_user_pin`, `attendance_login_date`)

## 환경변수 (Vercel)
- `ANTHROPIC_API_KEY` — api/chat.js
- `GEMINI_API_KEY` — api/hub-chat.js
- `GITHUB_TOKEN` — api/hub-chat.js, api/hub-stt.js
- `HUB_API_SECRET` — hub-chat 요청 인증
