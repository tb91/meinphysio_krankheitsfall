import type { ContactChannel } from './api';

const TZ = 'Europe/Berlin';

export function time(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function dayTime(iso: string): string {
  const d = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).format(
    new Date(iso),
  );
  return `${d}, ${time(iso)} Uhr`;
}

export function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${isoDate}T12:00:00Z`),
  );
}

export function germanDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

export function untilLabel(minutes: number): string {
  if (minutes < 0) return `seit ${-minutes} Min.`;
  if (minutes < 60) return `in ${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `in ${h} h ${m} Min.` : `in ${h} h`;
}

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  phone: 'Anruf',
  sms: 'SMS',
  email: 'E-Mail',
};

export function shortLocation(name: string): string {
  return name.replace('meinphysio+ ', '');
}
