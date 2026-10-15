import React from 'react';
import {interpolate} from 'remotion';
import {along, boxCorners, coinStream, fitIso, IsoBox, IsoCoin, IsoFloor, IsoGlass, IsoMoney, proj, type P3} from '../kit/Iso';
import {EASE, useNow, useProgress, useScene, useSpringAt} from '../kit/motion';
import {useStage} from '../kit/stage';
import {alpha, FONT, useTheme} from '../kit/theme';

/**
 * 돈이 갈라져 나가는 구조 (2.5D, CoinVault 의 짝): 왼쪽 주문 더미에서 동전이 가게 금고로 날아가는데,
 * 말하는 순간마다 일부가 갈라져 앞쪽의 작은 동전 탑(이름표 붙음)으로 빠진다. 마지막에 빠진 몫을 알약 하나로.
 * "2만 원 중 4,400원이 가게를 떠난다", "수수료·배달비·부가세로 나뉜다" 처럼 한 덩어리 돈이 여러 곳으로 나뉠 때.
 *   props: flowAt · flowUntil · fill(금고 최종 높이 0~1) · source/target 이름표 · splits[{label, at, size(0~1 탑 높이)}] (2~4개) · pill {text, at} · night
 */
export type CoinSplitProps = {
  flowAt: number;
  flowUntil?: number;
  fill?: number;
  source?: string;
  target?: string;
  splits: {label: string; at: number; size?: number}[];
  pill?: {text: string; at: number};
  night?: boolean;
};

// 갈라진 몫이 쌓이는 자리 (금고 앞, 화면에선 아래쪽 한 줄)
// 금고 앞 한 줄 (x+y = 7 로 같은 깊이, x−y 간격 2 → 이름표가 겹치지 않는다)
const SPOTS: [number, number][] = [
  [3.25, 3.75],
  [4.25, 2.75],
  [5.25, 1.75],
  [6.25, 0.75],
];

const SplitStack: React.FC<{k: ReturnType<typeof fitIso>; x: number; y: number; n: number; color: string}> = ({k, x, y, n, color}) => (
  <>
    {Array.from({length: n}, (_, i) => (
      <IsoCoin key={i} k={k} p={[x, y, 0.08 + i * 0.13]} color={color} r={0.34} />
    ))}
  </>
);

