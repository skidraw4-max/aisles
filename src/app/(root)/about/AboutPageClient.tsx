'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { FlaskConical, Hammer, MessageCircle, Palette } from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
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

const boards: { name: string; desc: string; Icon: typeof Palette }[] = [
  {
    name: 'Gallery',
    desc: '시각적 영감을 얻고 검증된 이미지 레시피를 확인하는 곳입니다.',
    Icon: Palette,
  },
  {
    name: 'LAB',
    desc: '설정값에 따른 결과 변화를 분석하고, AI를 활용한 최적화 가이드를 제공합니다.',
    Icon: FlaskConical,
  },
  {
    name: 'Lounge',
    desc: 'AI 트렌드와 일상의 지식을 가볍게 나누는 소통 공간입니다.',
    Icon: MessageCircle,
  },
  {
    name: 'Build',
    desc: '플랫폼 개발 스택과 프로젝트 제작기를 공유하는 메이커 전용 공간입니다.',
    Icon: Hammer,
  },
];

export function AboutPageClient() {
  const reduce = useReducedMotion();

  return (
    <main className="min-h-screen bg-[#020617] text-slate-400 antialiased">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-slate-800/80">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-[100px]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-1/4 top-0 h-64 w-64 rounded-full bg-cyan-500/10 blur-[80px]"
          aria-hidden
        />

        <motion.div
          className="relative mx-auto max-w-6xl px-6 py-12 md:py-16"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-400 md:text-sm">
            The Synthetic Curator
          </p>
          <h1 className="mt-6 max-w-4xl font-sans text-4xl font-bold leading-[1.15] tracking-tight text-white md:text-5xl lg:text-6xl">
            We curate the future of
            <br />
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              AI Prompt Alchemy.
            </span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-relaxed text-slate-400 md:text-lg">
            AisleHub is an editorial research space where artificial intelligence and human creativity intersect to refine
            the &apos;recipes&apos; of tomorrow.
          </p>
        </motion.div>
      </div>

      <div className="mx-auto max-w-6xl px-6">
        {/* 제작 동기 */}
        <Section className="grid gap-6 py-12 md:grid-cols-2 md:gap-8 md:py-14">
          <div>
            <h2 className="font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">제작 동기</h2>
            <div className="mt-4 h-1 w-12 rounded-full bg-cyan-400" aria-hidden />
          </div>
          <div className="space-y-6 text-base leading-relaxed md:text-[17px]">
            <p>
              AI 이미지는 프롬프트(재료)와 설정값(조리법)의 조합으로 탄생합니다. 하지만 이를 체계적으로 기록할 곳이 없어
              불편했습니다.
            </p>
            <p>
              저는 이 과정을 하나의 <strong className="font-semibold text-slate-200">「레시피」</strong>로 구조화하여,
              누구나 고품질 결과물을 재현하고 공유할 수 있는 공간을 만들고자 AIsleHub를 시작했습니다.
            </p>
            <blockquote className="border-l-4 border-cyan-400 bg-slate-900/60 py-5 pl-6 pr-5 text-slate-300 backdrop-blur-sm">
              AisleHub는 단순한 저장소가 아닙니다. 지능적인 창의성이 모여 실현 가능한 미래를 설계하는 디지털
              실험실입니다.
            </blockquote>
            <p>
              같은 복도를 걷는 메이커들이 레시피를 나누고, 서로의 실험을 참고해 나아갈 수 있는 허브를 지향합니다.
            </p>
          </div>
        </Section>

        {/* 주요 게시판 */}
        <Section className="border-t border-slate-800/80 py-12 md:py-14">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">주요 게시판 안내</h2>
              <p className="mt-3 max-w-xl text-sm text-slate-500 md:text-base">
                AisleHub의 생태계를 구성하는 네 개의 핵심 기둥
              </p>
            </div>
            <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
              Structured Exploration
            </p>
          </div>

          <ul className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {boards.map(({ name, desc, Icon }) => (
              <li
                key={name}
                className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/50 p-6 shadow-lg shadow-black/20"
              >
                <Icon
                  className="pointer-events-none absolute -right-2 -top-2 h-36 w-36 text-cyan-400/[0.06]"
                  strokeWidth={1}
                  aria-hidden
                />
                <Icon className="relative h-8 w-8 text-cyan-400" strokeWidth={1.75} aria-hidden />
                <h3 className="relative mt-5 font-sans text-lg font-bold text-white">{name}</h3>
                <p className="relative mt-3 text-sm leading-relaxed text-slate-400">{desc}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 마치며 — 통계(숫자) 없음 */}
        <Section className="border-t border-slate-800/80 py-12 text-center md:py-16">
          <h2 className="font-sans text-3xl font-bold tracking-tight text-white md:text-4xl">마치며</h2>
          <div className="mx-auto mt-5 max-w-3xl space-y-3 text-base leading-relaxed text-slate-400 md:text-[17px]">
            <p>
              현재 <strong className="font-semibold text-slate-200">알파 버전</strong>으로 운영 중이며, 서버 측{' '}
              <strong className="font-semibold text-slate-200">워터마크 자동 합성</strong> 및{' '}
              <strong className="font-semibold text-slate-200">이미지 최적화</strong> 등 기술적 완성도를 높여가고
              있습니다. 창작 흐름이 끊기지 않도록 인프라와 UX를 다듬고 있습니다.
            </p>
            <p>
              AI라는 거대한 복도(Aisle)에서 함께 성장할 메이커분들의 소중한 피드백을 기다립니다. 서비스를 써 보시고
              불편한 점·바라는 점을 편하게 알려 주세요.
            </p>
          </div>
        </Section>
      </div>
    </main>
  );
}
