(() => {
  const sessionKey = 'shigoto-visit-v1';
  const preferenceKey = 'shigoto-measurement-off';
  let visit = null;
  let initializing = null;
  const path = location.pathname.replace(/\/$/, '') || '/';
  const eligible = path === '/' || /^\/(tools|guides|compare)(\/[^/]+)?$/.test(path) || path === '/diagnosis';
  function enabled() {
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return false;
    try { return localStorage.getItem(preferenceKey) !== '1'; } catch { return false; }
  }
  function clearVisit() {
    visit = null;
    try { sessionStorage.removeItem(sessionKey); } catch { /* Storage can be disabled. */ }
  }
  async function send(endpoint, body) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }
  function source() {
    try {
      if (!document.referrer) return 'direct';
      const host = new URL(document.referrer).hostname;
      if (host === location.hostname) return 'direct';
      if (/^(www\.)?(google\.(com|co\.jp)|bing\.com|search\.yahoo\.co\.jp|duckduckgo\.com)$/.test(host)) return 'search';
      if (/(^|\.)threads\.(net|com)$/.test(host)) return 'threads';
      if (/(^|\.)(instagram\.com|facebook\.com|x\.com|t\.co)$/.test(host)) return 'social';
      return 'referral';
    } catch { return 'direct'; }
  }
  async function initialize() {
    if (!enabled() || !eligible) return null;
    if (visit && Date.parse(visit.expiresAt) > Date.now()) return visit;
    if (initializing) return initializing;
    initializing = (async () => {
      let stored;
      try { stored = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch { stored = null; }
      const rawCampaign = new URLSearchParams(location.search).get('campaign');
      const campaign = rawCampaign && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(rawCampaign) ? rawCampaign : undefined;
      const reusable = stored && Date.parse(stored.expiresAt) > Date.now() && (!campaign || stored.campaign === campaign);
      const data = await send('/api/analytics/visit', { path, source: source(), campaign, ...(reusable ? { visitId: stored.visitId } : {}) });
      if (!enabled() || !data.visitId) return null;
      visit = { visitId: data.visitId, expiresAt: data.expiresAt, campaign: campaign || (reusable ? stored.campaign : undefined) };
      try { sessionStorage.setItem(sessionKey, JSON.stringify(visit)); } catch { /* In-memory visit only. */ }
      return visit;
    })().catch(() => null).finally(() => { initializing = null; });
    return initializing;
  }
  async function event(kind, fields = {}) {
    if (!enabled() || !eligible) return null;
    const current = await initialize();
    if (!current || !enabled()) return null;
    try {
      return await send('/api/analytics/event', { visitId: current.visitId, eventId: crypto.randomUUID(), kind, path, ...fields });
    } catch { return null; }
  }
  window.shigotoMetrics = { enabled, diagnosis: category => event('diagnosis', { category }) };
  if (eligible && enabled()) void event('page_view');

  document.addEventListener('click', ev => {
    const link = ev.target instanceof Element ? ev.target.closest('a[data-offer]') : null;
    if (!link || !enabled() || ev.defaultPrevented) return;
    const intercept = link.dataset.clickTracking === 'true' && ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;
    if (!intercept) { void event('affiliate_click', { offerId: link.dataset.offer, attributionRequested: false }); return; }
    ev.preventDefault();
    // Open during the user gesture; the destination still works if measurement fails.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    const original = link.href;
    void event('affiliate_click', { offerId: link.dataset.offer, attributionRequested: true }).then(result => {
      let destination = original;
      try {
        const candidate = new URL(result?.url);
        if (candidate.protocol === 'https:' && candidate.hostname === new URL(original).hostname) destination = candidate.href;
      } catch { /* Preserve the original approved link on failure. */ }
      if (popup && !popup.closed) popup.location.replace(destination);
      else location.assign(destination);
    });
  });
  const toggle = document.getElementById('measurement-toggle');
  const status = document.getElementById('measurement-status');
  function renderPreference() {
    if (!toggle || !status) return;
    const browserOptOut = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
    toggle.disabled = browserOptOut;
    toggle.textContent = enabled() ? 'このブラウザの計測を停止する' : 'このブラウザの計測を再開する';
    status.textContent = browserOptOut ? 'ブラウザのプライバシー設定に従い、計測を停止しています。' : enabled() ? '匿名の利用状況の計測は有効です。' : 'このブラウザの利用状況は計測しません。';
  }
  toggle?.addEventListener('click', () => {
    try { localStorage.setItem(preferenceKey, enabled() ? '1' : '0'); } catch { if (status) status.textContent = '設定を保存できません。ブラウザの追跡拒否設定をご利用ください。'; return; }
    clearVisit(); renderPreference();
  });
  renderPreference();
})();
