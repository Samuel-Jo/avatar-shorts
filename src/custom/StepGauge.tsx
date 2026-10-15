import React from 'react';
import {interpolate} from 'remotion';
import {boxCorners, fitIso, IsoBox, IsoCoin, IsoFloor, proj, type P3} from '../kit/Iso';
import {EASE, useNow, useProgress, useScene, useSpringAt} from '../kit/motion';
import {useStage} from '../kit/stage';
import {alpha, FONT, useTheme} from '../kit/theme';

/**
 * 단계가 오르는 구조 (2.5D 계단): 계단 칸이 하나씩 불이 켜지며 동전 표시가 올라가고, 맨 위(cap)에는 천장 판.
 * 천장을 넘는 몫(over)은 천장 판 위에 이어 쌓이는 붉은 계단으로 — "계산대로라면 37단계, 하지만 33단계가 천장" 같은 말에.
 * 할증료·요금·세율처럼 "구간(단계)으로 정해지는 돈" 에 쓴다 (EP04 유류할증료).
 *   props: steps(계단 칸 수, 기본 cap) · from/to(단계) · riseAt/riseUntil(원본 초) · cap · capLabel · over · overAt · overLabel · floorLabel · unit · hideLevel · pill {text, at}
 *   글자는 짧게(이름표 10자 안팎). 화면 숫자는 말한 것만 — 오르는 동안의 단계 표시는 카운터처럼 지나간다.
 */
export type StepGaugeProps = {
  steps?: number;
  from?: number;
  to: number;
  riseAt: number;
  riseUntil?: number;
  cap?: number;
  capLabel?: string;
  over?: number;
  overAt?: number;
  overLabel?: string;
  floorLabel?: string;
  unit?: string;
  /** 지금 단계 숫자를 숨김 (말하지 않은 단계일 때) */
  hideLevel?: boolean;
  pill?: {text: string; at: number};
};

// 계단은 화면 오른쪽 위로 오른다: iso 의 -y 방향 (x 는 계단 폭)
const SW = 0.3; // 칸 너비 (-y)
const SH = 0.2; // 칸마다 높이
const D = 1.1; // 계단 폭 (x)
const top = (i: number) => i * SH;
const OW = SW * 1.8; // 천장 위 넘친 칸: 크게 (작으면 안 보인다)
const OH = SH * 3.2;
const y0 = (i: number) => -i * SW; // i 번째 칸(1부터)의 앞 가장자리 = -(i-1)*SW, 뒤 = -i*SW

