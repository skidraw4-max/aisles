import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import {
  CHILD_SAFETY_POLICY_PATH,
  getChildSafetyContactEmail,
  getChildSafetyContactName,
  LEGAL_LAST_REVISED,
} from '@/lib/legal-site';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import styles from '../legal.module.css';

export const metadata: Metadata = (() => {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const url = `${base}${CHILD_SAFETY_POLICY_PATH}`;
  return {
    title: '아동 안전 정책 — AIsle',
    description:
      'AIsle 아동 안전(CSAE) 정책 — 아동 성적 학대·착취(CSAM) 금지, 신고 절차 및 대응 방침입니다.',
    alternates: { canonical: url },
    robots: SEO_ROBOTS_PUBLIC,
    openGraph: {
      type: 'website',
      locale: 'ko_KR',
      siteName: 'AIsle',
      url,
      title: '아동 안전 정책 — AIsle',
      description:
        'AIsle 아동 안전(CSAE) 정책 — 아동 성적 학대·착취(CSAM) 금지, 신고 절차 및 대응 방침입니다.',
    },
  };
})();

export default function ChildSafetyPage() {
  const contactEmail = getChildSafetyContactEmail();
  const contactName = getChildSafetyContactName();

  return (
    <>
      <main className={styles.shell}>
        <div className={styles.inner}>
          <Link href="/" className={styles.back}>
            ← 홈으로
          </Link>
          <h1 className={styles.title} id="child-safety-policy">
            아동 안전 정책
          </h1>
          <p className={styles.updated}>시행일: 2026년 6월 11일 · 본 개정 반영: {LEGAL_LAST_REVISED}</p>
          <article className={styles.prose}>
            <p>
              <strong>AIsle</strong>(이하 &quot;서비스&quot;)은 이용자가 생성·공유하는 콘텐츠(UGC)를 다루는 커뮤니티
              플랫폼으로서, <strong>아동·청소년의 안전</strong>을 최우선 가치로 둡니다. 본 정책은 Google Play의{' '}
              <strong>아동 안전(CSAE, Child Sexual Abuse and Exploitation)</strong> 요구사항 및 관련 법령을 준수하기
              위해 수립되었으며, 아동 성적 학대·착취 및 이에 준하는 유해 행위를 명확히 금지하고 신고·대응 절차를
              안내합니다.
            </p>

            <h2 id="prohibited">1. 금지 행위</h2>
            <p>AIsle에서 다음 행위는 <strong>절대 허용되지 않습니다</strong>.</p>
            <ul>
              <li>
                <strong>CSAM(아동 성적 학대 콘텐츠)</strong>: 미성년자를 대상으로 한 성적 이미지·영상·묘사·링크의
                생성·업로드·공유·요청·거래
              </li>
              <li>
                <strong>아동 성적 착취·학대(CSAE)</strong>: 아동·청소년을 성적 대상으로 삼는 모든 형태의 착취·학대
                행위 또는 이를 조장·미화하는 콘텐츠
              </li>
              <li>
                <strong>그루밍(Grooming)</strong>: 아동·청소년과 신뢰 관계를 형성하여 성적 목적의 접근·유인·대화를
                시도하는 행위
              </li>
              <li>
                <strong>성착취 협박(Sextortion)</strong>: 아동·청소년을 대상으로 한 성적 이미지·정보 요구, 협박,
                금전·이득 강요
              </li>
              <li>
                <strong>아동 대상 성적 대화·유도</strong>: 미성년자와의 성적 대화 유도, 성적 행위 권유, 노골적 성적
                표현을 통한 접근
              </li>
              <li>
                <strong>아동 착취 조장</strong>: 아동 노동·성착취·인신매매 등 아동 착취를 정당화·홍보·중개하는 행위
              </li>
              <li>
                <strong>기타</strong>: 위 항목에 준하는 모든 아동·청소년 대상 성적 학대·착취 관련 행위
              </li>
            </ul>
            <p>
              위반 콘텐츠·계정은 사전 통지 없이 <strong>즉시 삭제·비공개·이용 정지</strong>될 수 있으며, 관련 법령에
              따라 <strong>수사기관에 신고</strong>합니다.
            </p>

            <h2 id="reporting">2. 신고 방법</h2>
            <p>
              아동 안전·CSAE 관련 의심 콘텐츠, 계정, 메시지를 발견한 경우 아래 경로로 신고해 주세요. 신고 시{' '}
              <strong>해당 게시글·댓글 URL, 스크린샷, 발생 시각</strong>을 함께 보내 주시면 신속한 처리에 도움이
              됩니다.
            </p>
            <ul>
              <li>
                <strong>이메일(아동 안전·CSAE 전용)</strong>:{' '}
                <a href={`mailto:${contactEmail}?subject=${encodeURIComponent('[AIsle] 아동 안전(CSAE) 신고')}`}>
                  {contactEmail}
                </a>
              </li>
              <li>
                <strong>앱 내 신고</strong>: 프로필 설정의 <Link href="/profile">「신고·문의」</Link>에서
                &quot;아동 안전(CSAE) 신고&quot; 또는 &quot;콘텐츠 신고&quot;를 이용할 수 있습니다. 게시글 하단의
                「신고」 링크에서도 동일하게 접수됩니다.
              </li>
              <li>
                <strong>고객지원</strong>: <Link href="/support">고객지원</Link> 페이지의 문의 안내를 참고해 주세요.
              </li>
            </ul>
            <p>
              <strong>긴급 상황</strong>에서는 서비스 신고와 별도로 즉시 아래 기관에 연락해 주세요.
            </p>
            <ul>
              <li>
                <strong>경찰 긴급 신고</strong>: 112
              </li>
              <li>
                <strong>아동학대 신고</strong>: 132 (아동보호전문기관·경찰 연계)
              </li>
              <li>
                <strong>방송통신심의위원회 불법정보 신고</strong>:{' '}
                <a href="https://www.cleanict.or.kr" target="_blank" rel="noopener noreferrer">
                  cleanict.or.kr
                </a>
              </li>
            </ul>

            <h2 id="csam-response">3. CSAM·CSAE 대응 절차</h2>
            <p>AIsle 운영자는 CSAE·CSAM 관련 신고를 접수하면 다음 절차에 따라 대응합니다.</p>
            <ol>
              <li>
                <strong>접수·검토</strong>: 신고 내용과 증거(URL, 캡처 등)를 확인하고 우선순위를 부여합니다. CSAM
                의심 건은 최우선 처리합니다.
              </li>
              <li>
                <strong>콘텐츠 제거</strong>: 해당 게시물·댓글·미디어를 즉시 삭제하거나 비공개 처리합니다.
              </li>
              <li>
                <strong>계정 조치</strong>: 위반 계정의 이용을 정지·영구 차단하고, 재가입·우회 이용을 방지하기 위한
                조치를 취합니다.
              </li>
              <li>
                <strong>수사기관 신고</strong>: 대한민국 관련 법령(아동·청소년의 성보호에 관한 법률, 정보통신망법
                등)에 따라 <strong>경찰·수사기관</strong> 및 필요 시 <strong>아동보호전문기관(132)</strong> 등에
                신고·협조합니다.
              </li>
              <li>
                <strong>기록 보관</strong>: 법령이 허용하는 범위에서 신고·조치 내역을 보관하여 수사·재발 방지에
                활용합니다.
              </li>
              <li>
                <strong>신고자 회신</strong>: 가능한 범위에서 접수 확인 및 조치 결과를 이메일로 안내합니다.
              </li>
            </ol>

            <h2 id="compliance">4. 법적 준수</h2>
            <p>
              AIsle은 대한민국 「아동·청소년의 성보호에 관한 법률」, 「정보통신망 이용촉진 및 정보보호 등에 관한
              법률」, 「개인정보 보호법」 등 관련 법령과 Google Play 개발자 정책(아동 안전·CSAE)을 준수합니다. 이용자는
              본 정책과 <Link href="/legal/terms">이용약관</Link>을 함께 준수해야 합니다.
            </p>

            <h2 id="contact">5. 아동 안전 담당 연락처</h2>
            <ul>
              <li>
                <strong>담당</strong>: {contactName}
              </li>
              <li>
                <strong>이메일</strong>: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              </li>
            </ul>
            <p>
              아동 안전 관련 문의·신고는 위 연락처로 접수해 주시며, 운영자는 접수 후 지체 없이 검토·조치합니다.
            </p>

            <h2 id="updates">6. 정책 변경</h2>
            <p>
              본 정책이 변경되는 경우 서비스 내 공지, <Link href="/notices">공지사항</Link> 또는 본 페이지 개정일
              표시를 통해 안내합니다. 중요한 변경은 시행 전에 공지하는 것을 원칙으로 합니다.
            </p>

            <p className={styles.legalLastRevised}>최종 수정일: {LEGAL_LAST_REVISED}</p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
