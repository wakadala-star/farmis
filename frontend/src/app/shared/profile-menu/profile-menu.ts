import { Component, computed, inject, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';

/**
 * Inline profile panel inside the shell's user dropdown (Phase 2E).
 *
 * Clicking the user-card (or the topbar avatar) opens the dropdown and
 * this panel is what it shows: tap the photo to change it (JPG/PNG/WebP,
 * max 1 MB) with a remove ✕ that reverts to initials, read-only name and
 * email, an optional phone number, and Sign out.
 *
 * Deliberately NOT here: password or name editing — signup/signin remain
 * the single source of truth for credentials (no password-change flow
 * exists in the system at all).
 */
@Component({
  selector: 'app-profile-menu',
  templateUrl: './profile-menu.html',
})
export class ProfileMenu {
  readonly auth = inject(AuthService);

  /** The shell closes its dropdown / signs out on this event. */
  readonly signedOut = output<void>();

  readonly phone = signal('');
  readonly saving = signal(false);
  readonly uploading = signal(false);
  readonly notice = signal('');
  readonly error = signal('');

  /** Mirrors the server's VARCHAR(25) limit before a save is attempted. */
  readonly phoneTooLong = computed(() => this.phone().length > 25);

  constructor() {
    this.phone.set(this.auth.phone());
  }

  onPhoneInput(value: string): void {
    this.phone.set(value);
    this.notice.set('');
    this.error.set('');
  }

  async savePhone(): Promise<void> {
    if (this.saving() || this.phoneTooLong()) return;
    this.clearFeedback();
    this.saving.set(true);
    const res = await this.auth.updatePhone(this.phone());
    this.saving.set(false);
    if (res.ok) {
      this.notice.set(res.message);
    } else {
      this.error.set(res.message);
    }
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file later
    if (!file) return;
    this.clearFeedback();
    this.uploading.set(true);
    const res = await this.auth.uploadAvatar(file);
    this.uploading.set(false);
    if (res.ok) {
      this.notice.set(res.message);
    } else {
      this.error.set(res.message);
    }
  }

  async removePhoto(event: Event): Promise<void> {
    event.stopPropagation(); // sits on top of the "pick a photo" button
    if (this.uploading()) return;
    this.clearFeedback();
    this.uploading.set(true);
    const res = await this.auth.removeAvatar();
    this.uploading.set(false);
    if (res.ok) {
      this.notice.set(res.message);
    } else {
      this.error.set(res.message);
    }
  }

  private clearFeedback(): void {
    this.notice.set('');
    this.error.set('');
  }
}
