import { Component, Input } from '@angular/core';

export interface ChartPoint {
  label: string;
  value: number;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** '2026-06' → 'Jun' (axis label for a YYYY-MM month key). */
export function monthLabel(month: string): string {
  const n = Number(month.slice(5, 7));
  return SHORT_MONTHS[n - 1] ?? month;
}

/**
 * Dependency-free single-series bar chart (monthly sales), hand-built
 * with CSS so it stays sharp and fully responsive on every screen.
 *
 * The Y axis picks a nice ceiling from the data (1 / 2 / 2.5 / 5 ×
 * 10ⁿ) and draws ticks at max, 2max/3, max/3 and 0, labelled with
 * compact k/M formatting.
 */
@Component({
  selector: 'app-performance-chart',
  template: `
    <div class="chart" role="img" aria-label="Monthly sales for the last six months">
      <div class="chart__plot">
        @for (tick of ticks; track tick) {
          <div class="chart__line" [style.top.%]="lineTop(tick)">
            <span class="chart__tick">{{ fmtTick(tick) }}</span>
          </div>
        }

        <div class="chart__groups">
          @for (point of data; track point.label) {
            <div class="chart__group">
              <span
                class="chart__bar"
                [style.height.%]="pct(point.value)"
                [attr.title]="point.label + ' — ' + fmtTick(point.value)"
              ></span>
              <span class="chart__label">{{ point.label }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class PerformanceChart {
  @Input({ required: true }) data: ChartPoint[] = [];

  /** Nice ceiling derived from the data (1 / 2 / 2.5 / 5 × 10ⁿ). */
  private get ceiling(): number {
    const peak = Math.max(0, ...this.data.map((p) => p.value));
    if (peak <= 0) return 1;
    const exp = Math.floor(Math.log10(peak));
    const base = Math.pow(10, exp);
    const n = peak / base;
    const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * base;
  }

  /** Gridline values: max, 2max/3, max/3, 0 (top to bottom). */
  get ticks(): number[] {
    const max = this.ceiling;
    return [max, (max * 2) / 3, max / 3, 0];
  }

  pct(value: number): number {
    return Math.min(100, Math.max(0, (value / this.ceiling) * 100));
  }

  /** Gridline position: values rise from bottom to top. */
  lineTop(tick: number): number {
    return 100 - this.pct(tick);
  }

  /** '1.2M' / '800k' / '667k' / '450' — compact axis + tooltip labels. */
  fmtTick(value: number): string {
    if (value >= 1_000_000) {
      const v = value / 1_000_000;
      return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}M`;
    }
    if (value >= 1_000) {
      const v = value / 1_000;
      return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}k`;
    }
    return String(Math.round(value));
  }
}
