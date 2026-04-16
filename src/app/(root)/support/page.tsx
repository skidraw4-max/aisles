import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { getLegalContactEmail, LEGAL_LAST_REVISED } from '@/lib/legal-site';
import styles from '../legal/legal.module.css';

export const metadata: Metadata = {
  title: '고객지원 — AIsle',
  description: 'AIsle 고객지원, FAQ 및 문의 안내입니다.',
};

export default function SupportPage() {
  const contact = getLegalContactEmail();

  return (
    <>
      <main className={styles.shell}>
        <div className={styles.inner}>
          <Link href="/" className={styles.back}>
            ← 홈으로
          </Link>
          <h1 className={styles.title}>고객지원</h1>
          <p className={styles.lead}>
            AIsle은 Lab·Gallery·Lounge·Build·Launch 복도에서 AI 창작 콘텐츠를 공유하는 커뮤니티입니다. 아래 FAQ와 문의 안내를
            참고해 주세요.
          </p>

          <article className={styles.prose}>
            <h2>자주 묻는 질문 (FAQ)</h2>

            <div className={styles.faqItem}>
              <p className={styles.faqQ}>Q. 업로드한 이미지·영상의 저작권은 누가 갖나요?</p>
              <p className={styles.faqA}>
                A. 원칙적으로 <strong>촬영·창작·합법적으로 이용권을 확보한 이용자 본인</strong>에게 귀속됩니다. 타인의 사진·일러스트·
                영상을 무단으로 가져오거나, AI로 생성한 이미지가 제3자의 저작물과 실질적으로 유사하여 분쟁이 생기는 경우 그
                법적 책임은 게시자에게 있습니다. 상업적 이용·2차 저작이 필요한 소재는 원 권리자의 허락 범위를 반드시 확인해
                주세요.
              </p>
            </div>

            <div className={styles.faqItem}>
              <p className={styles.faqQ}>Q. Lab에서 프롬프트·워크플로는 어떻게 공유하나요?</p>
              <p className={styles.faqA}>
                A. <Link href="/upload">업로드</Link>에서 복도를 <strong>LAB(RECIPE)</strong>로 선택한 뒤, 제목·본문에 단계와
                설정을 적고 필요하면 프롬프트 전문을 텍스트로 붙여 넣으면 됩니다. 모델명·버전·주요 파라미터를 함께 적어 두면
                다른 이용자가 재현하기 쉽습니다. 외부 링크(노션, 깃허브 등)는 본문에 삽입할 수 있습니다.
              </p>
            </div>

            <div className={styles.faqItem}>
              <p className={styles.faqQ}>Q. 서비스 이용료가 있나요?</p>
              <p className={styles.faqA}>
                A. 현재 AIsle의 <strong>회원 가입·게시·댓글·기본 조회 등 핵심 기능은 무료</strong>로 제공되는 것을 원칙으로 합니다.
                향후 유료 플랜·부가 서비스가 도입되는 경우 사전에 약관·공지를 통해 안내합니다.
              </p>
            </div>

            <div className={styles.faqItem}>
              <p className={styles.faqQ}>Q. AI로 만든 글·그림도 올려도 되나요?</p>
              <p className={styles.faqA}>
                A. <strong>가능합니다.</strong> 다만 생성 과정에서 사용한 도구의 이용약관·출력물 라이선스를 준수해야 하며, 타인의
                저작물을 학습 데이터로 무단 사용했다는 등의 분쟁이 제기될 경우 <strong>게시자가 소명·대응할 책임</strong>이 있습니다.
                운영자는 이용자 간 저작권 분쟁의 당사자가 아닙니다. 자세한 책임 범위는{' '}
                <Link href="/legal/terms">이용약관</Link>을 참고해 주세요.
              </p>
            </div>

            <div className={styles.faqItem}>
              <p className={styles.faqQ}>Q. 개인정보·쿠키·맞춤형 광고(애드센스) 관련 문의는 어디로 하나요?</p>
              <p className={styles.faqA}>
                A. 개인정보 보호책임자 연락처 및 쿠키·옵트아웃 안내는{' '}
                <Link href="/legal/privacy">개인정보처리방침</Link> 제6조·제7조를 참고해 주세요. 브라우저 쿠키 설정, Google 광고
                설정 등으로 맞춤형 광고를 제한할 수 있습니다. 서비스 장애·버그는 아래 이메일로 재현 절차와 캡처를 보내 주시면
                검토에 도움이 됩니다.
              </p>
            </div>

            <h2>문의하기</h2>
            <p>
              운영 관련 문의, 제휴, 저작권·권리 침해 신고는 이메일로 연락해 주세요.
            </p>
            <p>
              <a href={`mailto:${contact}`}>{contact}</a>
            </p>
            <p>
              답변은 영업일 기준으로 순차 처리되며, 단순 문의는 3~5일 이내 회신을 목표로 합니다.{' '}
              <Link href="/legal/terms">이용약관</Link> 및 <Link href="/legal/privacy">개인정보처리방침</Link>도 함께
              확인해 주세요.
            </p>

            <h2>공지·정책</h2>
            <p>
              서비스 점검, 약관·개인정보처리방침 변경, 신기능 안내 등은{' '}
              <Link href="/notices">공지사항</Link> 또는 서비스 내 배너·상단 공지를 통해 안내할 수 있습니다. 중요한 변경은
              시행일 전에 공지하는 것을 원칙으로 합니다.
            </p>

            <p className={styles.legalLastRevised}>최종 수정일: {LEGAL_LAST_REVISED}</p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
