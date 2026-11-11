import { dayKey, fmtDay } from './farm-data.service';

/** 'Just now' / '3m ago' / '2d ago' / 'Nov 7' — friendly relative time. */
export function ago(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDay(dayKey(new Date(at)));
}

/** 'UGX 1.2M' / 'UGX 450k' / 'UGX 450' — compact money for stat cards. */
export function fmtCompact(amount: number): string {
  if (amount >= 1_000_000) return `UGX ${Math.round((amount / 1_000_000) * 10) / 10}M`;
  if (amount >= 1_000) return `UGX ${Math.round(amount / 1_000)}k`;
  return `UGX ${Math.round(amount)}`;
}
