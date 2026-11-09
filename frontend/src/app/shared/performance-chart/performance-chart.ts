import { Component, Input } from '@angular/core';

export interface ChartPoint {
  label: string;
  crops: number;
  livestock: number;
}

/**
 * Dependency-free grouped bar chart (Crops vs Livestock),
 * hand-built with CSS so it stays sharp and fully responsive
 * on every screen size. Data is static until the backend lands.
 */
@Component({
  selector: 'app-performance-chart',
  template: `
    <div class="chart" role="img" aria-label="Farm performance: crops and livestock by month">
      <div class="chart__plot">
        @for (tick of ticks; track tick) {
          <div class="chart__line" [style.top.%]="lineTop(tick)">
            <span class="chart__tick">{{ tick / 1000 }}k</span>
          </div>
        }

        <div class="chart__groups">
          @for (point of data; track point.label) {
            <div class="chart__group">
              <span
                class="chart__bar chart__bar--crops"
                [style.height.%]="pct(point.crops)"
                [attr.title]="point.label + ' — crops: ' + point.crops"
              ></span>
              <span
                class="chart__bar chart__bar--livestock"
                [style.height.%]="pct(point.livestock)"
                [attr.title]="point.label + ' — livestock: ' + point.livestock"
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
  @Input() max = 3000;

  readonly ticks = [3000, 2000, 1000, 0];

  pct(value: number): number {
    return Math.min(100, Math.max(0, (value / this.max) * 100));
  }

  /** Gridline position: values rise from bottom to top. */
  lineTop(tick: number): number {
    return 100 - this.pct(tick);
  }
}
