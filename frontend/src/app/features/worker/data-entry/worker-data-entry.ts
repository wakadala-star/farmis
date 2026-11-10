import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import {
  FarmDataService,
  fmtDay,
} from '../../../core/farm-data.service';
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
 * land in the department feed the owner and supervisor can see.
 */
@Component({
  selector: 'app-worker-data-entry',
  imports: [ReactiveFormsModule],
  templateUrl: './worker-data-entry.html',
})
export class WorkerDataEntry {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;
  readonly worker = this.auth.fullName();
  readonly isCrops = this.dept === 'crops';

  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');

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

  /** Department entries — the newest ones (including yours) on top. */
  readonly recent = computed(() => this.data.entriesOf(this.dept).slice(0, 8));

  invalid(
    control: 'activity' | 'place' | 'subject' | 'measure',
  ): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Fill in the activity, location, subject and measure.');
      return;
    }

    const { activity, place, subject, measure, notes } = this.form.getRawValue();
    this.data.addEntry({
      worker: this.worker,
      dept: this.dept,
      activity,
      place,
      subject,
      measure,
      notes: notes.trim(),
    });
    this.form.reset({ activity: '', place: '', subject: '', measure: '', notes: '' });
    this.error.set('');
    this.notice.set(`${activity} entry recorded — thank you.`);
  }
}
