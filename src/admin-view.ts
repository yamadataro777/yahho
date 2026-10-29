import { CATEGORIES, TOOLS } from './content';
import { escapeHtml as e } from './html';

export function adminPage(): string {
  return `<section class="page-head"><p class="eyebrow">OPERATIONS</p><h1>サイトの運用室。</h1><p>需要の根拠、流入と成果、改善の記録を一つの場所で確認できます。</p></section>
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

    ${growthPanel()}

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
        <label for="offer-hosts">許可するリンク先ホスト名（カンマ区切り）</label><input id="offer-hosts" type="text" required placeholder="発行 URL のホスト名を入力" spellcheck="false"><p class="micro">「https://」やパスを除いた完全一致のホスト名です。通常は発行 URL をそのまま使用します。</p>
        <fieldset class="growth-fieldset"><legend>成約とクリックを結び付ける（任意）</legend><label><input id="offer-click-approved" type="checkbox"> ASP がクリック ID の追加を認めることを確認した</label><label for="offer-click-parameter">ASP 指定のパラメータ名</label><input id="offer-click-parameter" type="text" maxlength="32" pattern="[A-Za-z][A-Za-z0-9_]{0,31}" placeholder="ASP の仕様に記載された名前" spellcheck="false"><p class="micro">通常はオフです。許可された場合だけ匿名のクリック ID を追加します。署名付き URL など追加不可のリンクでは使わないでください。ASP の成果通知から同じ ID を取り込むと流入・ページ別に成約を照合できます。</p></fieldset>
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
          <label for="conversion-click-id">ASP が返したクリック ID（任意）</label><input id="conversion-click-id" type="text" maxlength="80" spellcheck="false"><p class="micro">ASP の成果記録に実際に返された ID だけを入力します。不明な成果は「流入不明」として記録し、推測で結び付けません。</p>
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

function growthPanel(): string {
 const categories = CATEGORIES.map(c => `<option value="${e(c.id)}">${e(c.label)}</option>`).join('');
 return `<section class="admin-panel growth-panel" id="growth-panel">
  <div class="section-heading"><div><p class="eyebrow">LEARN FROM EVIDENCE</p><h2>需要・集客・成果を確かめる</h2></div><button type="button" class="button cream" id="growth-evaluate">最新データで改善案を作る</button></div>
  <p>検索で訪れる読者の困りごとを決め、記事ごとの根拠・流入・成果を確かめます。自然検索の計測に専用リンクは不要です。Googleの表示回数・検索語はSearch Consoleから記録し、サイト側で観測した検索流入と分けて確認します。</p>
  <p id="growth-message" class="admin-message" role="status" aria-live="polite"></p>
  <details class="growth-section" open><summary>1. 読者と需要の仮説</summary>
    <form id="growth-hypothesis-form" class="growth-form">
      <div class="growth-form-grid"><div><label for="growth-audience">対象となる読者</label><input id="growth-audience" minlength="2" maxlength="200" required placeholder="例：見積書の転記に時間がかかる個人事業主"></div><div><label for="growth-category">用途</label><select id="growth-category">${categories}</select></div></div>
      <label for="growth-pain">解決したい具体的な困りごと</label><textarea id="growth-pain" minlength="5" maxlength="500" required></textarea>
      <div class="growth-form-grid"><div><label for="growth-query">読者が検索しそうな言葉</label><input id="growth-query" minlength="2" maxlength="200" required placeholder="例：Make Zapier 見積書 自動化"></div><div><label for="growth-target">検証するページのパス</label><input id="growth-target" maxlength="200" required placeholder="/compare/make-vs-zapier" spellcheck="false"></div></div>
      <button type="submit" class="button primary">仮説を保存</button><p class="micro">保存しただけでは需要の確認済みになりません。下で出典と観測日を登録します。</p>
    </form><div id="growth-hypotheses" class="growth-records"></div>
  </details>
  <details class="growth-section"><summary>2. 需要の根拠を記録する</summary>
    <form id="growth-evidence-form" class="growth-form">
      <label for="growth-evidence-hypothesis">対象の仮説</label><select id="growth-evidence-hypothesis" required></select>
      <div class="growth-form-grid"><div><label for="growth-evidence-kind">根拠の種類</label><select id="growth-evidence-kind"><option value="customer_quote">読者の具体的な悩み</option><option value="search_console">Search Console の実績</option><option value="suggestion">検索候補</option><option value="competitor">競合の観測</option><option value="official_page">公式情報</option></select></div><div><label for="growth-evidence-date">観測日時（端末の時刻）</label><input id="growth-evidence-date" type="datetime-local" required></div></div>
      <label for="growth-evidence-url">根拠を確認できる URL（HTTPS）</label><input id="growth-evidence-url" type="url" maxlength="2000" required placeholder="https://…" spellcheck="false">
      <label for="growth-evidence-summary">確認できた事実と、まだ分からないこと</label><textarea id="growth-evidence-summary" minlength="20" maxlength="2000" required></textarea><p class="micro">個人名・メールアドレス・非公開の発言を貼り付けないでください。検索候補の存在は検索数や購入意思の証明にはなりません。</p>
      <fieldset id="growth-evidence-metrics" class="growth-fieldset" hidden><legend>Search Console の観測値</legend><label for="growth-evidence-query">実際に表示された検索語</label><input id="growth-evidence-query" maxlength="200"><div class="growth-form-grid"><div><label for="growth-evidence-start">集計期間の開始日</label><input id="growth-evidence-start" type="date"></div><div><label for="growth-evidence-end">集計期間の終了日</label><input id="growth-evidence-end" type="date"></div><div><label for="growth-evidence-impressions">表示回数</label><input id="growth-evidence-impressions" type="number" min="0" step="1"></div><div><label for="growth-evidence-clicks">クリック数</label><input id="growth-evidence-clicks" type="number" min="0" step="1"></div></div></fieldset>
      <button type="submit" class="button primary">根拠を記録</button>
    </form><div id="growth-evidence" class="growth-records"></div>
  </details>
  <details class="growth-section"><summary>3. 任意の施策に計測リンクを付ける</summary><p>自然検索の評価は、仮説に登録したページへ入った検索流入を使います。メールや外部サイトで特定の紹介を検証する場合だけ、以下のリンクを使ってください。SNS運用は必須ではありません。</p>
    <form id="growth-campaign-form" class="growth-form"><label for="growth-campaign-hypothesis">検証する仮説</label><select id="growth-campaign-hypothesis" required></select><div class="growth-form-grid"><div><label for="growth-campaign-name">任意の紹介施策の名前</label><input id="growth-campaign-name" minlength="2" maxlength="120" required placeholder="例：業務テンプレートの紹介・初回"></div><div><label for="growth-campaign-source">掲載先</label><select id="growth-campaign-source"><option value="other">外部の紹介・その他</option><option value="email">ニュースレター</option><option value="threads">Threads（任意）</option><option value="search">検索の個別施策</option></select></div></div><button type="submit" class="button primary">計測するリンクを作る</button><p class="micro">リンクの作成後、掲載先で使用します。ここから投稿やメールの送信は行いません。リンクには登録した施策の識別子だけを付けます。</p></form><div id="growth-campaigns" class="growth-records"></div>
    <details class="growth-inner"><summary>掲載先の表示・クリック実績を追加する</summary><form id="growth-observation-form" class="growth-form"><label for="growth-observation-campaign">対象の施策</label><select id="growth-observation-campaign" required></select><div class="growth-form-grid"><div><label for="growth-observation-start">集計期間の開始日</label><input id="growth-observation-start" type="date" required></div><div><label for="growth-observation-end">集計期間の終了日</label><input id="growth-observation-end" type="date" required></div><div><label for="growth-observation-impressions">表示回数</label><input id="growth-observation-impressions" type="number" min="0" step="1" required></div><div><label for="growth-observation-clicks">クリック数</label><input id="growth-observation-clicks" type="number" min="0" step="1" required></div></div><label for="growth-observation-url">実績の確認先（HTTPS）</label><input id="growth-observation-url" type="url" required maxlength="2000"><button type="submit" class="button cream">掲載先の実績を記録</button><p class="micro">対象の投稿・施策だけの数値を入力します。同じ施策の重なる期間を重複して登録できません。サイトで観測した流入数とは別の計測です。</p></form><div id="growth-observations" class="growth-records"></div></details>
  </details>
  <details class="growth-section" open><summary>4. 流入と成約を見る</summary><p id="growth-window" class="micro"></p><div id="growth-metrics" class="metric-grid"></div><p class="micro">訪問は匿名 ID の有効期間内で数えます。ページごとの訪問数を足すと同じ訪問が重複します。広告クリックは移動操作の記録で、ASP の受理や成約を意味しません。ページ表のクリック率はクリック回数÷ページ閲覧回数で、繰り返し操作により100%を超える場合があります。</p><div id="growth-analytics"></div><h3>流入別のまとまり</h3><div id="growth-campaign-analytics"></div><h3>取り込んだ成果</h3><div id="growth-conversions" class="growth-records"></div><p class="micro">成約率は、照合できる設定のクリックのうち、7日以上経過したものを分母にします。成果の確定が遅れる場合があります。紐づけできない成果・取消済み成果は別に示します。全体の確定報酬は期間内に発生した成果、ページ別の報酬は期間内のクリックに結び付いた成果なので、合計は一致しない場合があります。</p></details>
  <details class="growth-section" open><summary>5. 次の改善と、変更後の結果</summary><p class="micro">改善案には根拠と件数を添えます。数値は初期の運用目安で、検索順位や統計的な有意差を保証する基準ではありません。追加検証に進む目安は、最近の需要記録、100訪問、7日経過した照合対象クリック30件・20訪問、成約3クリック・3訪問です。訪問は匿名 ID 単位で、人数ではありません。変更内容を記録して観測を続け、前後の差だけで因果関係や勝ちパターンを断定しません。</p><div id="growth-decisions" class="growth-records"></div></details>
 </section>`;
}
