import { Component, Input, signal } from '@angular/core';

/**
 * FARMIS wordmark backed by the real logo
 * (public/images/logo.png — cropped + transparent). If the image is
 * ever missing, it falls back to the built-in leaf icon tile.
 */
@Component({
  selector: 'app-brand',
  template: `
    <span class="brand__mark" aria-hidden="true">
      @if (!logoFailed()) {
        <img src="/images/logo.png" alt="" (error)="logoFailed.set(true)" />
      } @else {
        <i class="fa-solid fa-leaf"></i>
      }
    </span>
    <span class="brand__text">
      <span class="brand__name">FARMIS</span>
      <span class="brand__tag">Mkwasi Agri Business</span>
    </span>
  `,
  host: {
    class: 'brand',
    '[class.brand--light]': "tone === 'light'",
    '[class.brand--compact]': 'compact',
    '[class.brand--img]': '!logoFailed()',
  },
})
export class Brand {
  @Input() tone: 'dark' | 'light' = 'dark';
  @Input() compact = false;

  protected readonly logoFailed = signal(false);
}
