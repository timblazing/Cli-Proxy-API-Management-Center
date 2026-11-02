/**
 * Inline-SVG pool chart: recorded line (solid) and projection (dashed) with
 * soft area fills, day grid, a "Now" marker, reset step labels, and a hover
 * crosshair. No chart dependency; geometry is plain arithmetic on the range.
 */

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDayTick, formatWhen, niceMax } from './poolFormat';
import { findRecordedSteps, findSteps, valueAt, type PoolPoint } from './poolModel';
import { dayTicks, type PoolRange, type PoolView } from './poolView';
import styles from './PoolChart.module.scss';

export type PoolChartMode = 'remaining' | 'drain';

export interface PoolChartProps {
  mode: PoolChartMode;
  view: PoolView;
  range: PoolRange;
  now: number;
  /** CSS colour for the series (a hex value or a var()). */
  color: string;
  locale: string;
  ariaLabel: string;
}

const HEIGHT = 300;
const MARGIN = { left: 52, right: 16, top: 30, bottom: 30 };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === 'number') setWidth(Math.round(next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Points inside the range plus the last one before it, so the line enters the plot. */
function clipSeries(points: readonly PoolPoint[], range: PoolRange): PoolPoint[] {
  const out: PoolPoint[] = [];
  let carry: PoolPoint | null = null;
  for (const point of points) {
    if (point.t < range.from) {
      carry = point;
      continue;
    }
    if (point.t > range.to) {
      out.push(point);
      break;
    }
    out.push(point);
  }
  return carry ? [carry, ...out] : out;
}

export function PoolChart(props: PoolChartProps) {
  const { mode, view, range, now, color, locale, ariaLabel } = props;
  const { t } = useTranslation();
  const gradientBase = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const recorded = mode === 'remaining' ? view.recorded : view.burnRecorded;
  const projected = mode === 'remaining' ? view.projected : view.burnProjected;

  const yMax = useMemo(() => {
    if (mode === 'remaining') return Math.max(view.capacity, 1);
    const peak = Math.max(0, ...recorded.map((p) => p.v), ...projected.map((p) => p.v));
    return niceMax(peak * 1.1);
  }, [mode, view.capacity, recorded, projected]);

  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const span = range.to - range.from;
  const x = (ts: number) => MARGIN.left + ((ts - range.from) / span) * plotW;
  const y = (value: number) => MARGIN.top + plotH - (Math.min(value, yMax) / yMax) * plotH;
  const baseY = MARGIN.top + plotH;

  const line = (points: readonly PoolPoint[]) =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
      .join(' ');
  const area = (points: readonly PoolPoint[]) =>
    points.length < 2
      ? ''
      : `${line(points)} L${x(points[points.length - 1].t).toFixed(1)} ${baseY} L${x(points[0].t).toFixed(1)} ${baseY} Z`;

  const recordedClipped = useMemo(
    () =>
      clipSeries(
        recorded.filter((p) => p.t <= now),
        range
      ),
    [recorded, now, range]
  );
  const projectedClipped = useMemo(
    () =>
      clipSeries(
        projected.filter((p) => p.t >= now),
        range
      ),
    [projected, now, range]
  );

  const ticks = useMemo(() => dayTicks(range), [range]);
  const dayW = plotW / Math.max(ticks.length, 1);
  const tickEvery = dayW < 30 ? 3 : dayW < 56 ? 2 : 1;

  const steps = useMemo(() => {
    if (mode !== 'remaining') return [];
    const all = [...findRecordedSteps(recorded), ...findSteps(projected)].filter(
      (step) => step.t >= range.from && step.t <= range.to
    );
    all.sort((a, b) => a.t - b.t);
    const kept: typeof all = [];
    let lastX = -Infinity;
    all.forEach((step) => {
      const px = x(step.t);
      if (px - lastX < 38) return;
      kept.push(step);
      lastX = px;
    });
    return kept;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recorded, projected, range, plotW]);

  const nowVisible = now >= range.from && now <= range.to;
  const emptyAt = mode === 'remaining' ? view.poolEmpty : null;
  const emptyVisible = emptyAt !== null && emptyAt >= range.from && emptyAt <= range.to;

  const hover = (() => {
    if (hoverX === null || plotW <= 0) return null;
    const ts = range.from + ((hoverX - MARGIN.left) / plotW) * span;
    if (ts < range.from || ts > range.to) return null;
    const isRecorded = ts <= now;
    const series = isRecorded ? recorded : projected;
    const value = valueAt(series, ts);
    if (value === null) return null;
    return { ts, value, isRecorded };
  })();

  const yLabels = [0, 0.5, 1].map((fraction) => ({
    fraction,
    value: yMax * fraction,
  }));
  const formatY = (value: number) =>
    mode === 'remaining'
      ? `${Math.round(value)}%`
      : t('quota_management.pool_burn_value', { value: Number(value.toFixed(value < 10 ? 1 : 0)) });

  const recordedId = `${gradientBase}-rec`;
  const projectedId = `${gradientBase}-proj`;
  const clipId = `${gradientBase}-clip`;

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverX(event.clientX - rect.left);
  };

  return (
    <div
      ref={ref}
      className={styles.chart}
      style={{ '--pool-color': color, height: HEIGHT } as CSSProperties}
    >
      {width > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverX(null)}
        >
          <defs>
            <linearGradient id={recordedId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--pool-color)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--pool-color)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={projectedId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--pool-color)" stopOpacity="0.13" />
              <stop offset="100%" stopColor="var(--pool-color)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x={MARGIN.left} y={MARGIN.top - 4} width={plotW} height={plotH + 8} />
            </clipPath>
          </defs>

          {yLabels.map(({ fraction, value }) => (
            <g key={fraction}>
              <line
                className={styles.gridH}
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={y(value)}
                y2={y(value)}
              />
              <text
                className={styles.axisText}
                x={MARGIN.left - 8}
                y={y(value) + 4}
                textAnchor="end"
              >
                {formatY(value)}
              </text>
            </g>
          ))}

          {ticks.map((tick, index) => {
            const left = x(tick);
            const next = index + 1 < ticks.length ? x(ticks[index + 1]) : MARGIN.left + plotW;
            return (
              <g key={tick}>
                <line className={styles.gridV} x1={left} x2={left} y1={MARGIN.top} y2={baseY} />
                {index % tickEvery === 0 && (
                  <text
                    className={styles.axisText}
                    x={(left + next) / 2}
                    y={baseY + 18}
                    textAnchor="middle"
                  >
                    {formatDayTick(tick, locale)}
                  </text>
                )}
              </g>
            );
          })}

          <g clipPath={`url(#${clipId})`}>
            {recordedClipped.length > 1 && (
              <>
                <path d={area(recordedClipped)} fill={`url(#${recordedId})`} />
                <path className={styles.lineRecorded} d={line(recordedClipped)} />
              </>
            )}
            {projectedClipped.length > 1 && (
              <>
                <path d={area(projectedClipped)} fill={`url(#${projectedId})`} />
                <path className={styles.lineProjected} d={line(projectedClipped)} />
              </>
            )}
          </g>

          {nowVisible && (
            <g>
              <line
                className={styles.nowLine}
                x1={x(now)}
                x2={x(now)}
                y1={MARGIN.top - 6}
                y2={baseY + 6}
              />
              <text className={styles.nowText} x={x(now)} y={MARGIN.top - 12} textAnchor="middle">
                {t('quota_management.pool_now')}
              </text>
            </g>
          )}

          {steps.map((step) => (
            <text
              key={`${step.t}:${step.to}`}
              className={styles.stepText}
              x={x(step.t)}
              y={Math.max(MARGIN.top + 10, y(step.to) - 7)}
              textAnchor="middle"
            >
              {t('quota_management.pool_step_gain', { value: Math.round(step.gain) })}
            </text>
          ))}

          {emptyVisible && emptyAt !== null && (
            <g>
              <circle className={styles.emptyMarker} cx={x(emptyAt)} cy={baseY} r={5} />
              <text
                className={styles.emptyText}
                x={Math.min(Math.max(x(emptyAt), MARGIN.left + 60), MARGIN.left + plotW - 60)}
                y={baseY - 12}
                textAnchor="middle"
              >
                {t('quota_management.pool_empty_marker', { when: formatWhen(emptyAt, locale) })}
              </text>
            </g>
          )}

          {hover && (
            <g pointerEvents="none">
              <line
                className={styles.crosshair}
                x1={x(hover.ts)}
                x2={x(hover.ts)}
                y1={MARGIN.top}
                y2={baseY}
              />
              <circle className={styles.hoverDot} cx={x(hover.ts)} cy={y(hover.value)} r={4} />
            </g>
          )}
        </svg>
      )}

      {hover && (
        <div
          className={styles.tooltip}
          style={{
            left: Math.min(Math.max(x(hover.ts), 90), Math.max(width - 90, 90)),
            top: Math.max(y(hover.value) - 40, 0),
          }}
        >
          {t(
            mode === 'remaining'
              ? 'quota_management.pool_tooltip_left'
              : 'quota_management.pool_tooltip_burn',
            {
              when: formatWhen(hover.ts, locale),
              value:
                mode === 'remaining' ? Math.round(hover.value) : Number(hover.value.toFixed(1)),
              kind: t(
                hover.isRecorded
                  ? 'quota_management.pool_legend_recorded'
                  : 'quota_management.pool_legend_projected'
              ).toLowerCase(),
            }
          )}
        </div>
      )}
    </div>
  );
}
