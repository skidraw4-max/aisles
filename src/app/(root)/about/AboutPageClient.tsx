'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
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
    return <section className={`py-20 ${className}`}>{children}</section>;
  }
  return (
    <motion.section
      className={`py-20 ${className}`}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
}

const boards = [
  {
    icon: '🎨',
    name: 'Gallery',
    desc: '시각적 영감을 얻고 검증된 이미지 레시피를 확인하는 곳입니다.',
  },
  {
    icon: '🧪',
    name: 'LAB',
    desc: '설정값에 따른 결과 변화를 분석하고, AI를 활용한 최적화 가이드를 제공합니다.',
  },
  {
    icon: '☕',
    name: 'Lounge',
    desc: 'AI 트렌드와 일상의 지식을 가볍게 나누는 소통 공간입니다.',
  },
  {
    icon: '🏗️',
    name: 'Build',
    desc: '플랫폼 개발 스택과 프로젝트 제작기를 공유하는 메이커 전용 공간입니다.',
  },
];

export function AboutPageClient() {
  const reduce = useReducedMotion();
  return (
    <main className="min-h-screen bg-gray-50 text-gray-600">
      <motion.div
        className="border-b border-gray-200/80 bg-white"
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mx-auto max-w-3xl px-6 py-24 md:py-28">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-gray-400">About</p>
          <h1 className="font-serif text-4xl font-medium leading-tight tracking-tight text-gray-900 md:text-5xl">
            AI 프롬프트 레시피 플랫폼,
            <br />
            <span className="text-gray-800">AIsleHub</span>를 만들고 있습니다.
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-gray-600">
            프롬프트와 설정을 <strong className="font-medium text-gray-800">레시피</strong>로 남기고, 같은 복도를 걷는
            메이커들과 나누는 허브입니다.
          </p>
        </div>
      </motion.div>

      <div className="mx-auto max-w-3xl px-6">
        <Section>
          <h2 className="font-serif text-3xl font-medium text-gray-900 md:text-[2rem]">제작 동기</h2>
          <div className="mt-8 space-y-5 text-base leading-relaxed md:text-lg">
            <p>
              AI 이미지는 프롬프트(재료)와 설정값(조리법)의 조합으로 탄생합니다. 하지만 이를 체계적으로 기록할 곳이 없어
              불편했습니다.
            </p>
            <p>
              저는 이 과정을 하나의 <strong className="font-medium text-gray-800">「레시피」</strong>로 구조화하여, 누구나
              고품질 결과물을 재현하고 공유할 수 있는 공간을 만들고자 AIsleHub를 시작했습니다.
            </p>
          </div>
        </Section>

        <Section className="border-t border-gray-200/70">
          <h2 className="font-serif text-3xl font-medium text-gray-900 md:text-[2rem]">핵심 기능 · 복도 안내</h2>
          <p className="mt-4 text-base leading-relaxed md:text-lg">
            서비스는 네 가지 복도를 중심으로 콘텐츠를 모읍니다.
          </p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {boards.map((b) => (
              <li
                key={b.name}
                className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm shadow-gray-200/40 transition-shadow hover:shadow-md"
              >
                <span className="text-2xl" aria-hidden>
                  {b.icon}
                </span>
                <h3 className="mt-3 font-serif text-xl font-medium text-gray-900">{b.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600 md:text-base">{b.desc}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section className="border-t border-gray-200/70">
          <h2 className="font-serif text-3xl font-medium text-gray-900 md:text-[2rem]">기술적 가치</h2>
          <div className="mt-8 space-y-5 text-base leading-relaxed md:text-lg">
            <p>
              현재 <strong className="font-medium text-gray-800">알파 버전</strong>으로 운영 중이며, 서버 측{' '}
              <strong className="font-medium text-gray-800">워터마크 자동 합성</strong> 및{' '}
              <strong className="font-medium text-gray-800">이미지 최적화</strong> 등 기술적 완성도를 꾸준히 높이고
              있습니다.
            </p>
            <p>
              창작물의 흐름이 끊기지 않도록 인프라와 UX를 다듬는 데 집중하고, 피드백을 반영해 안정적인 프로덕트로
              다듬어 가겠습니다.
            </p>
          </div>
        </Section>

        <Section className="border-t border-gray-200/70 pb-28">
          <h2 className="font-serif text-3xl font-medium text-gray-900 md:text-[2rem]">메이커 소개</h2>
          <div className="mt-8 space-y-5 text-base leading-relaxed md:text-lg">
            <p>
              AIsleHub는 AI라는 거대한 복도(Aisle)에서 함께 성장할 메이커분들을 위해 기획·개발하고 있습니다. 초기 사용자의
              솔직한 피드백이 서비스 방향을 잡는 데 큰 힘이 됩니다.
            </p>
            <p>
              아래에서 서비스를 직접 써 보시고, 불편한 점·바라는 점을 편하게 알려 주세요.
            </p>
            <p>
              <a
                href="https://aisleshub.com"
                className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 transition-colors hover:decoration-gray-500"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://aisleshub.com
              </a>
            </p>
            <p className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 hover:decoration-gray-500"
              >
                ← 홈으로 돌아가기
              </Link>
              {' · '}
              <Link
                href="/support"
                className="inline-flex items-center text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 hover:decoration-gray-500"
              >
                고객지원
              </Link>
            </p>
          </div>
        </Section>
      </div>
    </main>
  );
}
