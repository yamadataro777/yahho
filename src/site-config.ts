import type { Env } from './types';

type PublicSettings = Pick<Env, 'OPERATOR_NAME' | 'CONTACT_EMAIL' | 'PUBLIC_CONTACT_URL' | 'GOOGLE_SITE_VERIFICATION'>;

function publicHostname(host: string): boolean {
  return host.length <= 253 && host.includes('.')
    && /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
    && host.split('.').every(label => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'))
    && !/^[\d.]+$/.test(host)
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)
    && !/(?:^|\.)example\.(?:com|net|org)$/.test(host);
}

export function publicSiteOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && url.pathname === '/' && !url.search && !url.hash && publicHostname(url.hostname)
      ? url.origin : null;
  } catch { return null; }
}

/** These are public display values, never credentials or defaults invented by the site. */
export function operatorProfile(env: PublicSettings): { name: string | null; email: string | null; contactUrl: string | null } {
  const rawName = env.OPERATOR_NAME;
  const name = typeof rawName === 'string' && !/[\u0000-\u001f\u007f<>]/.test(rawName)
    && [...rawName.trim()].length > 0 && [...rawName.trim()].length <= 100 ? rawName.trim() : null;

  const rawEmail = env.CONTACT_EMAIL;
  let email: string | null = null;
  if (typeof rawEmail === 'string' && rawEmail.length <= 254 && !/\s/.test(rawEmail)) {
    // A deliberate common mailbox subset: no mailto query delimiters, percent escapes,
    // display names or control characters that could introduce email headers.
    const match = /^([A-Za-z0-9._+-]{1,64})@([A-Za-z0-9.-]+)$/.exec(rawEmail);
    if (match && !match[1].startsWith('.') && !match[1].endsWith('.') && !match[1].includes('..') && publicHostname(match[2].toLowerCase())) {
      email = `${match[1]}@${match[2].toLowerCase()}`;
    }
  }

  let contactUrl: string | null = null;
  const rawUrl = env.PUBLIC_CONTACT_URL;
  if (typeof rawUrl === 'string' && rawUrl.length <= 2048 && !/[\s\u0000-\u001f\u007f]/.test(rawUrl)) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port && publicHostname(url.hostname)) contactUrl = url.href;
    } catch { /* Invalid optional settings are not displayed publicly. */ }
  }
  return { name, email, contactUrl };
}

export function googleSiteVerification(env: PublicSettings): string | null {
  const token = env.GOOGLE_SITE_VERIFICATION;
  return typeof token === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(token) ? token : null;
}
