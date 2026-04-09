import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** 카카오·트위터 등 공유용 브랜드 OG 이미지 (동적 생성) */
export function createBrandOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(145deg, #1e1b4b 0%, #4c1d95 38%, #0f172a 72%, #020617 100%)',
          padding: 64,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 24,
            borderRadius: 24,
            border: '2px solid rgba(196, 181, 253, 0.35)',
            boxShadow:
              '0 0 80px rgba(139, 92, 246, 0.25), inset 0 0 60px rgba(99, 102, 241, 0.08)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, zIndex: 1 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: '#faf5ff',
              textShadow: '0 4px 32px rgba(139, 92, 246, 0.5)',
            }}
          >
            AIsle
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 600,
              color: 'rgba(226, 232, 240, 0.95)',
              letterSpacing: '-0.02em',
            }}
          >
            AI Recipe & Project Hub
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: '#c4b5fd',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            Lab · Gallery · Build · Launch
          </div>
          <div style={{ fontSize: 22, color: 'rgba(148, 163, 184, 0.95)' }}>aisles.kr</div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
    }
  );
}
