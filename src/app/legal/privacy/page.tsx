import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import styles from '../legal.module.css';

export const metadata: Metadata = {
  title: '개인정보처리방침 — AIsle',
  description: 'AIsle 개인정보처리방침입니다.',
};

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className={styles.shell}>
        <div className={styles.inner}>
          <Link href="/" className={styles.back}>
            ← 홈으로
          </Link>
          <h1 className={styles.title}>개인정보처리방침</h1>
          <p className={styles.updated}>시행일: 2026년 4월 10일</p>
          <article className={styles.prose}>
            <p>
              AIsle(이하 &quot;서비스&quot;)는 이용자의 개인정보를 중요하게 생각합니다. 본 방침은 Side-Sync 등 커뮤니티·협업
              플랫폼에서 일반적으로 고지하는 <strong>계정·프로필·활동 로그</strong> 수준의 처리 내용을 바탕으로, AIsle이 수집하는
              항목과 이용 목적, 보관, 파기, 이용자 권리를 설명합니다.
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
            </ul>

            <h2>3. 보관 및 파기</h2>
            <p>
              회원 탈퇴 또는 수집 목적 달성 후에는 관련 법령에 따른 보관 의무가 없는 한 지체 없이 파기합니다. 전자적 파일은 복구
              불가한 방식으로 삭제하고, 법령에 따라 일정 기간 보관이 필요한 경우 해당 기간 동안 분리 보관합니다.
            </p>

            <h2>4. 개인정보의 제공·위탁</h2>
            <p>
              운영자는 원칙적으로 이용자의 개인정보를 외부에 판매하거나 무단으로 제공하지 않습니다. 서비스 운영을 위해 다음과 같은
              수탁사(또는 이에 준하는 클라우드 서비스)를 이용할 수 있으며, 이 경우 관계 법령에 따라 위탁 업무 내용과 수탁자를
              관리합니다.
            </p>
            <ul>
              <li>인증·데이터베이스·파일 저장: Supabase, Cloudflare R2 등 배포 환경에 따른 제공자</li>
              <li>호스팅·배포: Vercel 등</li>
            </ul>

            <h2>5. 이용자의 권리</h2>
            <p>
              이용자는 언제든지 자신의 개인정보 열람·정정·삭제·처리 정지를 요청할 수 있으며, 회원 탈퇴를 통해 일부 정보의 삭제를
              요청할 수 있습니다. 다만 법령상 보관이 필요한 정보는 예외일 수 있습니다.
            </p>

            <h2>6. 쿠키 및 자동 수집 장치</h2>
            <p>
              서비스는 로그인 유지·보안·성능 측정을 위해 쿠키 또는 이와 유사한 기술을 사용할 수 있습니다. 브라우저 설정에서 쿠키
              저장을 거부할 수 있으나, 일부 기능이 제한될 수 있습니다.
            </p>

            <h2>7. 정책 변경</h2>
            <p>
              본 방침이 변경되는 경우 서비스 내 공지 또는 기타 합리적인 방법으로 안내합니다. 중요한 변경 사항은 시행일 최소 7일
              전에 공지하는 것을 원칙으로 합니다.
            </p>

            <p>
              문의는 <Link href="/support">고객지원</Link>을 이용해 주세요.
            </p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
