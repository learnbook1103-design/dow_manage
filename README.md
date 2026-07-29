# DOW Manage

## 로컬 개발 시작

Docker Desktop을 실행한 뒤 아래 명령을 사용합니다.

```powershell
npm install
npm run dev:setup
```

- 앱: http://localhost:3000
- DB 관리 화면(Supabase Studio): http://localhost:54323
- DB API: http://127.0.0.1:54321
- PostgreSQL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 상태 확인: http://localhost:3000/api/health

`localhost`에서 앱을 열면 자동으로 로컬 DB를 사용합니다. 배포 주소에서는 기존 운영
Supabase를 사용합니다. 로컬 결재 테스트는 Google Apps Script로 전송되지 않습니다.

### 테스트 계정

| 역할 | 이름 | PIN |
| --- | --- | --- |
| 관리자 | 테스트관리자 | 0000 |
| 팀장 | 테스트팀장 | 1111 |
| 직원 | 테스트직원 | 2222 |

테스트 데이터에는 실제 직원 정보가 들어 있지 않습니다.

### DB 명령

```powershell
npm run db:start   # DB 시작
npm run dev        # 앱 서버 시작
npm run db:status  # DB 상태/접속 정보
npm run db:reset   # 스키마와 익명 샘플 데이터로 초기화
npm run verify:local # DB CRUD와 Storage 연결 검증
npm run db:stop    # DB 중지
```

스키마 변경은 `supabase/migrations/`, 샘플 데이터 변경은 `supabase/seed.sql`에
추가합니다. AI 기능을 함께 테스트하려면 `.env.example`을 `.env`로 복사하고 필요한
키만 입력합니다.

## 리팩토링 테스트

```powershell
npm test            # 외부 서비스 없이 순수 로직 단위 테스트
npm run test:local  # 단위 테스트 + 로컬 서버 API + DB CRUD/Storage
```

리팩토링 순서와 통과 기준은 `docs/refactoring-roadmap.md`를 따릅니다. 동작 변경이
필요한 경우에는 먼저 기존 동작을 재현하는 테스트를 추가합니다.
