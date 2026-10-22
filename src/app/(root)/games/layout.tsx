import type { Metadata } from 'next';

/** 자식 페이지(hub/detail/play)가 robots를  individually 설정 */
export const metadata: Metadata = {
  title: '게임 · AIsle',
};

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