export const CoinSplit: React.FC<CoinSplitProps> = (p) => {
  const {start} = useScene();
  const now = useNow();
  const {w, h, u} = useStage();
  const t = useTheme();
  const night = !!p.night;
  const line = night ? '#F3EDE2' : t.ink;
  const gold = t.triad.accent;
  const out = t.triad.dark;
  const card = t.triad.dark;
  const lastSplit = Math.max(...p.splits.map((s) => s.at));
  const until = p.flowUntil ?? Math.max(p.flowAt + 1.6, lastSplit + 0.6);
  const splits = p.splits.slice(0, SPOTS.length);

  const V = {x: 3.6, y: -1.0, w: 2.2, d: 2.2, h: 2.4};
  const k = fitIso(
    [
      ...boxCorners(-0.2, 2.3, 0, 2.1, 1.6, 0.4),
      ...boxCorners(V.x, V.y, 0, V.w, V.d, V.h + 1.1),
      ...splits.flatMap((_, i) => boxCorners(SPOTS[i][0] - 0.5, SPOTS[i][1] - 0.5, 0, 1, 1.6, 1.4)),
    ],
    w,
    h,
    0.8,
    -h * 0.02,
  );

  const appear = useSpringAt(start, 'soft');
  const level = interpolate(now, [p.flowAt + 0.5, until + 0.9], [0, p.fill ?? 0.6], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE.inOut});
  const pillK = useSpringAt(p.pill?.at, 'pop');
  const labelK = useProgress(start + 0.2, 0.4, EASE.out);

  const from: P3 = [0.95, 2.95, 0.42];
  const to: P3 = [V.x + V.w / 2, V.y + V.d / 2, Math.max(0.4, level * V.h) + 0.2];
  const main = coinStream(now, p.flowAt, until, 14, 0.85);
  const goldH = level * V.h;

  // 몫마다: at 부터 0.7초 동안 동전 5개가 탑 자리로, 탑은 size 만큼 자란다
  const parts = splits.map((s, i) => {
    const [sx, sy] = SPOTS[i];
    const grow = interpolate(now, [s.at + 0.3, s.at + 1.1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE.out});
    const n = Math.round(grow * (2 + Math.round((s.size ?? 0.5) * 7)));
    const flying = coinStream(now, s.at, s.at + 0.7, 5, 0.6);
    return {s, sx, sy, n, flying};
  });
  const labelOf = (at: number) => interpolate(now, [at + 0.2, at + 0.6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const tag = (text: string | undefined, at: P3, opacity: number, dy = 0, size = 40, color = alpha(line, 0.75)) => {
    if (!text) return null;
    const [x, y] = proj(k, at);
    return (
      <div
        style={{
          position: 'absolute', left: x - 200 * u, top: y + dy, width: 400 * u, textAlign: 'center', opacity,
          fontFamily: FONT.sans, fontWeight: 800, fontSize: size * u, color, letterSpacing: '-0.02em', whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    );
  };

  return (
    <div style={{position: 'absolute', inset: 0}}>
      {night ? <div style={{position: 'absolute', inset: 0, borderRadius: 40 * u, overflow: 'hidden', background: '#14110E'}} /> : null}
      <svg width={w} height={h} style={{position: 'absolute', inset: 0, overflow: 'visible', opacity: appear}}>
        <IsoFloor k={k} x0={-0.6} y0={-1.8} x1={7.6} y1={4.8} line={alpha(line, night ? 0.08 : 0.07)} />
        {/* 주문 더미 */}
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <IsoBox k={k} x={0.1 - i * 0.12} y={2.4 + i * 0.1} z={i * 0.13} w={1.75} d={1.1} h={0.1} color={card} />
            <IsoBox k={k} x={0.1 - i * 0.12} y={2.62 + i * 0.1} z={i * 0.13 + 0.1} w={1.75} d={0.16} h={0.005} color={gold} opacity={0.9} />
          </g>
        ))}
        {/* 가게 금고 */}
        <IsoGlass k={k} {...V} line={line} part="back" />
        {goldH > 0.01 ? <IsoMoney k={k} x={V.x + 0.15} y={V.y + 0.15} w={V.w - 0.3} d={V.d - 0.3} h={goldH} color={gold} /> : null}
        <IsoGlass k={k} {...V} line={line} part="front" />
        {main.map(({u: q, i}) => (
          <IsoCoin key={`m${i}`} k={k} p={along(from, to, EASE.inOut(q), 1.6)} color={gold} r={0.32} opacity={q > 0.92 ? (1 - q) / 0.08 : 1} />
        ))}
        {/* 갈라져 나간 몫 (다른 색) */}
        {parts.map(({sx, sy, n, flying}, j) => (
          <g key={`s${j}`}>
            <SplitStack k={k} x={sx} y={sy} n={n} color={out} />
            {flying.map(({u: q, i}) => (
              <IsoCoin key={i} k={k} p={along([1.6, 2.3, 1.0], [sx, sy, 0.3 + n * 0.13], EASE.inOut(q), 1.1)} color={out} r={0.3} opacity={q > 0.9 ? (1 - q) / 0.1 : 1} />
            ))}
          </g>
        ))}
      </svg>
      {tag(p.source, [0.75, 3.75, 0], labelK, 26 * u)}
      {tag(p.target, [V.x + V.w, V.y + V.d, 0], labelK, 10 * u)}
      {parts.map(({s, sx, sy}, j) => (
        <React.Fragment key={j}>{tag(s.label, [sx + 0.35, sy + 0.35, 0], labelOf(s.at), (18 + (j % 2) * 44) * u, 36, line)}</React.Fragment>
      ))}
      {p.pill && pillK > 0.01 ? (() => {
        const [x, y] = proj(k, [SPOTS[Math.min(1, splits.length - 1)][0], SPOTS[Math.min(1, splits.length - 1)][1], 2.6]);
        return (
          <div
            style={{
              position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${pillK})`,
              padding: `${14 * u}px ${34 * u}px`, borderRadius: 999, background: out, color: '#FFFFFF',
              fontFamily: FONT.sans, fontWeight: 900, fontSize: 60 * u, letterSpacing: '-0.03em', whiteSpace: 'nowrap',
              boxShadow: `0 ${10 * u}px ${30 * u}px ${alpha(out, 0.35)}`,
            }}
          >
            {p.pill.text}
          </div>
        );
      })() : null}
    </div>
  );
};
