import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { getLegalContactEmail, LEGAL_LAST_REVISED } from '@/lib/legal-site';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: '개인정보처리방침 — AIsle',
  description: 'AIsle 개인정보처리방침입니다.',
};

export default function PrivacyPage() {
  const dpoEmail = getLegalContactEmail();

  return (
    <>
      <main className={styles.shell}>
        <div className={styles.inner}>
          <Link href="/" className={styles.back}>
            ← 홈으로
          </Link>
          <h1 className={styles.title}>개인정보처리방침</h1>
          <p className={styles.updated}>시행일: 2026년 4월 10일 · 본 개정 반영: {LEGAL_LAST_REVISED}</p>
          <article className={styles.prose}>
            <p>
              AIsle(이하 &quot;서비스&quot;)는 「개인정보 보호법」 등 국내 법령을 준수하며, 이용자의 개인정보를 보호하고 권익을
              보호하기 위해 다음과 같이 개인정보처리방침을 수립·공개합니다. 본 방침은 서비스가 수집·이용하는 개인정보 항목, 목적,
              보관·파기, 이용자 권리, 쿠키·광고 식별자(맞춤형 광고 포함)에 관한 사항을 설명합니다.
            </p>

            <h2>1. 수집하는 개인정보 항목</h2>
            <p>서비스 제공을 위해 다음과 같은 정보가 처리될 수 있습니다.</p>
            <ul>
              <li>
                <strong>회원 가입·로그인</strong>: 이메일 주소, 인증에 사용된 외부 계정 식별자(Supabase Auth 등), 닉네임·사용자
                이름
              </li>
              <li>
                <strong>프로필</strong>: 프로필 이미지 URL, 자기소개 등 회원이 직접 입력한 정보
              </li>
              <li>
                <strong>서비스 이용 과정</strong>: 게시글·댓글·좋아요·조회 등 활동에 수반되는 기록, 접속 로그·IP(보안·통계 목적,
                일부는 서버·호스팅사에서 자동 생성)
              </li>
              <li>
                <strong>업로드 콘텐츠</strong>: 이미지·영상 파일 및 메타데이터(저장소 URL 등)
              </li>
            </ul>

            <h2>2. 수집 및 이용 목적</h2>
            <ul>
              <li>회원 식별, 가입 의사 확인, 부정 이용 방지</li>
              <li>게시글·댓글 등 콘텐츠 제공 및 맞춤형 피드·검색 기능 운영</li>
              <li>서비스 개선, 통계·분석(개인을 식별할 수 없는 형태로 가공 가능)</li>
              <li>법령 위반 행위 대응, 분쟁 해결, 법적 의무 이행</li>
              <li>고객 문의 응대 및 공지 전달</li>
              <li>
                <strong>맞춤형·비개인 식별 광고</strong>: Google LLC 등 제휴 광고 네트워크를 통한 광고 노출·성과 측정(쿠키·광고
                식별자 등, 아래 제6조)
              </li>
            </ul>

            <h2>3. 보관 및 파기</h2>
            <p>
              회원 탈퇴 또는 수집 목적 달성 후에는 관련 법령에 따른 보관 의무가 없는 한 지체 없이 파기합니다. 전자적 파일은 복구
              불가한 방식으로 삭제하고, 법령에 따라 일정 기간 보관이 필요한 경우 해당 기간 동안 분리 보관합니다.
            </p>

            <h2>4. 개인정보의 제공·위탁</h2>
            <p>
              운영자는 원칙적으로 이용자의 개인정보를 외부에 판매하거나 무단으로 제공하지 않습니다. 서비스 운영을 위해 다음과 같은
              수탁사(또는 이에 준하는 클라우드·광고 서비스)를 이용할 수 있으며, 이 경우 관계 법령에 따라 위탁 업무 내용과 수탁자를
              관리합니다.
            </p>
            <ul>
              <li>인증·데이터베이스·파일 저장: Supabase, Cloudflare R2 등 배포 환경에 따른 제공자</li>
              <li>호스팅·배포: Vercel 등</li>
              <li>
                <strong>광고</strong>: Google LLC(구글 애드센스 등) — 광고 노출·클릭 측정, 사기 방지 등을 위해 쿠키·모바일 광고
                식별자 등이 사용될 수 있으며, 구글의 개인정보처리방침 및 광고 설정이 별도로 적용될 수 있습니다.
              </li>
            </ul>

            <h2>5. 이용자의 권리</h2>
            <p>
              이용자는 언제든지 자신의 개인정보 열람·정정·삭제·처리 정지를 요청할 수 있으며, 회원 탈퇴를 통해 일부 정보의 삭제를
              요청할 수 있습니다. 다만 법령상 보관이 필요한 정보는 예외일 수 있습니다. 맞춤형 광고와 관련된 거부·설정은 제6조의
              안내에 따른 브라우저·광고 플랫폼 설정을 병행할 수 있습니다.
            </p>

            <h2>6. 쿠키, 유사 기술 및 맞춤형 광고(구글 애드센스)</h2>
            <p>
              서비스는 <strong>로그인 유지·보안·성능 측정·통계</strong>를 위해 쿠키 또는 로컬 스토리지 등과 유사한 기술을 사용할 수
              있습니다. 또한 서비스에는 <strong>Google 애드센스(또는 구글이 제공하는 광고 프로그램)</strong>가 포함될 수 있으며,
              이 경우 <strong>Google 및 제휴사가 쿠키를 사용</strong>하여 이용자가 이전에 방문한 웹사이트 정보를 바탕으로 광고를
              게재하거나, 광고 성과를 측정할 수 있습니다. Google의 광고 쿠키 사용 방식은 Google의 개인정보처리방침 및 광고 정책에
              따릅니다.
            </p>
            <p>
              <strong>거부·Opt-out(맞춤형 광고 제한)</strong>: 이용자는 다음과 같은 방법으로 맞춤형 광고에 활용되는 정보 수집을
              제한하거나 거부할 수 있습니다. (전부를 적용해도 일반적인 서비스 이용에는 지장이 없을 수 있으나, 광고 노출 방식은
              달라질 수 있습니다.)
            </p>
            <ul>
              <li>
                <strong>브라우저 쿠키 설정</strong>: 사용 중인 브라우저의 설정에서 쿠키 저장을 거부하거나, 저장 시 알림을 받도록
                설정할 수 있습니다. 쿠키를 전면 차단하면 로그인 등 일부 기능이 제한될 수 있습니다.
              </li>
              <li>
                <strong>Google 광고 설정</strong>:{' '}
                <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">
                  Google 광고 설정 페이지
                </a>
                에서 맞춤형 광고에 사용되는 정보를 관리할 수 있습니다.
              </li>
              <li>
                <strong>NAI(미국)</strong>:{' '}
                <a href="https://optout.networkadvertising.org/" target="_blank" rel="noopener noreferrer">
                  Network Advertising Initiative 옵트아웃
                </a>{' '}
                등 제3자 제공 업체의 옵트아웃 도구를 이용할 수 있습니다(지역·환경에 따라 제공 여부가 다를 수 있음).
              </li>
              <li>
                <strong>모바일</strong>: 운영체제·광고 플랫폼별 &quot;광고 추적 제한&quot;, &quot;맞춤형 광고 재설정&quot; 등 설정을
                확인해 주세요.
              </li>
            </ul>
            <p>
              애드센스·광고 파트너의 최신 정책은 구글 고객센터 및 관련 정책 페이지를 참고하시기 바랍니다. 본 방침은 국내법 및
              정보통신망법·개인정보 보호법의 일반 원칙을 따르며, 행태정보의 수집·이용이 중대한 변경을 수반하는 경우 관련 법령이
              정하는 바에 따라 별도 동의 또는 고지를 할 수 있습니다.
            </p>

            <h2>7. 개인정보 보호책임자 및 고충처리</h2>
            <p>
              서비스는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 이용자의 불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보
              보호책임자를 지정합니다.
            </p>
            <ul>
              <li>
                <strong>개인정보 보호책임자</strong>: AIsle 운영 담당
              </li>
              <li>
                <strong>연락처(이메일)</strong>:{' '}
                <a href={`mailto:${dpoEmail}`}>{dpoEmail}</a>
              </li>
            </ul>
            <p>
              정보주체는 서비스를 이용하면서 발생한 모든 개인정보 보호 관련 문의, 불만처리, 피해구제 등에 관한 사항을 개인정보
              보호책임자에게 문의할 수 있습니다. 운영자는 정보주체의 문의에 대해 지체 없이 답변 및 처리할 것입니다.
            </p>

            <h2>8. 정책 변경</h2>
            <p>
              본 방침이 변경되는 경우 서비스 내 공지 또는 기타 합리적인 방법으로 안내합니다. 중요한 변경 사항은 시행일 최소 7일
              전에 공지하는 것을 원칙으로 하며, 이용자 권리에 중대한 영향을 미치는 변경의 경우 법령이 정한 절차를 따릅니다.
            </p>

            <p>
              기타 문의는 <Link href="/support">고객지원</Link>을 이용해 주세요.
            </p>

            <p className={styles.legalLastRevised}>최종 수정일: {LEGAL_LAST_REVISED}</p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
