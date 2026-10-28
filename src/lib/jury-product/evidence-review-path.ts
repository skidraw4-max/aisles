/**
 * I-029: which review path an evidence card on /jury/evidence can use. Display-only.
 *
 * submitTenantReview → runTenantReview accepts only evidence that has an EVIDENCE_INTAKE_COMPLETED
 * audit pointing at an APPROVED scope (tenant/console declared intake). Connected-collection evidence
 * has no such audit, so every request from the evidence card (FULL_REVIEW or CLAIM_VALIDATION) is
 * rejected with SCOPE_NOT_APPROVED. Its review runs through runConnectedServiceReview on the service
 * page, which is fixed to FULL_REVIEW (no claim input).
 *
 * The server checks stay the source of truth; this only decides which form to show.
 */
import { TENANT_INTAKE_PURPOSE } from './tenant-evidence-intake';

export type EvidenceReviewPath = 'TENANT_INTAKE' | 'CONNECTED_SERVICE';

export function evidenceReviewPath(evidence: { purpose: string }): EvidenceReviewPath {
  return evidence.purpose === TENANT_INTAKE_PURPOSE ? 'TENANT_INTAKE' : 'CONNECTED_SERVICE';
}

export const CONNECTED_EVIDENCE_REVIEW_NOTICE =
  '연결 수집 자료는 이 화면에서 심사를 요청할 수 없습니다. 전체 심사는 서비스 화면에서 요청하세요(수집이 완료되고 실행 중인 심사가 없을 때 요청 버튼이 보입니다). 주장 검증은 직접 입력 자료에서만 지원합니다.';
