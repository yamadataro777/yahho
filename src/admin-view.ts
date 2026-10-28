import { CATEGORIES, TOOLS } from './content';
import { escapeHtml as e } from './html';

export function adminPage(): string {
  return `<section class="page-head"><p class="eyebrow">OPERATIONS</p><h1>サイトの運用室。</h1><p>広告の設定、確定成果、定期更新の状態を確認できます。</p></section>
<section class="admin-shell">
  <form id="admin-login" class="admin-panel" autocomplete="off">
    <h2>管理者として接続する</h2><p class="micro">Cloudflare のシークレットに設定した管理用トークンを入力してください。トークンはこのページのメモリ内でのみ使用し、保存しません。ページを閉じると再入力が必要です。</p>
    <label for="admin-token">管理用トークン</label><input id="admin-token" type="password" required minlength="32" maxlength="512" autocomplete="off" spellcheck="false">
    <button type="submit" class="button primary">運用状況を読み込む →</button>
  </form>
  <p id="admin-message" class="admin-message" role="status" aria-live="polite"></p>
  <div id="admin-private" hidden>
    <div class="section-heading"><h2>いまの運用状況</h2><div><button type="button" id="admin-refresh" class="text-button">最新の状態に更新</button>　<button type="button" id="admin-logout" class="text-button">ログアウト</button></div></div>
    <div class="metric-grid">
      <div class="metric"><span>診断の実行回数</span><b id="metric-diagnoses">—</b></div>
      <div class="metric"><span>広告クリック数</span><b id="metric-clicks">—</b></div>
      <div class="metric"><span>取り込み済み確定成果</span><b id="metric-conversions">—</b></div>
      <div class="metric"><span>確定報酬（円）</span><b id="metric-revenue">—</b></div>
    </div>
    <p class="micro">診断とクリックは回数の集計で、訪問者数や成約数ではありません。報酬には、ASP で確定し取り込んだ成果だけを表示します。</p>

    <section class="admin-panel"><div class="section-heading"><div><h2>自動更新</h2><p id="automation-state" class="micro"></p></div><button id="admin-run" type="button" class="button cream">今回の更新を実行</button></div>
      <p class="micro">公式情報の取得、記事の品質判定、期限切れ広告の停止を実行します。公開設定と日次上限を守り、同じ日の処理は重複実行しません。自動公開の有効化は Cloudflare の環境変数で行います。</p>
      <div id="automation-runs"></div><h3>公式情報の確認</h3><div id="source-status"></div>
    </section>

    <section class="admin-panel"><h2>記事の公開管理</h2><p class="micro">本文と公式情報の参照先を確認してから公開してください。公開中の記事は保留に戻せます。公開状態だけを変更し、本文を書き換えることはありません。</p><div id="admin-articles"></div><p id="article-message" class="admin-message" role="status"></p></section>
    <div class="admin-grid">
      <form id="offer-form" class="admin-panel">
        <h2>広告リンクを設定する</h2><p class="micro">提携済み ASP から発行されたリンクをそのまま登録してください。未設定の道具には通常の公式リンクが表示されます。</p>
        <label for="offer-id">掲載する道具</label><select id="offer-id" required><option value="">選択してください</option>${TOOLS.map(tool => `<option value="${e(tool.id)}" data-category="${e(tool.category)}" data-name="${e(tool.name)}" data-description="${e(tool.tagline)}">${e(tool.name)}</option>`).join('')}</select>
        <label for="offer-name">管理用の表示名</label><input id="offer-name" type="text" maxlength="120" required>
        <label for="offer-category">カテゴリ</label><select id="offer-category" required>${CATEGORIES.map(category => `<option value="${e(category.id)}">${e(category.label)}</option>`).join('')}</select>
        <label for="offer-description">案内文</label><textarea id="offer-description" maxlength="500" required></textarea>
        <label for="offer-url">ASP 発行の広告 URL（HTTPS）</label><input id="offer-url" type="url" maxlength="4096" required placeholder="https://…" spellcheck="false">
        <label for="offer-hosts">許可するリンク先ホスト名（カンマ区切り）</label><input id="offer-hosts" type="text" required placeholder="発行 URL のホスト名を入力" spellcheck="false"><p class="micro">「https://」やパスを除いた完全一致のホスト名です。署名や計測パラメータを書き換えません。</p>
        <label for="offer-expires">広告の利用期限（任意・現在の端末の時刻）</label><input id="offer-expires" type="datetime-local">
        <label><input id="offer-verified" type="checkbox"> ASP 提携とリンク条件を確認した</label><p id="offer-verification" class="micro">有効化には確認が必要です。URL を変更した場合は再確認してください。</p>
        <label><input id="offer-enabled" type="checkbox"> この広告リンクを有効にする</label>
        <button type="submit" class="button primary">広告設定を保存 →</button><p id="offer-message" class="admin-message" role="status"></p>
      </form>
      <div>
        <section class="admin-panel"><h2>登録済みの広告</h2><div id="offers-list"></div><p class="micro">停止する場合は広告を選択し「有効にする」を外して保存します。</p></section>
        <form id="conversion-form" class="admin-panel">
          <h2>確定成果を取り込む</h2><p class="micro">ASP が確定した報酬を登録します。見込み額・クリック数から収益を作らないでください。同じ成果 ID は二重計上しません。</p>
          <label for="conversion-offer">対象の広告</label><select id="conversion-offer" required><option value="">広告を登録してください</option></select>
          <label for="conversion-id">ASP の成果 ID（一意な照合 ID）</label><input id="conversion-id" type="text" maxlength="128" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.:\-]{0,127}" spellcheck="false"><p class="micro">氏名・メールアドレスなどの個人情報を含めないでください。半角英数字、ピリオド、コロン、ハイフン、アンダースコアが使えます。</p>
          <label for="conversion-commission">確定した報酬額（日本円）</label><input id="conversion-commission" type="number" min="0" max="100000000" step="1" required>
          <label for="conversion-date">成果発生日時（現在の端末の時刻）</label><input id="conversion-date" type="datetime-local" required>
          <label><input id="conversion-confirmed" type="checkbox" required> ASP の確定成果であることを確認した</label>
          <button type="submit" class="button primary">確定成果を登録 →</button><p id="conversion-message" class="admin-message" role="status"></p>
        </form>
      </div>
    </div>
  </div>
</section><script type="module" src="/admin.js"></script>`;
}
