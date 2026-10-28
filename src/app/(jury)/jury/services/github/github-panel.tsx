import Link from 'next/link';
import { formatKstFull } from '../../review-summary-format';
import { displayText } from '@/lib/jury-product/ui-labels';
import { DISPLAY_FLAG_LABELS, buildReviewDisplayModel } from '@/lib/jury-product/review-display-model';
import { juryHref } from '@/lib/jury-product/jury-url';
import type { GithubRepository } from '@/lib/jury-product/services/github/discovery';
import { projectGithubPermissionGuide, projectGithubUiState, type GithubProductScreen } from '@/lib/jury-product/services/github/product-flow';
import {
  chooseGithubRepository,
  collectGithubEvidence,
  disconnectGithub,
  reviewGithubEvidence,
  startGithubConnect,
} from '../../github-actions';
import styles from '../../jury.module.css';
import { Button, StatusBadge } from '../../jury-controls';
import { Check, Download, Link2, Play, Unlink } from 'lucide-react';

export function GithubPanel({
  configured,
  canConnect,
  canGrant,
  connection,
  repositories,
  selected,
  screen,
  notice,
}: {
  configured: boolean;
  canConnect: boolean;
  canGrant: boolean;
  connection: { id: string; displayName: string; status: string } | null;
  repositories: readonly GithubRepository[] | null;
  selected: string | null;
  screen: GithubProductScreen | null;
  notice: string | null;
}) {
  const guide = projectGithubPermissionGuide({
    connected: Boolean(connection && screen),
    canView: Boolean(screen?.canView),
    canGrant,
  });
  const state = projectGithubUiState({
    connected: Boolean(connection),
    configured,
    canView: Boolean(screen?.canView),
    repositorySelected: Boolean(selected),
    repositoryCount: repositories ? repositories.length : null,
    evidenceStatus: screen?.evidenceStatus ?? null,
    reviewStatus: screen?.reviewStatus ?? null,
  });
  const repositoriesVisible = Boolean(screen?.canView && repositories);
  return (
    <section className={styles.panel}>
      <h2 className={styles.pageTitle}>GitHub</h2>
      <p>제공자 GitHub</p>
      <p>출처 {screen?.source === 'fixture' ? 'Fixture' : 'GitHub'}</p>
      <p>환경 {screen?.environment === 'fixture' ? '테스트' : configured ? 'GitHub App' : '설정되지 않음'}</p>
      <p>저장소를 읽기 전용으로만 확인해요. 저장소를 수정하지 않아요.</p>
      {notice ? <p>{notice}</p> : null}
      {state === 'no-connection' ? <p>이 조직에는 아직 GitHub가 연결되지 않았어요.</p> : null}
      {!configured ? <p>GitHub App 설정이 아직 준비되지 않았어요.</p> : null}
      {state === 'no-scope' ? <p>선택한 저장소가 없어요. 심사 근거를 수집하기 전에 저장소를 골라 주세요.</p> : null}
      {state === 'evidence-failed' ? <p>심사 근거 수집에 실패해서 심사를 시작하지 않았어요.</p> : null}
      {state === 'evidence-partial' ? <p>심사 근거가 일부만 수집됐어요. 빠진 항목은 비어 있어요.</p> : null}
      {state === 'review-running' ? <p>심사가 진행 중이에요.</p> : null}
      {state === 'review-completed' ? <p>심사가 끝났어요.</p> : null}
      {!canConnect && !connection ? <p>현재 역할로는 서비스를 연결할 수 없어요.</p> : null}
      {guide.needed ? (
        <>
          <p>이 조직에 GitHub가 연결돼 있지만, 이 서비스에 대한 접근 권한이 없어요.</p>
          <p>보기 권한이 최소 권한이에요. 심사 근거 수집과 심사 시작에는 심사 권한이 필요해요.</p>
          <p>{guide.canGrant ? '서비스 접근 권한을 직접 부여할 수 있어요. 조직 역할만으로는 권한이 생기지 않아요.' : '조직 소유자나 관리자에게 서비스 접근 권한을 요청해 주세요.'}</p>
          <p><Link className={styles.inline} href={juryHref('/organization/services')}>서비스 접근 권한</Link></p>
        </>
      ) : null}
      {screen?.canView && !screen.canCollect && selected ? <p>심사 근거 수집과 심사에는 심사 권한이 필요해요.</p> : null}
      {canConnect && !connection ? (
        <form action={startGithubConnect}>
          <input type="hidden" name="tenantId" value="client-supplied-tenant" />
          <input type="hidden" name="organizationId" value="client-supplied-org" />
          <input type="hidden" name="userId" value="client-supplied-user" />
          <input type="hidden" name="role" value="OWNER" />
          <input type="hidden" name="permission" value="AGENT" />
          <Button variant="secondary" icon={Link2} type="submit">GitHub 연결</Button>
        </form>
      ) : null}
      {connection ? (
        <>
          <p>계정 {connection.displayName}</p>
          <p>연결 상태 <StatusBadge status={connection.status}>{displayText(connection.status)}</StatusBadge></p>
          {state === 'no-repository' ? <p>이 GitHub App 설치에서 사용할 수 있는 저장소가 없어요.</p> : null}
          {repositoriesVisible && repositories && repositories.length > 0 ? (
            <ul>
              {repositories.map((repository) => (
                <li key={repository.fullName}>
                  {repository.owner} {repository.name} {repository.fullName} {repository.visibility} {repository.private ? '비공개' : '공개'} {repository.defaultBranch || '기본 브랜치 없음'} {repository.archived ? 'archived' : ''} {repository.disabled ? 'disabled' : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {canConnect && repositoriesVisible && repositories && repositories.length > 0 ? (
            <form action={chooseGithubRepository}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <input type="hidden" name="operation" value="write" />
              <input type="hidden" name="readonly" value="false" />
              <label>
                저장소
                <select name="fullName" defaultValue={selected ?? repositories[0]?.fullName}>
                  {repositories.map((repository) => (
                    <option key={repository.fullName} value={repository.fullName}>{repository.fullName}</option>
                  ))}
                </select>
              </label>
              <Button variant="secondary" icon={Check} type="submit">이 저장소 사용</Button>
            </form>
          ) : null}
          {screen?.scope ? <p>범위 {screen.scope.resource} {screen.scope.operation} readonly</p> : null}
          {screen?.canCollect && selected ? (
            <form action={collectGithubEvidence}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="fullName" value={selected} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <input type="hidden" name="operation" value="write" />
              <Button variant="secondary" icon={Download} type="submit">자료 수집</Button>
            </form>
          ) : null}
          {screen?.evidenceStatus ? (
            <>
              <h3>자료 요약</h3>
              <p>상태 {displayText(screen.evidenceStatus)}</p>
              <p>저장소 {screen.repository}</p>
              <p>기본 브랜치 {screen.defaultBranch ?? '확인 불가'}</p>
              <p>README {screen.readme}{screen.readmeEmpty ? ' (비어 있음)' : ''}</p>
              {screen.readmeNote ? <p>{screen.readmeNote}</p> : null}
              <p>README 크기 {screen.readmeBytes === null ? '확인 불가' : screen.readmeBytes}</p>
              <p>커밋 수 {screen.commitCount === null ? '확인 불가' : screen.commitCount}</p>
              <p>{screen.commitNote}</p>
              <p>구조 {screen.structureState}{screen.structureCount === null ? '' : ` ${screen.structureCount}`}</p>
              {screen.structureNote ? <p>{screen.structureNote}</p> : null}
              <p>수집 시각 {screen.collectedAt ? formatKstFull(screen.collectedAt) : '확인 불가'}</p>
              <p>민감한 파일 제외됨</p>
              {screen.excerpt ? <p>README 발췌 {screen.excerpt}</p> : null}
              {screen.unavailable.length > 0 ? <p>확인 불가 {screen.unavailable.join(', ')}</p> : null}
            </>
          ) : null}
          {screen?.reviewStatus ? <p>심사 상태 <StatusBadge status={screen.reviewStatus}>{displayText(screen.reviewStatus)}</StatusBadge></p> : null}
          {screen?.reviewStatus === 'FAILED' ? <p>심사가 완료되지 않았어요. 심사 근거를 다시 수집한 뒤 시도해 주세요.</p> : null}
          {screen?.canStartReview ? (
            <form action={reviewGithubEvidence}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <Button variant="secondary" icon={Play} type="submit">심사 시작</Button>
            </form>
          ) : null}
          {screen?.reviewView ? (
            <>
              <h3>심사 결과</h3>
              <p>GitHub 저장소 근거로 진행한 심사예요.</p>
              <p>제공자 GitHub</p>
              <p>저장소 {screen.repository}</p>
              <p>자료 상태 {displayText(screen.evidenceStatus)}</p>
              <p>결론 {displayText(screen.reviewView.decision)}</p>
              <p>근거 강도 {screen.reviewView.evidenceStrength ?? '저장되지 않음'}</p>
              <p>주장 강도 {screen.reviewView.claimStrength ?? '저장되지 않음'}</p>
              <p>위험 {screen.reviewView.risk || '저장되지 않음'}</p>
              <p>{screen.reviewView.statusSummary}</p>
              {(() => {
                // RM-02b/02c AGG-01: same aggregation as the review detail; source from the stored request row (RM-02c).
                const display = buildReviewDisplayModel({
                  result: {
                    id: screen.result?.id ?? 'github-review',
                    expectedDecision: screen.reviewView.decision,
                    finalSurface: {
                      statusSummary: screen.reviewView.statusSummary,
                      topProblems: screen.reviewView.topProblems,
                      expectedUserEffect: screen.reviewView.expectedUserEffect,
                      risk: screen.reviewView.risk,
                      dimensionEvidence: screen.reviewView.collapsed.dimensionEvidence,
                      supportedClaims: screen.reviewView.collapsed.supportedClaims,
                      partiallySupportedClaims: screen.reviewView.collapsed.partiallySupportedClaims,
                      hypotheses: screen.reviewView.collapsed.hypotheses,
                    },
                    evidenceStrength: screen.reviewView.evidenceStrength ?? null,
                    claimStrength: screen.reviewView.claimStrength ?? null,
                    boardRunId: screen.reviewView.boardRunId ?? null,
                  },
                  request: { resultSource: screen.reviewView.resultSource ?? null },
                });
                const warnings = display.flags.filter((flag) => flag !== 'UNKNOWN_SOURCE' && flag !== 'NON_REAL_SOURCE');
                return (
                  <>
                    <p><StatusBadge status={display.source.value} title={display.source.value}>{display.source.label}</StatusBadge></p>
                    {display.problems.items.length > 0 ? <ul>{display.problems.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{display.problems.state === 'UNAVAILABLE' ? '집계 불가' : '문제 목록 없음'}</p>}
                    {display.problems.severityNote ? <p>{display.problems.severityNote}</p> : null}
                    {warnings.length > 0 ? <ul>{warnings.map((flag) => <li key={flag}>⚠ {DISPLAY_FLAG_LABELS[flag]}</li>)}</ul> : null}
                    {display.claims.counts ? <p>확인 {display.claims.counts.supported} · 일부 확인 {display.claims.counts.partial} · 미확인 {display.claims.counts.unverified}</p> : <p>주장 기록 없음</p>}
                  </>
                );
              })()}
              <p>예상 사용자 영향 {screen.reviewView.expectedUserEffect}</p>
              <details>
                <summary>추가 주장</summary>
                {screen.reviewView.collapsed.dimensionEvidence.length > 0 ? <ul>{screen.reviewView.collapsed.dimensionEvidence.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                {screen.reviewView.collapsed.supportedClaims.length > 0 ? <ul>{screen.reviewView.collapsed.supportedClaims.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                {screen.reviewView.collapsed.partiallySupportedClaims.length > 0 ? <ul>{screen.reviewView.collapsed.partiallySupportedClaims.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                {screen.reviewView.collapsed.hypotheses.length > 0 ? <ul>{screen.reviewView.collapsed.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              </details>
              <p><Link className={styles.inline} href={juryHref(`/reviews/${screen.result?.id}`)}>기존 심사 결과 열기</Link></p>
            </>
          ) : null}
          {screen?.improvement.offered ? (
            <p><Link className={styles.inline} href={juryHref(`/reviews/${screen.improvement.reviewId}`)}>기존 개선 단계 열기</Link></p>
          ) : null}
          {canConnect && connection.status !== 'DISCONNECTED' ? (
            <form action={disconnectGithub}>
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="tenantId" value="client-supplied-tenant" />
              <Button variant="secondary" icon={Unlink} type="submit">GitHub 연결 해제</Button>
            </form>
          ) : null}
          <p>연결을 해제하면 Jury 연결만 끊겨요. GitHub App은 제거되지 않아요.</p>
        </>
      ) : null}
    </section>
  );
}
