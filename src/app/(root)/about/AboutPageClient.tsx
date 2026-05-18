'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Bell,
  Bookmark,
  FlaskConical,
  Hammer,
  ImageIcon,
  LogIn,
  MessageCircle,
  Palette,
  Rocket,
  Search,
  Upload,
  Users,
} from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const heroAccentStyle: React.CSSProperties = {
  backgroundImage: 'linear-gradient(135deg, #e9d5ff 0%, #a78bfa 45%, #7c3aed 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: '#c4b5fd',
  WebkitTextFillColor: 'transparent',
};

function Section({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <section className={className}>{children}</section>;
  }
  return (
    <motion.section
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
}

const corridors: { name: string; slug: string; desc: string; Icon: typeof Palette }[] = [
  {
    name: 'AI 연구소',
    slug: 'LAB',
    desc: '프롬프트·모델 설정·워크플로를 레시피 형태로 올리고, AI 분석으로 구조화합니다.',
    Icon: FlaskConical,
  },
  {
    name: '쇼케이스',
    slug: 'GALLERY',
    desc: '이미지·비주얼 작품을 공유합니다. 로그인 시 AI Vision 역분석으로 추정 프롬프트를 볼 수 있습니다.',
    Icon: Palette,
  },
  {
    name: 'AI 트렌드',
    slug: 'LOUNGE',
    desc: 'AI·테크 뉴스, 영상 요약, 인사이트 등 텍스트·링크 중심 글을 모읍니다.',
    Icon: MessageCircle,
  },
  {
    name: '커뮤니티',
    slug: 'GOSSIP',
    desc: '자유 토론·소셜 이슈·가벼운 커뮤니티 글을 나누는 복도입니다.',
    Icon: Users,
  },
  {
    name: '제작기',
    slug: 'BUILD',
    desc: '개발 스택, 제작 과정, 빌드 노트·도구 사용기를 공유합니다.',
    Icon: Hammer,
  },
  {
    name: '출시',
    slug: 'LAUNCH',
    desc: '완성된 서비스·프로젝트 런칭 소식과 반응을 모읍니다.',
    Icon: Rocket,
  },
];

const features: { title: string; desc: string; Icon: typeof LogIn }[] = [
  {
    title: '로그인',
    desc: 'Google OAuth 또는 이메일·비밀번호(Supabase)로 가입·로그인합니다. 프로필에서 닉네임·아바타를 설정할 수 있습니다.',
    Icon: LogIn,
  },
  {
    title: '레시피 등록',
    desc: '헤더의 업로드에서 복도를 고르고 제목·본문·이미지·프롬프트 메타데이터를 등록합니다. 본인 글은 수정·삭제할 수 있습니다.',
    Icon: Upload,
  },
  {
    title: '홈 피드·복도 탭',
    desc: '메인에서 전체·복도별 탭으로 글을 걸러 보고, 퀘이사 보드·런치 슬라이더·최신 글 목록으로 탐색합니다.',
    Icon: ImageIcon,
  },
  {
    title: '검색',
    desc: '제목·본문·태그로 게시글을 검색합니다.',
    Icon: Search,
  },
  {
    title: 'My Aisles',
    desc: '내가 올린 글과 북마크한 글을 한곳에서 관리합니다.',
    Icon: Bookmark,
  },
  {
    title: '공지사항',
    desc: '상단 롤링 공지와 공지 목록(/notices)으로 운영 소식을 확인합니다.',
    Icon: Bell,
  },
];

export function AboutPageClient() {
  const reduce = useReducedMotion();

  return (
    <main className="min-h-screen bg-[#020617] text-slate-400 antialiased">
      {/* Hero */}
      <motion.div
        className="relative overflow-hidden border-b border-slate-800/80"
        initial={reduce ? false : { opacity: 0, y: 20 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-violet-500/15 blur-[100px]"
          aria-hidden
        />
        <motion.div
          className="pointer-events-none absolute right-1/4 top-0 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-[80px]"
          aria-hidden
        />

        <div className="relative mx-auto max-w-6xl px-6 py-12 md:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-400 md:text-sm">
            프롬프트 레시피 · 역설계 · 워크플로우
          </p>
          <h1 className="mt-6 max-w-4xl font-sans text-4xl font-bold leading-[1.15] tracking-tight text-white md:text-5xl lg:text-6xl">
            AI 프롬프트를 분석하고
            <br />
            <span style={heroAccentStyle}>AI Prompt Alchemy.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-relaxed text-slate-400 md:text-lg">
            AIsle은 AI 창작물의 프롬프트·설정·과정을 레시피처럼 기록·공유하는 플랫폼입니다. 복도별 피드에서
            실험부터 출시까지의 흐름을 한곳에서 살펴볼 수 있습니다.
          </p>
        </div>
      </motion.div>

      <motion.div
        className="mx-auto max-w-6xl px-6"
        initial={reduce ? false : { opacity: 0 }}
        animate={reduce ? undefined : { opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {/* 제작 동기 */}
        <Section className="grid gap-6 py-12 md:grid-cols-2 md:gap-8 md:py-14">
          <motion.div
            initial={reduce ? false : { opacity: 0, x: -16 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">제작 동기</h2>
            <div className="mt-4 h-1 w-12 rounded-full bg-violet-400" aria-hidden />
          </motion.div>
          <motion.div
            className="space-y-6 text-base leading-relaxed md:text-[17px]"
            initial={reduce ? false : { opacity: 0, x: 16 }}
            whileInView={reduce ? undefined : { opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            <p>
              AI 이미지·텍스트 결과물은 프롬프트(재료)와 모델·파라미터(조리법)의 조합으로 만들어집니다. 하지만
              재현 가능한 형태로 기록·검색할 공간이 부족했습니다.
            </p>
            <p>
              AIsle은 이 과정을 <strong className="font-semibold text-slate-200">레시피</strong>로 구조화해, 누구나
              고품질 결과를 다시 만들고 서로의 실험을 참고할 수 있게 하려는 프로젝트입니다.
            </p>
            <blockquote className="border-l-4 border-violet-400 bg-slate-900/60 py-5 pl-6 pr-5 text-slate-300 backdrop-blur-sm">
              단순한 이미지 호스팅이 아니라, 프롬프트 역설계·워크플로 공유·커뮤니티 피드가 이어지는 AI 창작 허브를
              지향합니다.
            </blockquote>
            <p>
              같은 복도를 걷는 메이커들이 레시피를 나누고 피드백을 주고받을 수 있는 환경을 만들고 있습니다.
            </p>
          </motion.div>
        </Section>

        {/* 복도 안내 */}
        <Section className="border-t border-slate-800/80 py-12 md:py-14">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">복도 안내</h2>
              <p className="mt-3 max-w-xl text-sm text-slate-500 md:text-base">
                홈 상단 탭과 동일한 여섯 개 복도로 콘텐츠를 구분합니다.
              </p>
            </div>
            <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">
              Six aisles, one feed
            </p>
          </div>

          <ul className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {corridors.map(({ name, slug, desc, Icon }) => (
              <li
                key={slug}
                className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/50 p-6 shadow-lg shadow-black/20"
              >
                <Icon
                  className="pointer-events-none absolute -right-2 -top-2 h-36 w-36 text-violet-400/[0.06]"
                  strokeWidth={1}
                  aria-hidden
                />
                <Icon className="relative h-8 w-8 text-violet-400" strokeWidth={1.75} aria-hidden />
                <p className="relative mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">{slug}</p>
                <h3 className="relative mt-1 font-sans text-lg font-bold text-white">{name}</h3>
                <p className="relative mt-3 text-sm leading-relaxed text-slate-400">{desc}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 주요 기능 */}
        <Section className="border-t border-slate-800/80 py-12 md:py-14">
          <h2 className="font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">주요 기능</h2>
          <p className="mt-3 max-w-2xl text-sm text-slate-500 md:text-base">
            현재 서비스에서 바로 쓸 수 있는 핵심 흐름입니다. 자세한 FAQ는{' '}
            <a href="/support" className="text-violet-400 underline-offset-2 hover:underline">
              고객지원
            </a>
            을 참고하세요.
          </p>

          <ul className="mt-7 grid gap-5 sm:grid-cols-2">
            {features.map(({ title, desc, Icon }) => (
              <li
                key={title}
                className="flex gap-4 rounded-xl border border-slate-800/80 bg-slate-900/40 p-5"
              >
                <Icon className="mt-0.5 h-6 w-6 shrink-0 text-violet-400" strokeWidth={1.75} aria-hidden />
                <motion.div
                  initial={reduce ? false : { opacity: 0 }}
                  whileInView={reduce ? undefined : { opacity: 1 }}
                  viewport={{ once: true }}
                >
                  <h3 className="font-sans text-base font-bold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{desc}</p>
                </motion.div>
              </li>
            ))}
          </ul>
        </Section>

        {/* 마치며 */}
        <Section className="border-t border-slate-800/80 py-12 text-center md:py-16">
          <h2 className="font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">마치며</h2>
          <motion.div
            className="mx-auto mt-5 max-w-3xl space-y-3 text-base leading-relaxed text-slate-400 md:text-[17px]"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <p>
              현재 <strong className="font-semibold text-slate-200">알파 단계</strong>로 운영 중이며, 업로드 이미지{' '}
              <strong className="font-semibold text-slate-200">워터마크 합성</strong>·최적화·피드 UX를 계속 다듬고
              있습니다.
            </p>
            <p>
              써 보시고 불편한 점이나 바라는 점이 있으면{' '}
              <a href="/support" className="text-violet-400 underline-offset-2 hover:underline">
                고객지원
              </a>
              으로 알려 주시면 반영에 참고하겠습니다.
            </p>
          </motion.div>
        </Section>
      </motion.div>
    </main>
  );
}
