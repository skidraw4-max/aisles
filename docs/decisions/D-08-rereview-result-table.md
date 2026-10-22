# D-08 제안 (RM-11): JuryReReviewResult 사용 또는 제거 — 미결정, 적용 안 함

- 현황: JuryReReviewResult 0건 [DB 확인, I-025]. 재심사 계보는 이미 `JuryReviewResult.parentReviewResultId`로 기록됨 [코드 확인].
- RM-11 구현은 이 테이블을 읽거나 쓰지 않는다. 이전 대비(M-011)는 parentReviewResultId 계보 → 없으면 같은 연결(connectionId)의 이전 결과 중 같은 출처 등급·같은 지표 구성의 최신 결과로 비교한다.
- 권고: **제거(B)** — 쓰기 경로가 없고 계보 컬럼으로 대체 가능. 제거는 마이그레이션이 필요하므로 별도 승인 후 RM-01 스택에서만.
- 대안(A) 사용: 재심사 diff 스냅샷 저장 용도로 쓰기 연결 — 실모델 재심사(D-06 장기 실행 방식) 결정 이후에만 의미 있음.
