# しごと道具

個人事業主・小規模チームが、用途から仕事効率化・AIツールを選ぶための比較メディアです。用途別診断、比較、オリジナルの選び方記事から、公式サイトまたは提携済みの広告へ案内します。Cloudflare Workers + D1 で動作します。

クリックを収益として扱いません。管理画面の収益は、認証済み API で取り込んだ ASP の確定報酬から取消済み成果を除いた合計です。ASP の審査、集客、購入、成果承認は外部条件であり、サイトの公開や自動更新だけで利益が保証されるものではありません。

## 実装と検証

8種類のツール、6本の選び方ガイド、3本の専用比較ページ、用途別診断、最大3候補の比較、広告管理、記事の公開・保留、確定成果の取り込み、自動運用を実装しています。本文・補足の文字サイズとコントラストを改善し、問い合わせ先の設定、共有画像、検索向けの canonical・サイトマップ・構造化データも用意しています。[検証結果と画面](docs/VALIDATION.md)を参照してください。

## ローカル開発

Node.js 24 と npm を使用します。

```sh
cd /workspace/yahho
npm ci
node scripts/setup-local.mjs
npm run db:local
npm run dev
```

`setup-local.mjs` は `.dev.vars` がない場合だけローカル用の秘密値を生成し、既存ファイルを保存します。手動設定する場合は `.dev.vars` に異なるランダムな `ADMIN_TOKEN` と `CONVERSION_TOKEN` を各32文字以上で設定すると、ローカルの管理 API と成果取り込みを検証できます。値を Git に追加しないでください。トークン未設定では管理 API が 503 を返し、未認証アクセスには公開しません。

```sh
npm run check
npm run test:e2e
```

`check` は型検査、ユニットテスト、Workers のドライランビルドを実行します。D1 のローカルデータは `.wrangler/`、ビルド出力は `dist/` に保存します。ローカル開発で本番の D1 や課金対象の Workers AI に接続しません。実行環境で Wrangler のログディレクトリを作れない場合は、`WRANGLER_LOG_PATH=/workspace/yahho/.wrangler/logs` をコマンドの環境変数として指定します。

ブラウザ検証には Chromium を使用します。このクラウド環境では `/usr/bin/chromium` が利用可能です。別環境では `CHROMIUM_PATH` を指定してください。ブラウザテスト専用の D1 は `.wrangler/e2e` に分離され、そこでの成果データは本番実績ではありません。

各タスクは既に隔離された環境です。このチェックアウトを使用し、特別な依頼がなければ worktree を追加する必要はありません。

## Cloudflare への公開

