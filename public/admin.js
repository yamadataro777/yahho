import { initGrowthAdmin } from './growth-admin.js';
const $ = id => document.getElementById(id);
let adminToken = '';
let offers = [];
let activeRequests = 0;
let session = 0;
const pendingRequests = new Set();
const number = value => new Intl.NumberFormat('ja-JP').format(Number(value) || 0);
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP') : '未確認';
const growthAdmin = initGrowthAdmin({ api, refresh: () => refresh(), message });
const statusNames = { completed: '完了', partial: '一部保留', failed: '失敗', running: '実行中', duplicate: '本日の処理は実行済み' };

function message(id, value, error = false) {
  const target = $(id);
  target.textContent = value;
  target.classList.toggle('error', error);
}

function busy(on) {
  activeRequests = Math.max(0, activeRequests + (on ? 1 : -1));
  document.querySelectorAll('#admin-login button, #admin-private button').forEach(button => { if (button.id !== 'admin-logout') button.disabled = activeRequests > 0; });
}

async function api(path, method = 'GET', body) {
  const controller = new AbortController();
  pendingRequests.add(controller);
  busy(true);
  try {
    const response = await fetch(path, {
      method, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${adminToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('サーバーからの応答を読み取れませんでした。時間をおいて再度お試しください。'); }
    if (!response.ok) {
      const explanation = {
        unauthorized: '認証できませんでした。管理用トークンを確認してください。',
        not_configured: 'Cloudflare に管理用トークンが設定されていません。32文字以上の ADMIN_TOKEN を設定してください。',
        storage_unavailable: 'データベースを読み書きできません。D1 の接続とマイグレーションを確認してください。',
        idempotency_conflict: 'この成果 ID は異なる内容ですでに登録されています。ASP の記録と照合してください。',
        offer_not_found: '対象の広告が見つかりません。広告を先に登録してください。',
      }[data.error];
      throw new Error(explanation || data.message || `処理に失敗しました（${response.status}）。`);
    }
    return data;
  } finally { pendingRequests.delete(controller); busy(false); }
}

function line(label, detail) {
  const p = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = label;
  p.append(strong, document.createTextNode(` — ${detail}`));
  p.className = 'micro';
  return p;
}

function renderStatus(data) {
  $('metric-diagnoses').textContent = number(data.metrics.diagnoses);
  $('metric-clicks').textContent = number(data.metrics.affiliateClicks);
  $('metric-conversions').textContent = number(data.metrics.confirmedConversions);
  $('metric-revenue').textContent = number(data.metrics.confirmedRevenueJpy);
  $('automation-state').textContent = `${data.automation.enabled ? '自動公開：有効' : '自動公開：無効（AI接続時は下書き生成）'} ／ 1日の公開上限：${number(data.automation.maxDailyArticles)}記事`;
  offers = data.offers;
  $('offers-list').replaceChildren();
  $('conversion-offer').replaceChildren(new Option(offers.length ? '選択してください' : '広告を登録してください', ''));
  for (const offer of offers) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'text-button';
    const expired = offer.expiresAt && Date.parse(offer.expiresAt) <= Date.now();
    button.textContent = `${offer.name} · ${offer.enabled && !expired ? '有効' : expired ? '期限切れ' : '停止中'} → 編集`;
    button.addEventListener('click', () => {
      if (![...$('offer-id').options].some(option => option.value === offer.id)) { message('admin-message', 'この広告 ID は現在の掲載カタログにありません。API から設定を確認してください。', true); return; }
      $('offer-id').value = offer.id; fillOffer(); $('offer-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const row = document.createElement('div'); row.append(button); $('offers-list').append(row);
    $('conversion-offer').append(new Option(offer.name, offer.id));
  }
  if (!offers.length) $('offers-list').append(line('広告は未登録です', '通常の公式リンクが掲載されます。'));
  $('automation-runs').replaceChildren();
  for (const run of data.runs) {
    let summary = {};
    try { summary = JSON.parse(run.summary_json || '{}'); } catch { /* Keep the run metadata visible even if a historical summary is malformed. */ }
    const row = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = `${time(run.started_at)} · ${statusNames[run.status] || run.status}`;
    const detail = document.createElement('pre'); detail.textContent = JSON.stringify(summary, null, 2);
    row.append(title, detail); $('automation-runs').append(row);
  }
  if (!data.runs.length) $('automation-runs').append(line('実行履歴はありません', '定期実行または「今回の更新を実行」で記録されます。'));
  $('source-status').replaceChildren();
  for (const source of data.sources) $('source-status').append(line(source.source_id, `${source.ok ? '取得成功' : '確認できませんでした'} ／ ${time(source.checked_at)}${source.status_code ? ` ／ HTTP ${source.status_code}` : ''}`));
  if (!data.sources.length) $('source-status').append(line('公式情報の確認は未実行です', '取得成功は情報の正確性を保証するものではありません。'));
}

async function refresh() {
  const currentSession = session;
  const [data, articleData, growthData, analyticsData] = await Promise.all([api('/api/admin/status'), api('/api/admin/articles'), api('/api/admin/growth'), api('/api/admin/analytics')]);
  if (!adminToken || session !== currentSession) throw new Error('接続が終了しました。再度ログインしてください。');
  renderStatus(data);
  renderArticles(articleData.articles, articleData.sources);
  growthAdmin.render(growthData, analyticsData);
  $('admin-login').hidden = true; $('admin-private').hidden = false;
}

function logout() {
  session++;
  adminToken = ''; offers = [];
  growthAdmin.clear();
  for (const controller of pendingRequests) controller.abort();
  $('admin-private').hidden = true; $('admin-login').hidden = false;
  $('admin-login').reset(); $('offer-form').reset(); $('conversion-form').reset();
  for (const id of ['offers-list', 'automation-runs', 'source-status', 'admin-articles']) $(id).replaceChildren();
  $('conversion-offer').replaceChildren(new Option('広告を登録してください', ''));
  for (const id of ['metric-diagnoses', 'metric-clicks', 'metric-conversions', 'metric-revenue']) $(id).textContent = '—';
  for (const id of ['automation-state', 'offer-message', 'conversion-message', 'article-message']) $(id).textContent = '';
  $('offer-verification').textContent = '有効化には確認が必要です。URL を変更した場合は再確認してください。';
  message('admin-message', 'ログアウトしました。');
}

$('admin-login').addEventListener('submit', async event => {
  event.preventDefault();
  adminToken = $('admin-token').value.trim(); $('admin-token').value = '';
  message('admin-message', '運用状況を読み込んでいます。');
  try { await refresh(); message('admin-message', '運用状況を読み込みました。'); }
  catch (error) { adminToken = ''; message('admin-message', error.message, true); }
});
$('admin-logout').addEventListener('click', logout);
$('admin-refresh').addEventListener('click', async () => {
  try { await refresh(); message('admin-message', '最新の状態に更新しました。'); }
  catch (error) { message('admin-message', error.message, true); }
});
$('admin-run').addEventListener('click', async () => {
  message('admin-message', '自動更新を実行しています。完了まで少し時間がかかります。');
  try {
    const result = await api('/api/admin/run', 'POST', {});
    await refresh();
    message('admin-message', `更新処理の結果：${statusNames[result.status] || result.status || '受付済み'}。実行履歴を確認してください。`);
  } catch (error) { message('admin-message', error.message, true); }
});

function localDate(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fillOffer() {
  const id = $('offer-id').value;
  const offer = offers.find(value => value.id === id);
  const option = $('offer-id').selectedOptions[0];
  $('offer-name').value = offer?.name || option?.dataset.name || '';
  $('offer-description').value = offer?.description || option?.dataset.description || '';
  $('offer-category').value = offer?.category || option?.dataset.category || $('offer-category').options[0].value;
  $('offer-url').value = offer?.url || '';
  $('offer-hosts').value = offer?.allowedHosts.join(', ') || '';
  $('offer-expires').value = localDate(offer?.expiresAt);
  $('offer-enabled').checked = offer?.enabled || false;
  $('offer-click-approved').checked = offer?.clickTracking?.approved === true;
  $('offer-click-parameter').value = offer?.clickTracking?.parameter || '';
  $('offer-click-parameter').required = $('offer-click-approved').checked;
  $('offer-verified').checked = false;
  $('offer-verification').textContent = offer?.verifiedAt ? `登録済みの確認日時：${time(offer.verifiedAt)}。URL・ホストを変更した場合は再確認してください。` : '有効化には確認が必要です。URL を変更した場合は再確認してください。';
  message('offer-message', '');
}
$('offer-id').addEventListener('change', fillOffer);
$('offer-click-approved').addEventListener('change', () => { $('offer-click-parameter').required = $('offer-click-approved').checked; });
$('offer-url').addEventListener('input', () => { $('offer-click-approved').checked = false; $('offer-click-parameter').required = false; });
$('offer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('offer-id').value;
  const previous = offers.find(offer => offer.id === id);
  const url = $('offer-url').value.trim();
  const allowedHosts = [...new Set($('offer-hosts').value.split(',').map(host => host.trim().toLowerCase()).filter(Boolean))];
  const unchanged = previous && previous.url === url && JSON.stringify([...previous.allowedHosts].sort()) === JSON.stringify([...allowedHosts].sort());
  const verifiedAt = $('offer-verified').checked ? new Date().toISOString() : unchanged ? previous.verifiedAt : null;
  if ($('offer-enabled').checked && !verifiedAt) { message('offer-message', 'ASP 提携とリンク条件を確認し、確認のチェックを入れてから有効化してください。', true); return; }
  let expiresAt = null;
  if ($('offer-expires').value) {
    const date = new Date($('offer-expires').value);
    if (!Number.isFinite(date.getTime())) { message('offer-message', '利用期限を確認してください。', true); return; }
    expiresAt = date.toISOString();
  }
  try {
    await api('/api/admin/offers', 'PUT', { id, name: $('offer-name').value.trim(), category: $('offer-category').value, description: $('offer-description').value.trim(), url, allowedHosts, enabled: $('offer-enabled').checked, verifiedAt, expiresAt, ...($('offer-click-approved').checked ? { clickTracking: { parameter: $('offer-click-parameter').value.trim(), approved: true } } : {}) });
    await refresh(); fillOffer(); message('offer-message', '広告設定を保存しました。');
  } catch (error) { message('offer-message', error.message, true); }
});

$('conversion-form').addEventListener('submit', async event => {
  event.preventDefault();
  const date = new Date($('conversion-date').value);
  if (!Number.isFinite(date.getTime())) { message('conversion-message', '成果発生日時を確認してください。', true); return; }
  try {
    const result = await api('/api/admin/conversions', 'POST', { externalId: $('conversion-id').value.trim(), offerId: $('conversion-offer').value, commissionJpy: Number($('conversion-commission').value), occurredAt: date.toISOString(), ...($('conversion-click-id').value.trim() ? { clickId: $('conversion-click-id').value.trim() } : {}) });
    $('conversion-form').reset(); await refresh();
    message('conversion-message', result.created ? '確定成果を登録しました。' : 'この成果は登録済みです。二重計上していません。');
  } catch (error) { message('conversion-message', error.message, true); }
});
window.addEventListener('pagehide', logout);

function renderArticles(articles, sources = []) {
  $('admin-articles').replaceChildren();
  for (const entry of articles) {
    const row = document.createElement('details');
    const title = document.createElement('summary');
    const state = { published: '公開中', draft: '下書き・保留', rejected: '掲載見送り' }[entry.status] || entry.status;
    title.textContent = `${entry.article.title} · ${state}`;
    row.append(title, line('更新', time(entry.updatedAt)), line('公式情報の参照 ID', entry.article.sourceIds.join(' / ')));
    const references = document.createElement('ul');
    for (const id of entry.article.sourceIds) {
      const source = sources.find(item => item.id === id);
      if (!source) continue;
      const item = document.createElement('li'); const link = document.createElement('a');
      link.textContent = `${source.label} ↗`; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link); references.append(item);
    }
    row.append(references);
    const description = document.createElement('p'); description.textContent = entry.article.description; row.append(description);
    for (const section of entry.article.sections) {
      const heading = document.createElement('h3'); heading.textContent = section.heading; row.append(heading);
      for (const paragraph of section.paragraphs) { const p = document.createElement('p'); p.textContent = paragraph; row.append(p); }
      if (section.list?.length) { const list = document.createElement('ul'); for (const text of section.list) { const item = document.createElement('li'); item.textContent = text; list.append(item); } row.append(list); }
    }
    for (const [status, label] of [['published', '内容を確認して公開'], ['draft', '保留にする'], ['rejected', '掲載を見送る']]) {
      if (status === entry.status) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button cream'; button.textContent = label;
      button.addEventListener('click', async () => {
        try { await api('/api/admin/articles', 'PATCH', { slug: entry.slug, status }); await refresh(); message('article-message', '記事の公開状態を更新しました。'); }
        catch (error) { message('article-message', error.message, true); }
      });
      row.append(button, document.createTextNode(' '));
    }
    $('admin-articles').append(row);
  }
  if (!articles.length) $('admin-articles').append(line('記事はありません', '生成された下書きはここに表示されます。'));
}
