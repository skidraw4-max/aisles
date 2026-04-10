import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import styles from '../legal/legal.module.css';

export const metadata: Metadata = {
  title: '고객지원 — AIsle',
  description: 'AIsle 고객지원, FAQ 및 문의 안내입니다.',
};

export default function SupportPage() {
  return (
    <>
      <SiteHeader />
      <main className={styles.shell}>
        <div className={styles.inner}>
          <Link href="/" className={styles.back}>
            ← 홈으로
          </Link>
          <h1 className={styles.title}>고객지원</h1>
          <p className={styles.lead}>
            AIsle은 Lab·Gallery·Lounge·Build·Launch 네 복도에서 AI 창작 콘텐츠를 모으는 허브입니다. Side-Sync와 같이{' '}
            <strong>프로젝트 탐색·팀 빌딩</strong>에 초점을 둔 서비스와 달리, AIsle은 <strong>게시·피드·업로드·댓글</strong> 중심으로
            운영됩니다. 아래 FAQ와 문의 안내를 참고해 주세요.
          </p>

          <article className={styles.prose}>
            <h2>자주 묻는 질문</h2>

            <p>
              <strong>Q. 회원가입은 어떻게 하나요?</strong>
            </p>
            <p>
              A. 상단 메뉴에서 로그인·회원가입을 진행합니다. Supabase 인증을 사용하므로 이메일 등 안내에 따라 계정을 연결하면
              됩니다.
            </p>

            <p>
              <strong>Q. 글은 어디서 작성하나요?</strong>
            </p>
            <p>
              A. <Link href="/upload">업로드</Link> 메뉴에서 카테고리(복도)를 선택한 뒤 제목·본문·미디어를 등록합니다. 대표
              미디어는 최대 5개까지 첨부할 수 있으며, 본문에는 이미지를 복사해 붙여넣어 삽입할 수 있습니다.
            </p>

            <p>
              <strong>Q. Lab과 Gallery의 차이는 무엇인가요?</strong>
            </p>
            <p>
              A. Lab(RECIPE)은 프롬프트·워크플로 공유에 맞춰져 있고, Gallery는 비주얼 작품 중심입니다. Lounge·Gossip은 텍스트·가벼운
              소통, Build·Launch는 제품·서비스 소개에 가깝게 쓰일 수 있습니다.
            </p>

            <p>
              <strong>Q. 게시글을 수정·삭제하려면요?</strong>
            </p>
            <p>
              A. 본인이 작성한 글의 상세 페이지 하단에서 수정·삭제를 이용할 수 있습니다. My Aisles에서도 일괄 관리가 가능합니다.
            </p>

            <p>
              <strong>Q. 서비스 장애나 버그는 어디로 알리나요?</strong>
            </p>
            <p>
              A. 아래 이메일로 재현 방법과 화면을 함께 보내 주시면 검토에 도움이 됩니다. 긴급한 보안 이슈는 &quot;보안&quot;이라고
              제목에 표기해 주세요.
            </p>

            <h2>문의하기</h2>
            <p>
              운영 관련 문의, 제휴, 저작권·권리 침해 신고는 이메일로 연락해 주세요.
            </p>
            <p>
              <a href="mailto:skidraw4@gmail.com">skidraw4@gmail.com</a>
            </p>
            <p>
              답변은 영업일 기준으로 순차 처리되며, 단순 문의는 3~5일 이내 회신을 목표로 합니다.{' '}
              <Link href="/legal/terms">이용약관</Link> 및 <Link href="/legal/privacy">개인정보처리방침</Link>도 함께
              확인해 주세요.
            </p>

            <h2>공지·정책</h2>
            <p>
              서비스 점검, 약관·개인정보처리방침 변경, 신기능 안내 등은 추후 공지사항 페이지 또는 서비스 내 배너를 통해 안내할 수
              있습니다. Side-Sync의 공지·정책 채널과 유사하게, 중요한 변경은 로그인 사용자에게 노출되는 영역을 우선 활용합니다.
            </p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
