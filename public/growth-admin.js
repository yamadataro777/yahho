const $ = id => document.getElementById(id);
const value = id => $(id).value.trim();
const prose = id => value(id).replace(/\s+/g, ' ');
const number = value => new Intl.NumberFormat('ja-JP').format(Number(value) || 0);
const percent = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP') : '未記録';
const sourceNames = { threads: 'Threads', search: '検索', direct: '直接・不明', social: 'SNS', email: 'メール', referral: '参照サイト', other: 'その他' };
const evidenceNames = { customer_quote: '読者の悩み', search_console: '検索の実績', suggestion: '検索候補', competitor: '競合の観測', official_page: '公式情報' };
const stateNames = { proposed: '提案', applied: '変更済み・観測中', dismissed: '見送り', evaluated: '結果を記録済み' };
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element; };
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const iso = input => { const d = new Date(input); if (!Number.isFinite(d.getTime())) throw new Error('観測日時を確認してください。'); return d.toISOString(); };
const todayLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

function safeLink(url, label) {
  try {
    const parsed = new URL(url, location.origin);
    if ((parsed.protocol !== 'https:' && parsed.origin !== location.origin) || parsed.username || parsed.password) return node('span', label);
    const a = node('a', label); a.href = parsed.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  } catch { return node('span', label); }
}
function detail(label, text) { const p = node('p', undefined, 'micro'); p.append(node('strong', `${label}：`), document.createTextNode(String(text))); return p; }
function options(selectId, items, selected) {
  const select = $(selectId); const current = selected ?? select.value;
  select.replaceChildren(new Option(items.length ? '選択してください' : '先に対象を登録してください', ''));
  for (const [id, label] of items) select.append(new Option(label, id));
  if (items.some(item => item[0] === current)) select.value = current;
}
function table(headers, rows, label) {
  if (!rows.length) return node('p', 'まだ観測データがありません。公開した計測リンクからの流入や、サイト内の行動が記録されると表示します。', 'micro');
  const wrap = node('div', undefined, 'growth-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label);
  const t = node('table', undefined, 'growth-table'); const head = node('thead'); const hr = node('tr');
  for (const title of headers) { const th = node('th', title); th.scope = 'col'; hr.append(th); } head.append(hr); t.append(head);
  const body = node('tbody');
  for (const values of rows) { const tr = node('tr'); for (const text of values) tr.append(node('td', text)); body.append(tr); }
  t.append(body); wrap.append(t); return wrap;
}

export function initGrowthAdmin({ api, refresh, message }) {
  let hypotheses = [];
  let campaigns = [];
  let generation = 0;
  const notify = (text, error = false) => message('growth-message', text, error);
  const run = async (task, success) => {
    const current = generation;
    try { await task(); if (current !== generation) return; await refresh(); if (current === generation) notify(success); }
    catch (error) { if (current === generation) notify(error.message || '処理に失敗しました。', true); }
  };
  function bind(form, endpoint, body, success) {
    $(form).addEventListener('submit', event => {
      event.preventDefault();
      run(async () => { const input = body(); await api(endpoint, 'POST', input); $(form).reset(); setDates(); toggleEvidenceMetrics(); }, success);
    });
  }
  function setDates() {
    if (!$('growth-evidence-date').value) $('growth-evidence-date').value = todayLocal();
  }
  function toggleEvidenceMetrics() {
    const enabled = value('growth-evidence-kind') === 'search_console';
    $('growth-evidence-metrics').hidden = !enabled;
    for (const suffix of ['query', 'start', 'end', 'impressions', 'clicks']) $('growth-evidence-' + suffix).required = enabled;
  }
  bind('growth-hypothesis-form', '/api/admin/growth/hypotheses', () => ({ id: id('hyp'), category: value('growth-category'), audience: value('growth-audience'), pain: prose('growth-pain'), query: value('growth-query'), targetPath: value('growth-target') }), '仮説を保存しました。次に、その仮説を支える根拠を記録してください。');
  bind('growth-evidence-form', '/api/admin/growth/evidence', () => ({ id: id('ev'), hypothesisId: value('growth-evidence-hypothesis'), kind: value('growth-evidence-kind'), sourceUrl: value('growth-evidence-url'), observedAt: iso(value('growth-evidence-date')), summary: prose('growth-evidence-summary'), ...(value('growth-evidence-kind') === 'search_console' ? { query: value('growth-evidence-query'), metrics: { impressions: Number(value('growth-evidence-impressions')), clicks: Number(value('growth-evidence-clicks')) }, periodStart: value('growth-evidence-start'), periodEnd: value('growth-evidence-end') } : {}) }), '根拠を記録しました。観測した事実と需要の判断は分けて確認してください。');
  bind('growth-campaign-form', '/api/admin/growth/campaigns', () => {
    const hypothesis = hypotheses.find(h => h.id === value('growth-campaign-hypothesis'));
    if (!hypothesis) throw new Error('対象の仮説を選択してください。');
    return { id: id('camp'), name: value('growth-campaign-name'), source: value('growth-campaign-source'), hypothesisId: hypothesis.id, targetPath: hypothesis.targetPath };
  }, '計測リンクを作成しました。掲載先で使用すると、その施策からの流入を確認できます。');
  bind('growth-observation-form', '/api/admin/growth/observations', () => ({ id: id('obs'), campaignId: value('growth-observation-campaign'), periodStart: value('growth-observation-start'), periodEnd: value('growth-observation-end'), impressions: Number(value('growth-observation-impressions')), clicks: Number(value('growth-observation-clicks')), sourceUrl: value('growth-observation-url'), observedAt: new Date().toISOString() }), '掲載先の実績を記録しました。サイト側の流入計測とは別の観測値です。');
  $('growth-evidence-kind').addEventListener('change', toggleEvidenceMetrics);
  $('growth-evaluate').addEventListener('click', () => run(() => api('/api/admin/growth/evaluate', 'POST', {}), '最新の根拠と計測値で改善案を更新しました。'));

  function actionButton(label, action, className = 'button cream') { const b = node('button', label, className); b.type = 'button'; b.addEventListener('click', action); return b; }
  function renderHypotheses(data) {
    const target = $('growth-hypotheses'); target.replaceChildren();
    for (const h of data) {
      const row = node('article', undefined, 'growth-record');
      row.append(node('h3', h.query), detail('読者', h.audience), detail('困りごと', h.pain), detail('対象ページ', h.targetPath), detail('状態', h.status === 'active' ? '検証中' : '保留'));
      row.append(actionButton(h.status === 'active' ? '検証を保留する' : '検証を再開する', () => run(() => api('/api/admin/growth/hypotheses', 'PATCH', { id: h.id, status: h.status === 'active' ? 'paused' : 'active' }), '仮説の検証状態を更新しました。'), 'text-button'));
      target.append(row);
    }
    if (!data.length) target.append(node('p', 'まだ仮説はありません。対象読者と解決したい仕事を一つ決めるところから始めます。', 'micro'));
  }
  function renderEvidence(data) {
    const target = $('growth-evidence'); target.replaceChildren();
    for (const item of data) {
      const h = hypotheses.find(h => h.id === item.hypothesisId);
      const row = node('article', undefined, 'growth-record');
      row.append(node('h3', `${evidenceNames[item.kind] || item.kind} · ${h?.query || item.hypothesisId}`), node('p', item.summary), detail('観測', `${time(item.observedAt)} ／ ${item.fresh ? '90日以内の記録' : '更新が必要な記録'}`), safeLink(item.sourceUrl, '根拠の確認先 ↗'));
      if (item.metrics) row.append(detail('検索語', item.query || '記録なし'), detail('観測値', `${item.periodStart}〜${item.periodEnd} ／ 表示 ${number(item.metrics.impressions)}回・クリック ${number(item.metrics.clicks)}回`));
      target.append(row);
    }
    if (!data.length) target.append(node('p', '需要の根拠は未登録です。候補や仮説を、確認済みの事実として扱いません。', 'micro'));
  }
  function renderCampaigns(data) {
    const target = $('growth-campaigns'); target.replaceChildren();
    for (const campaign of data) {
      const row = node('article', undefined, 'growth-record');
      row.append(node('h3', campaign.name), detail('掲載先', `${sourceNames[campaign.source] || campaign.source} ／ ${campaign.status === 'active' ? '計測中' : '停止中'}`));
      const url = typeof campaign.url === 'string' ? campaign.url : `${campaign.targetPath}?campaign=${encodeURIComponent(campaign.id)}`;
      const field = node('input'); field.readOnly = true; field.value = url; field.setAttribute('aria-label', `${campaign.name}の計測リンク`); field.addEventListener('focus', () => field.select()); row.append(field);
      row.append(actionButton('リンクをコピー', async () => {
        try { await navigator.clipboard.writeText(url); notify('計測リンクをコピーしました。'); }
        catch { field.focus(); field.select(); notify('リンクを選択しました。端末のコピー操作を使ってください。'); }
      }));
      row.append(actionButton(campaign.status === 'active' ? 'この施策を停止する' : 'この施策を再開する', () => run(() => api('/api/admin/growth/campaigns', 'PATCH', { id: campaign.id, status: campaign.status === 'active' ? 'paused' : 'active' }), '施策の状態を更新しました。'), 'text-button'));
      if (url.startsWith('/')) row.append(node('p', '公開 URL が未設定のため相対リンクを表示しています。公開後はサイトの URL と合わせて使用してください。', 'micro'));
      target.append(row);
    }
    if (!data.length) target.append(node('p', '計測リンクはまだありません。仮説ごとに投稿や施策を分けると、どこから流入したかを比較できます。', 'micro'));
  }
  function renderObservations(data) {
    const target = $('growth-observations'); target.replaceChildren();
    for (const o of data) {
      const row = node('article', undefined, 'growth-record');
      row.append(node('h3', campaigns.find(c => c.id === o.campaignId)?.name || o.campaignId), detail('期間', `${o.periodStart}〜${o.periodEnd}`), detail('掲載先の観測', `表示 ${number(o.impressions)}回 ／ クリック ${number(o.clicks)}回`), safeLink(o.sourceUrl, '実績の確認先 ↗'));
      target.append(row);
    }
  }
  function renderAnalytics(data) {
    $('growth-window').textContent = `対象期間：${time(data.window.start)}〜${time(data.window.end)}。成約率の対象クリック：${time(data.window.matureBefore)}以前。`;
    const metrics = $('growth-metrics'); metrics.replaceChildren();
    const t = data.totals;
    for (const [label, v] of [['訪問', t.visits], ['ページ閲覧', t.pageViews], ['診断完了', t.diagnoses], ['広告クリック', t.clicks], ['確定成果', t.confirmedConversions], ['確定報酬（円）', t.confirmedRevenueJpy], ['流入不明の成果', t.unattributedConversions]]) {
      const card = node('div', undefined, 'metric'); card.append(node('span', label), node('b', number(v))); metrics.append(card);
    }
    const campaignName = id => campaigns.find(c => c.id === id)?.name || id || '施策指定なし';
    $('growth-analytics').replaceChildren(table(['ページ / 掲載元', '訪問', '診断', 'クリック', '照合対象クリック', 'クリック率', '7日経過の照合対象', '成約したクリック', '成約率', '確定報酬（円）'], data.rows.map(row => [row.pagePath + '\n' + (sourceNames[row.source] || row.source) + ' / ' + campaignName(row.campaignId), number(row.visits), number(row.diagnoses), number(row.clicks), number(row.attributableClicks), percent(row.ctr), number(row.matureAttributableClicks), number(row.convertedClicks), percent(row.conversionRate), number(row.confirmedRevenueJpy)]), 'ページ別の流入と成約'));
    const rows = data.campaignRows || [];
    $('growth-campaign-analytics').replaceChildren(table(['掲載元 / 施策', '訪問', '診断', 'クリック', '7日経過の照合対象', '成約したクリック', '成約率'], rows.map(row => [(sourceNames[row.source] || row.source) + ' / ' + campaignName(row.campaignId), number(row.visits), number(row.diagnoses), number(row.clicks), number(row.matureAttributableClicks), number(row.convertedClicks), percent(row.conversionRate)]), '流入元と施策別の結果'));
    const target = $('growth-conversions'); target.replaceChildren();
    for (const conversion of data.recentConversions || []) {
      const row = node('article', undefined, 'growth-record');
      row.append(node('h3', `${conversion.offerId} · ${number(conversion.commissionJpy)}円 · ${conversion.status === 'reversed' ? '取消済み' : '確定'}`), detail('成果 ID', conversion.externalId), detail('発生', time(conversion.occurredAt)), detail('流入の照合', conversion.clickId ? `${conversion.pagePath || 'ページ未記録'} ／ ${sourceNames[conversion.source] || conversion.source || '不明'} ／ ${campaignName(conversion.campaignId)}` : '流入不明（クリックとの紐づけなし）'));
      if (conversion.status !== 'reversed') {
        const form = node('form', undefined, 'growth-reversal'); const label = node('label'); const checked = node('input'); checked.type = 'checkbox'; checked.required = true; label.append(checked, document.createTextNode(' ASP でこの成果が取り消されたことを確認した'));
        const button = node('button', '取消を記録', 'button cream'); button.type = 'submit'; form.append(label, button);
        form.addEventListener('submit', event => { event.preventDefault(); run(() => api('/api/admin/conversions/reverse', 'POST', { externalId: conversion.externalId }), '成果の取消を記録しました。集計から除外しています。'); }); row.append(form);
      }
      target.append(row);
    }
    if (!data.recentConversions?.length) target.append(node('p', '確定成果はまだ取り込まれていません。報酬や成約を推測では補いません。', 'micro'));
  }
  function renderDecisions(data, thresholds) {
    const target = $('growth-decisions'); target.replaceChildren();
    for (const d of data) {
      const row = node('article', undefined, 'growth-record');
      row.append(node('h3', `${d.title} · ${stateNames[d.status] || d.status}`), node('p', d.reason), detail('次の行動', d.action), detail('対象', hypotheses.find(h => h.id === d.hypothesisId)?.query || d.hypothesisId || 'サイト全体'), detail('作成', time(d.createdAt)));
      const evidence = node('details', undefined, 'growth-inner'); evidence.append(node('summary', '判断に使った観測値'));
      const metrics = d.baseline || {};
      evidence.append(detail('訪問 / 広告クリック', `${number(metrics.visits)} / ${number(metrics.clicks)}`), detail('照合できるクリック / うち7日経過', `${number(metrics.attributableClicks)} / ${number(metrics.matureAttributableClicks)}`), detail('成約したクリック / 確定報酬', `${number(metrics.convertedClicks)} / ${number(metrics.confirmedRevenueJpy)}円`), detail('最近の需要記録', d.snapshot?.evidenceStatus === 'recent_observation_not_proof' ? '観測記録あり（需要や成約を保証しません）' : '判断材料が不足しています'));
      evidence.append(detail('7日経過した照合対象の訪問 / 成約のある訪問', `${number(metrics.matureAttributableVisits)} / ${number(metrics.convertedVisits)}`));
      if (d.snapshot?.evidenceIds?.length) evidence.append(detail('参照した根拠', `${number(d.snapshot.evidenceIds.length)}件`));
      row.append(evidence);
      if (d.note) row.append(detail('記録した変更・判断', d.note));
      if (d.outcome) {
        const results = node('details', undefined, 'growth-inner'); results.open = true;
        const outcomeNames = { criterion_met: '確認条件を満たした', insufficient_data: '判断に必要な件数が不足', improved: '観測した率が上昇', declined: '観測した率が低下', unchanged: '観測した率は変化なし' };
        results.append(node('summary', '変更後の観測結果'), detail('結果', outcomeNames[d.outcome.status] || d.outcome.status), detail('観測日時', time(d.outcome.measuredAt)), detail('変更前 → 変更後', `${percent(d.outcome.beforeRate)} → ${percent(d.outcome.afterRate)}`));
        if (d.outcome.after) results.append(detail('変更後の件数', `訪問 ${number(d.outcome.after.visits)} ／ クリック ${number(d.outcome.after.clicks)} ／ 7日経過した照合対象クリック ${number(d.outcome.after.matureAttributableClicks)} ／ 対象訪問 ${number(d.outcome.after.matureAttributableVisits)} ／ 成約したクリック ${number(d.outcome.after.convertedClicks)} ／ 成約のある訪問 ${number(d.outcome.after.convertedVisits)}`));
        results.append(node('p', d.outcome.note, 'micro')); row.append(results);
      }
      if (d.status === 'proposed' || d.status === 'applied') {
        const form = node('form', undefined, 'growth-decision-form');
        const label = node('label', d.status === 'proposed' ? '実際に変えた内容、または見送る理由' : '変更後に確認したこと');
        const note = node('textarea'); note.required = true; note.minLength = 5; note.maxLength = 1000; note.id = 'note-' + d.id; label.htmlFor = note.id; form.append(label, note);
        if (d.status === 'proposed') {
          const selectLabel = node('label', '記録する状態'); const select = node('select'); select.id = 'status-' + d.id; selectLabel.htmlFor = select.id; select.append(new Option('変更を実施した', 'applied'), new Option('今回は見送る', 'dismissed')); form.append(selectLabel, select);
          form.addEventListener('submit', event => { event.preventDefault(); run(() => api('/api/admin/growth/decisions', 'PATCH', { id: d.id, status: select.value, note: note.value.trim().replace(/\s+/g, ' ') }), '改善の実施状況を記録しました。'); });
        } else {
          form.append(node('p', `変更後 ${thresholds?.observationDays || 7}日以上の観測期間を置いてから評価できます。まだ期間や件数が足りない場合は結論を出しません。`, 'micro'));
          form.addEventListener('submit', event => { event.preventDefault(); run(() => api('/api/admin/growth/decisions', 'PATCH', { id: d.id, status: 'evaluated', note: note.value.trim().replace(/\s+/g, ' ') }), '変更後の観測結果を記録しました。'); });
        }
        const button = node('button', d.status === 'applied' ? '変更後の結果を評価する' : '判断を記録する', 'button cream'); button.type = 'submit'; form.append(button); row.append(form);
      }
      target.append(row);
    }
    if (!data.length) target.append(node('p', '改善案はまだありません。仮説と根拠を登録して「最新データで改善案を作る」を実行してください。データが少ない場合は、次に集める根拠を提案します。', 'micro'));
  }
  setDates(); toggleEvidenceMetrics();
  return {
    render(growth, analytics) {
      hypotheses = growth.hypotheses || []; campaigns = growth.campaigns || [];
      const active = hypotheses.filter(h => h.status === 'active').map(h => [h.id, h.query]);
      options('growth-evidence-hypothesis', hypotheses.map(h => [h.id, h.query])); options('growth-campaign-hypothesis', active); options('growth-observation-campaign', campaigns.map(c => [c.id, c.name]));
      renderHypotheses(hypotheses); renderEvidence(growth.evidence || []); renderCampaigns(campaigns); renderObservations(growth.observations || []); renderAnalytics(analytics); renderDecisions(growth.decisions || [], growth.thresholds);
    },
    clear() {
      generation++; hypotheses = []; campaigns = [];
      for (const part of ['hypotheses', 'evidence', 'campaigns', 'observations', 'analytics', 'campaign-analytics', 'conversions', 'decisions', 'metrics']) $('growth-' + part).replaceChildren();
      for (const part of ['hypothesis', 'evidence', 'campaign', 'observation']) $('growth-' + part + '-form').reset();
      $('growth-window').textContent = ''; $('growth-message').textContent = ''; setDates(); toggleEvidenceMetrics();
    },
  };
}