2026-10-29（JST）、[しごと道具](https://shigoto-dougu.deepen-api.workers.dev)をCloudflare Workersと専用D1へデプロイしました。設定反映はCloudflare APIで確認済みです。公開URLの実表示は作業環境の通信制限により未確認です。[本番公開の記録と残る確認](docs/DEPLOYMENT.md)を参照してください。ASP接続とAI記事の自動公開は未実施で、秘密のトークンはリポジトリに含めていません。

以下を実行プロセスの環境変数に、安全な設定画面やシークレット管理機能から設定します。秘密値をチャット、コマンドの引数、追跡対象ファイルに記載しないでください。

| 変数 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 対象アカウントに限定した Workers Scripts / D1 編集権限を持つトークン。AI 利用時はそのアカウントの Workers AI 利用権限も確認 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare の32文字のアカウント ID（秘密値ではありません） |
| `D1_DATABASE_ID` | 既存 D1 の UUID。初回作成なら省略して `--provision` を使用 |
| `SITE_URL` | 公開する HTTPS オリジン。パスなしの `https://…workers.dev` または独自ドメイン |
| `OPERATOR_NAME` | 実際の運営者の公開名称。必須 |
| `CONTACT_EMAIL` / `PUBLIC_CONTACT_URL` | 運営者が対応できるメールまたはHTTPS問い合わせフォーム。少なくとも一方が必須 |
| `GOOGLE_SITE_VERIFICATION` | 任意。Search ConsoleのHTMLタグ方式の確認トークン。設定だけでは所有権確認は完了しません |
| `ADMIN_TOKEN` | 管理画面用のランダムな秘密値。32文字以上 |
| `CONVERSION_TOKEN` | 成果連携専用の別の秘密値。32文字以上 |
| `ENABLE_AI` | 任意。`true` で Workers AI バインディングを追加。Cloudflare 側の利用条件・料金・利用上限を確認して設定 |
| `ENABLE_AUTOPUBLISH` | 任意。`true` で品質条件を通った AI 記事を公開。`ENABLE_AI=true` も必要。既定値は `false` |
| `MAX_DAILY_ARTICLES` | 任意。`1` で1日最大1記事、`0` で AI 記事生成を停止。既定値は `1`。停止中も公式情報・広告の点検は継続 |

```sh
# 外部通信・変更なしの設定検証
npm run deploy -- --check

# 初回に D1 を作る場合の設定検証
npm run deploy -- --check --provision

# 初回作成と公開（Cloudflare に実際にリソースを作成します）
npm run deploy -- --provision

# 2回目以降は表示された D1_DATABASE_ID を設定して更新
npm run deploy
```

スクリプトは設定検証と `npm run check` の成功後、必要なら D1 を作成し、マイグレーション、Worker の公開、管理シークレットの送信を順に行います。シークレットは Wrangler の標準入力に渡します。生成する `wrangler.production.json` は秘密値を含まず、Git の対象外です。D1 作成後に処理が止まった場合は、Cloudflare から ID を確認して `D1_DATABASE_ID` を設定して再実行します。作成コマンドを繰り返さないでください。

公開後からシークレット送信完了まで、管理 API は設定不足の 503 になることがあります。秘密値の送信で失敗した場合は修正してデプロイを再実行します。公開先でヘルスチェック、診断、記事表示、管理画面の認証を確認してください。独自ドメインの DNS・ルート登録は Cloudflare の設定で別途行います。`SITE_URL` の指定だけではドメインを取得・接続しません。

クラウド環境の通信制限がある場合は、公開に `api.cloudflare.com`、公式情報の確認に `src/content.ts` の `SOURCES` が使用するホストへの HTTPS が必要です。既存の通信制限や TLS 検証を無効にせず、環境設定で必要な宛先を追加します。

## アフィリエイトの接続

1. 掲載ジャンル・対象サービスと合う ASP や紹介プログラムに申請し、サイトの掲載承認を受けます。現時点でサイトに提携契約はありません。
2. ASP の規約で、掲載先、広告表記、許可される文言、リンクの扱いを確認します。
3. `/admin` で管理トークンを入力し、提携済みの広告を登録します。API は `PUT /api/admin/offers` です。
4. 管理画面でリンクを有効にすると、対応する案内が広告リンクに切り替わります。登録前は公式サイトへの案内です。

広告データは `id`（対象ツールの ID）、`name`、`category`、`description`、`url`、`allowedHosts`（URL のホスト名と完全一致）、`enabled`、`verifiedAt`（契約とリンクを確認した ISO 日時）、`expiresAt`（期限または null）を持ちます。HTTPS の承認済みリンクをそのまま登録します。期限切れ、未確認、無効なリンクは広告として表示しません。既定では署名付き URL を変更しません。ASPが動的サブIDの追加と返却を明示的に許可する場合に限り、任意の `clickTracking: {parameter: "ASP指定の名前", approved: true}` を設定できます。許可したパラメータにランダムなクリックIDを追加し、その他のURL文字列を保持します。アクセスを送って成果を偽装したり、広告 URL を定期巡回してクリックを水増ししたりしません。

成果は `POST /api/conversions/webhook` に `Authorization: Bearer <CONVERSION_TOKEN>` と JSON を送って取り込みます。管理画面からの入力には `POST /api/admin/conversions` と `ADMIN_TOKEN` を使用できます。

```json
{
  "externalId": "asp-confirmed-transaction-id",
  "offerId": "registered-tool-id",
  "commissionJpy": 1200,
  "occurredAt": "2026-10-28T00:00:00.000Z"
}
```

上記は構造の例であり、成果実績ではありません。確定済みの日本円報酬だけを取り込みます。重複した `externalId` は二重計上されず、内容の異なる重複は 409 です。ASP がこの形式を直接送信できない場合は、その ASP の署名検証・確定/取消仕様に対応した連携アダプターが別途必要です。クリック集計から成果金額を推測しません。ASPが返した `clickId` を任意で付けると、同じ広告の実際のクリックと30日以内の成果を照合します。IDがない成果は未紐付けです。取消は管理画面または `POST /api/admin/conversions/reverse` に `{externalId}` を送って記録します。既存成果を変更した内容で再送しても上書きしません。

## 需要・集客・成約から改善する

`/admin` の「需要・集客・成果を確かめる」で、対象読者・課題・検索語・対象ページを仮説として登録し、出典と日付付きの根拠を記録できます。施策ごとの専用リンクで流入を区別し、ページ閲覧・診断・広告クリック・ASPの確定成果を表示します。未紐付けや取消は区別します。

Search ConsoleのCSV、検索候補の取得JSON、出典付きの観測JSONは `npm run import:growth -- --format … --file … --dry-run` で検証できます。`--apply` の場合だけ設定済みのサイトへ保存します。詳細と入力形式は [需要・計測・改善の運用手順](docs/GROWTH.md) を参照してください。

日次処理は根拠の鮮度・訪問数・十分に日数が経過したクリック・確定成果から次の改善案を保存します。根拠が不足する状態では拡大を推奨しません。変更を実施した内容と日時を記録し、変更後の結果を再評価できます。十分な需要観測と成約がある仮説は、次の記事の対象用途・具体的な課題として優先します。広告報酬で推薦順位を変更せず、前後比較を因果効果の証明とは扱いません。

訪問IDはタブ内で最大30分、詳細記録は90日です。IPやユーザーエージェント、参照元URL全体は独自計測に保存しません。プライバシーページで計測を停止でき、DNT/GPCも尊重します。JavaScript無効・計測拒否・通信失敗などによる欠測があります。検索候補と公式の提携案内は[調査記録](docs/RESEARCH.md)に保存しています。実流入・検索数・ASP実接続は未検証です。

## 自動運用

Cron は毎日 21:15 UTC / 翌日 06:15 JST に動きます。公式情報の到達性と内容を確認し、期限切れ広告を停止します。AI を接続した場合は確認できた情報に基づいて記事候補を生成し、情報源・引用の整合性・分量・禁止表現などの品質条件を検証します。条件を通らない候補は公開しません。記事の公開は既定で無効です。管理画面で実行結果と理由を確認してから `ENABLE_AUTOPUBLISH=true` で再デプロイできます。

1日に最大1記事、1日1回の実行記録で重複実行を防ぎます。AI 未接続、情報源へのアクセス不可、検証失敗、既定の公開停止は別々の状態として記録します。SNS 向け文章は下書きであり、Threads への投稿やメッセージ送信は行いません。詳細は [自動運用](docs/AUTOMATION.md) と [設計と資料の対応](docs/STRATEGY.md) を参照してください。

この自動化は編集作業の一部を継続実行する仕組みです。API の廃止、ASP 規約の変更、成果取消、ドメイン期限、利用料金、生成物の意味上の誤りには運営側の対応が必要です。公式情報への到達と引用一致の確認だけで、すべての文章の事実性が保証されるわけではありません。

## 運用と復旧

- `/admin` で診断数、広告クリック、取り込んだ確定成果、情報源の状態、Cron の結果を確認します。アクセス数やクリック数にはボット・再試行が含まれる可能性があり、ユニーク利用者数ではありません。
- 記事の自動公開を止めるには `ENABLE_AUTOPUBLISH=false` にして再デプロイします。該当広告の `enabled` を false にすると広告導線を止められます。
- AI の記事生成自体を止めるには `MAX_DAILY_ARTICLES=0` を実行環境に設定して再デプロイします。停止を維持する間は以後のデプロイでも `0` を設定します。変数を省略すると既定値の `1` に戻ります。
- Worker の問題は `npx wrangler deployments list --config wrangler.production.json` で履歴を調べ、対象バージョンを確認して `npx wrangler rollback <VERSION_ID> --config wrangler.production.json` で戻します。
- Worker のロールバックは D1 データやマイグレーションを戻しません。DB 変更前に Cloudflare D1 のバックアップ・Time Travel の保持条件を確認し、必要なら `npx wrangler d1 export affiliate-lab --remote --output <安全な保存先> --config wrangler.production.json` で保全します。広告リンクを含むデータの公開や Git 追加は避けてください。
- 管理トークン漏洩時はすぐに別の値へローテーションします。トークンを設定した端末・管理者を限定し、必要なら Cloudflare Access でも管理画面を保護します。

## 提携・検索意図の調査

現環境から公式の調査先への接続はプロキシ403で拒否されました。許可ドメインの追加はクラウド環境設定のドラフトに保存済みですが、現在の実行環境には未反映です。ライブ調査の結果、報酬額、参加条件、月間検索数は未確認です。

- [提携候補と確認状況](docs/RESEARCH.md)
- [検索意図と実装済みページ](docs/CONTENT-PLAN.md)
- [公開に残る実設定](docs/LAUNCH.md)

`npm run research -- --dry-run` は通信せず対象を表示します。ネットワーク設定の反映後に `npm run research -- --official` / `--suggest` で取得できます。取得結果は `.research/` に記録し、検索候補は検索数や成約見込みと区別します。アカウント登録・提携申請・メッセージ送信は行いません。

共有画像は `public/og-image.png`。`npm run social-card` で同じデザインから再生成できます。外部画像や外部フォントは取得しません。
