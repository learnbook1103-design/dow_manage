# 거래처 통합 인덱스

> 고객사·공급사 정규화된 명칭 단일 소스
> 회사명 언급 시 반드시 이 파일을 먼저 읽어 정확한 명칭과 경로를 확인할 것

---

## 고객사 (customers)

| 회사명 | 구분 | 채널 | 담당 | 경로 |
|--------|------|------|------|------|
| HPRAY (HP Ray Clean Technology) | 국외 (중국) | 반도체/Plant | 한옥련 | companies/customers/HPRAY/ |
| Tema Oil Refinery | 국외 (가나) | 수출/MRO | 이대희 | companies/customers/Tema_Oil_Refinery/ |
| HAM-LET | 국외 (이스라엘) | 수출 | 이대희 | companies/customers/HAM-LET/ |

---

## 공급사 (suppliers)

→ 전체 목록: `companies/suppliers/_index.md` (75개사, 2026-04-09 스냅샷)

| 주요 공급사 | 품목 |
|------------|------|
| KB Valve | 밸브 |
| 극동밸브 | 3way, 버터플라이, 글로브 |
| 영텍 (ROTORK YTC) | 액추에이터 (ROTORK 대리점) |
| 태영쎄니타리 | 쌔니타리 밸브 |
| HUASHENG (화승) / HPRAY | CPVC 밸브 (중국, 수입) |

---

## 사용 규칙

1. **매칭**: 입력된 회사명을 이 목록과 대조 후 정확한 명칭 사용
2. **유사어 경고**: 입력값이 기존 명칭과 유사하지만 다를 경우 사용자에게 확인 요청
3. **신규 추가**: "추가" 키워드가 포함된 경우에만 새 항목 생성 후 이 파일에도 추가
4. **중복 방지**: 고객사이면서 공급사인 경우 구분란에 "고객사+공급사"로 표기
