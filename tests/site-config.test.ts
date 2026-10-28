import { describe, expect, it } from 'vitest';
import { googleSiteVerification, operatorProfile } from '../src/site-config';

describe('public operator settings', () => {
  it('does not invent an operator or contact when no owner values were supplied', () => {
    expect(operatorProfile({})).toEqual({ name: null, email: null, contactUrl: null });
  });
  it('keeps valid public names and normalizes email domains', () => {
    expect(operatorProfile({ OPERATOR_NAME: '  しごと道具 編集部  ', CONTACT_EMAIL: 'Support+site@SHIGOTO-DOUGU.JP' }))
      .toEqual({ name: 'しごと道具 編集部', email: 'Support+site@shigoto-dougu.jp', contactUrl: null });
  });
  it('rejects header injection, mailto query strings, private and placeholder mailboxes', () => {
    for (const email of ['help@shigoto-dougu.jp\r\nBcc: hidden@attacker.jp', 'help@shigoto-dougu.jp?subject=oops',
      'mailto:help@shigoto-dougu.jp', 'Name <help@shigoto-dougu.jp>', 'help%0aBcc@shigoto-dougu.jp',
      '.help@shigoto-dougu.jp', 'help..desk@shigoto-dougu.jp', 'help@example.com', 'help@localhost', 'help@intranet.local']) {
      expect(operatorProfile({ CONTACT_EMAIL: email }).email, email).toBeNull();
    }
  });
  it('rejects empty, overlong, control-character and markup operator names', () => {
    for (const name of ['', '  ', 'a'.repeat(101), '<script>alert(1)</script>', 'Company\nContact']) expect(operatorProfile({ OPERATOR_NAME: name }).name).toBeNull();
  });
  it('allows only public HTTPS contact forms and never turns credentials into visible links', () => {
    expect(operatorProfile({ PUBLIC_CONTACT_URL: 'https://www.notion.com/contact-us?from=site#contact' }).contactUrl).toBe('https://www.notion.com/contact-us?from=site#contact');
    for (const url of ['javascript:alert(1)', 'http://www.notion.com/contact', 'https://user:password@www.notion.com/help',
      'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://intranet.internal/',
      'https://example.com/contact', 'https://www.notion.com:8443/help', 'https://www.notion.com/\ncontact']) {
      expect(operatorProfile({ PUBLIC_CONTACT_URL: url }).contactUrl, url).toBeNull();
    }
  });
});

describe('Search Console token', () => {
  it('accepts only the token, not markup or other attributes', () => {
    expect(googleSiteVerification({ GOOGLE_SITE_VERIFICATION: 'valid-token_123456789' })).toBe('valid-token_123456789');
    for (const token of ['', 'short', '<meta name="google-site-verification">', 'token" onload="alert(1)', 'a'.repeat(257)]) expect(googleSiteVerification({ GOOGLE_SITE_VERIFICATION: token })).toBeNull();
  });
});
