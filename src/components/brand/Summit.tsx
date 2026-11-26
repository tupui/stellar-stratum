import { useState } from 'react';
import { LOGO, MOUNTAIN_ABOVE, MOUNTAIN_BELOW, SPARKS, SUMMIT, TRAIL } from './summitScene';

/** The climbed trail: the logo's own cyan fringe. Still to climb: faint white. */
const LIT = '#35E0FF';
const UNLIT = '#F6F4F7';
/** One trail cell lights every 40 ms when a step completes. */
const CELL_MS = 40;

// Every motion is stepped and runs once; none of it under reduced motion.
const CSS = `
@keyframes summit-cell { from { fill: ${UNLIT}; opacity: .3 } to { fill: ${LIT}; opacity: 1 } }
.summit-cell-in { animation: summit-cell 1ms steps(1, end) both; }
@keyframes summit-spark { from { opacity: 0 } to { opacity: var(--o) } }
.summit-spark { animation: summit-spark 1ms steps(1, end) both; }
.summit-logo { transform-box: fill-box; }
@media (prefers-reduced-motion: reduce) {
  .summit-cell-in, .summit-spark { animation: none !important; }
}
`;

interface SummitProps {
  /** Share of the trail lit, 0 to 1: the share of the submission steps done. */
  lit: number;
  /** The summit is reached: the logo powers on once and the sparks step out once. */
  summit?: boolean;
  /** The logo's opacity: dimmed when the climb stopped short. */
  flower?: number;
  className?: string;
}

/**
 * The mountain with the edelweiss on its ledge, drawn from the design canvas generator. The trail
 * lights cell by cell as a submission goes; the logo is the settled one, never redrawn.
 */
export const Summit = ({ lit, summit = false, flower = 1, className }: SummitProps) => {
  const count = Math.round(Math.max(0, Math.min(1, lit)) * TRAIL.length);
  // The cells lit by the latest change step in; those lit before stay as they are.
  const [climb, setClimb] = useState({ from: count, to: count });
  if (climb.to !== count) setClimb({ from: Math.min(climb.to, count), to: count });

  const { width, height, pad, logo, mountainHeight } = SUMMIT;
  return (
    <svg
      className={className}
      width={width}
      height={Math.round(height)}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={summit ? 'Stratum: the summit is reached' : `Stratum: ${count} of ${TRAIL.length} trail steps climbed`}
    >
      <style>{CSS}</style>
      <defs>
        <linearGradient id="summit-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".62" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="summit-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={mountainHeight}>
          <rect width={width} height={mountainHeight} fill="url(#summit-fade)" />
        </mask>
      </defs>
      <g transform={`translate(0 ${pad})`}>
        <g mask="url(#summit-mask)">
          <g dangerouslySetInnerHTML={{ __html: MOUNTAIN_BELOW }} />
          {TRAIL.map(([x, y], i) => {
            const on = i < count;
            const fresh = on && i >= climb.from;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={SUMMIT.cell}
                height={SUMMIT.cell}
                fill={on ? LIT : UNLIT}
                opacity={on ? 1 : 0.3}
                className={fresh ? 'summit-cell-in' : undefined}
                style={fresh ? { animationDelay: `${(i - climb.from) * CELL_MS}ms` } : undefined}
              />
            );
          })}
          <g dangerouslySetInnerHTML={{ __html: MOUNTAIN_ABOVE }} />
        </g>
      </g>
      {summit &&
        SPARKS.map(([x, y, size, o, ring], i) => (
          <rect
            key={i}
            x={x}
            y={y}
            width={size}
            height={size}
            fill="#D9FF00"
            opacity={o}
            className="summit-spark"
            style={{ '--o': o, animationDelay: `${480 + ring * 80}ms` } as React.CSSProperties}
          />
        ))}
      <svg x={logo.x} y={logo.y} width={logo.size} height={logo.size} viewBox="0 0 220 220" opacity={flower}>
        <g className={summit ? 'summit-logo crt-on' : 'summit-logo'} dangerouslySetInnerHTML={{ __html: LOGO }} />
      </svg>
    </svg>
  );
};
