import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { FarmApiService } from '../../../core/farm-api.service';
import { fmtDay } from '../../../core/farm-data.service';
import { Department } from '../../../core/models';

interface EntryField {
  value: string;
  label: string;
  icon: string;
  options: string[];
}

/**
 * Worker data entry — record the specifics of today's work in the
 * system. Field labels and options adapt to the worker's department
 * (crop activities & plots vs. livestock activities & units). Entries
 * land in the department feed the owner and supervisor can see
 * (POST /api/entries — the department is taken from the session).
 */
@Component({
  selector: 'app-worker-data-entry',
  imports: [ReactiveFormsModule],
  templateUrl: './worker-data-entry.html',
})
export class WorkerDataEntry {
  private readonly auth = inject(AuthService);
  private readonly api = inject(FarmApiService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;
  readonly isCrops = this.dept === 'crops';

  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');
  readonly submitting = signal(false);

  /** Department entries — the newest ones (including yours) on top. */
  readonly recent = computed(() => this.api.entries().slice(0, 8));
  readonly loading = this.api.entriesLoading;
  readonly loadError = this.api.entriesError;

  /** Activity options differ per department. */
  readonly activityField: EntryField = this.isCrops
    ? {
        value: 'activity',
        label: 'Activity',
        icon: 'fa-solid fa-seedling',
        options: [
          'Planting',
          'Weeding',
          'Harvesting',
          'Fertilizer application',
          'Pest control',
          'Irrigation',
        ],
      }
    : {
        value: 'activity',
        label: 'Activity',
        icon: 'fa-solid fa-cow',
        options: ['Counting', 'Feeding', 'Health check', 'Vaccination', 'Cleaning', 'Purchase / Sale'],
      };

  /** Where the work happened: field/plot vs. pen/unit. */
  readonly placeField: EntryField = this.isCrops
    ? {
        value: 'place',
        label: 'Field / Plot',
        icon: 'fa-solid fa-map',
        options: ['Field A', 'Field B', 'Field C', 'Plot C', 'Greenhouse'],
      }
    : {
        value: 'place',
        label: 'Pen / Unit',
        icon: 'fa-solid fa-warehouse',
        options: ['Poultry A', 'Poultry B', 'Dairy unit', 'Goat house', 'Feed store'],
      };

  /** Crop vs. animal subject. */
  readonly subjectField: EntryField = this.isCrops
    ? {
        value: 'subject',
        label: 'Crop',
        icon: 'fa-solid fa-leaf',
        options: ['Maize', 'Wheat', 'Rice', 'Tomato', 'Soybean', 'Cotton'],
      }
    : {
        value: 'subject',
        label: 'Animal type',
        icon: 'fa-solid fa-paw',
        options: ['Cattle', 'Poultry', 'Goats', 'Sheep', 'Pigs'],
      };

  readonly form = new FormGroup({
    activity: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    place: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    subject: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    measure: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    notes: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    void this.api.ensure('entries');
  }

  retry(): void {
    void this.api.ensure('entries');
  }

  invalid(
    control: 'activity' | 'place' | 'subject' | 'measure',
  ): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Fill in the activity, location, subject and measure.');
      return;
    }
    if (this.submitting()) return;

    this.submitting.set(true);
    try {
      const { activity, place, subject, measure, notes } = this.form.getRawValue();
      const res = await this.api.addEntry({
        activity,
        place,
        subject,
        measure,
        notes: notes.trim(),
      });

      if (!res.ok) {
        this.error.set(res.message);
        return;
      }

      this.form.reset({ activity: '', place: '', subject: '', measure: '', notes: '' });
      this.error.set('');
      this.notice.set(`${activity} entry recorded — thank you.`);
    } finally {
      this.submitting.set(false);
    }
  }
}