export const StepGauge: React.FC<StepGaugeProps> = (p) => {
  const {start} = useScene();
  const now = useNow();
  const {w, h, u} = useStage();
  const t = useTheme();
  const line = t.ink;
  const gold = t.triad.accent;
  const red = '#C0271D';
  const cap = p.cap ?? 0;
  const over = cap ? p.over ?? 0 : 0;
  const N = p.steps ?? (cap || p.to);
  const total = N + over;
  const unit = p.unit ?? '단계';
  const ceilZ = cap ? top(cap) + 0.5 : 0;

  const k = fitIso([...boxCorners(-0.3, y0(N) - over * OW - 0.3, 0, D + 0.6, N * SW + over * OW + 0.6, Math.max(top(N), ceilZ + over * OH) + 1.1)], w, h, 0.84, h * 0.04);

  const appear = useSpringAt(start, 'soft');
  const until = p.riseUntil ?? p.riseAt + 1.6;
  const lvl = interpolate(now, [p.riseAt, until], [p.from ?? 0, p.to], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE.inOut});
  const overK = useProgress(p.overAt ?? 1e9, 0.9, EASE.out);
  const capK = useSpringAt(cap ? start + 0.3 : undefined, 'soft');
  const pillK = useSpringAt(p.pill?.at, 'pop');
  const labelK = useProgress(start + 0.25, 0.4, EASE.out);

  // 동전 표시: 지금 단계 칸 위 (단계 사이를 부드럽게)
  const li = Math.max(0.5, lvl);
  const marker: P3 = [D / 2, -(li - 0.5) * SW, top(li) + 0.25];
  const [mx, my] = proj(k, marker);

  const tag = (text: string, at: P3, color: string, dx: number, dy: number, size: number, show: number, align: 'left' | 'right' | 'center' = 'center') => {
    const [x, y] = proj(k, at);
    const tx = align === 'left' ? '0' : align === 'right' ? '-100%' : '-50%';
    return (
      <div
        style={{
          position: 'absolute', left: x + dx * u, top: y + dy * u, transform: `translate(${tx}, -50%)`, opacity: show,
          fontFamily: FONT.sans, fontWeight: 800, fontSize: size * u, color, letterSpacing: '-0.02em', whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    );
  };

  // 뒤(높은 칸) → 앞(낮은 칸) 순서로 그려야 앞 칸이 뒤 칸 아랫부분을 덮는다
  const order = Array.from({length: N}, (_, j) => N - j);
  return (
    <div style={{position: 'absolute', inset: 0}}>
      <svg width={w} height={h} style={{position: 'absolute', inset: 0, overflow: 'visible', opacity: appear}}>
        <IsoFloor k={k} x0={-0.6} y0={y0(total) - 0.6} x1={D + 0.6} y1={0.6} line={alpha(line, 0.07)} />
        {order.map((i) => {
          const lit = Math.min(1, Math.max(0, lvl - (i - 1)));
          return (
            <g key={i}>
              <IsoBox k={k} x={0} y={y0(i)} w={D} d={SW} h={top(i)} color="#E6DCCB" />
              {lit > 0 ? <IsoBox k={k} x={0} y={y0(i)} w={D} d={SW} h={top(i)} color={gold} opacity={lit} /> : null}
            </g>
          );
        })}
        {/* 천장 판: cap 칸 위에 떠 있고, 넘친 칸 쪽까지 덮는다 */}
        {cap ? (
          <g opacity={capK}>
            <IsoBox k={k} x={-0.25} y={y0(cap) - over * OW - SW} w={D + 0.5} d={8 * SW + over * OW} h={0.08} z={ceilZ} color={lighten(line)} opacity={0.9} />
          </g>
        ) : null}
        {/* 천장을 넘는 몫: 천장 판 위에 이어지는 붉은 계단 (계산대로라면 여기까지) */}
        {over > 0 && overK > 0
          ? Array.from({length: over}, (_, j) => {
              const q = over - 1 - j; // 뒤(높은 칸)부터
              const kk = Math.min(1, Math.max(0, overK * over - q));
              return <IsoBox key={q} k={k} x={0} y={y0(cap) - (q + 1) * OW} z={ceilZ + 0.08} w={D} d={OW} h={(q + 1) * OH * kk} color={red} opacity={0.6} />;
            })
          : null}
        <IsoCoin k={k} p={marker} color={gold} r={0.32} />
      </svg>
      {/* 지금 단계 */}
      {p.hideLevel ? null : <div
        style={{
          position: 'absolute', left: over ? mx - 60 * u : mx, top: my - 40 * u, transform: over ? 'translate(-100%, -100%)' : 'translate(-50%, -100%)', opacity: labelK,
          padding: `${8 * u}px ${22 * u}px`, borderRadius: 999, background: t.ink, color: '#FBF7EF',
          fontFamily: FONT.sans, fontWeight: 800, fontSize: 46 * u, whiteSpace: 'nowrap',
        }}
      >
        {Math.round(lvl)}
        {unit}
      </div>}
      {p.capLabel && cap ? tag(p.capLabel, [0, y0(cap - 7), ceilZ + 0.08], alpha(line, 0.85), -20, 50, 44, capK, 'right') : null}
      {p.overLabel && over ? tag(p.overLabel, [D, y0(cap) - over * OW, ceilZ + over * OH + 0.3], red, 0, -10, 46, overK, 'center') : null}
      {p.floorLabel ? tag(p.floorLabel, [D, 0, 0], alpha(line, 0.75), 20, 30, 40, labelK, 'left') : null}
      {p.pill && pillK > 0.01 ? (
        <div
          style={{
            position: 'absolute', left: w * 0.3, top: h * 0.22, transform: `translate(-50%, -50%) scale(${pillK})`,
            padding: `${14 * u}px ${34 * u}px`, borderRadius: 999, background: gold, color: '#1A1408',
            fontFamily: FONT.sans, fontWeight: 900, fontSize: 60 * u, letterSpacing: '-0.03em', whiteSpace: 'nowrap',
            boxShadow: `0 ${10 * u}px ${30 * u}px ${alpha(gold, 0.35)}`,
          }}
        >
          {p.pill.text}
        </div>
      ) : null}
    </div>
  );
};

// 천장 판 색: 글자색(잉크)을 그대로 쓰면 너무 무거워서 살짝 밝힌 hex 로
const lighten = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (s: number) => Math.min(255, Math.round(((n >> s) & 255) * 0.7 + 255 * 0.3));
  return `#${[16, 8, 0].map((s) => c(s).toString(16).padStart(2, '0')).join('')}`;
};
