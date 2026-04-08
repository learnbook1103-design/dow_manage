# 작업 상태 (2026-04-07 리셋 후 재개)

## 수정 중인 파일
- portal.html
- GAS 스크립트

## portal.html 완료된 것
- testGAS() 함수 제거 완료
- gasData 전역변수 제거 완료
- 구 runAcct() (템플릿 파일 기반, 로컬 xlsx 다운로드) 삭제 완료
- 신 runAcct() 추가 완료 → ERP 파싱 후 GAS POST 방식으로 교체

## 새 runAcct() 동작 흐름
ERP 파일 파싱 → 날짜 필터 → GAS_URL로 POST → result.url 구글시트 열기

## 미완료 / 확인 필요
- portal.html UI에서 template-file input 제거 여부 확인
- GAS doPost() 구현 상태 확인
- result.name, result.url 반환 로직 확인

## 재개 시 지시
portal.html과 GAS 스크립트 열어서 미완료 부분 이어서 작업해줘