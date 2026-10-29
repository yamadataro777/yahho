# 本番公開の記録

2026-10-29（JST）、Cloudflare Workers と専用 D1 へ初回デプロイを完了しました。

| 項目 | 設定 |
| --- | --- |
| 公開URL | https://shigoto-dougu.deepen-api.workers.dev |
| Worker | `shigoto-dougu` |
| D1 | `affiliate-lab` |
| D1 ID | `2bb5320c-5514-4a8e-95e6-dcf89efe48b3` |
| 運営者 | `haruo tsuchiya` |
| 問い合わせ先 | `miru.support@proton.me` |
| 定期実行 | 毎日06:15 JST（`15 21 * * *` UTC） |
| Workers AI / 記事の自動公開 | 未接続 / 無効 |

運営者・問い合わせ先は、ユーザーの「KokoroMiruを参照」という指定に基づき、[引き継ぎ文書](OPERATOR.md)の公開情報を使用しました。KokoroMiru専用のサポートページへは誘導せず、共通のメールアドレスを設定しています。

## 確認できたこと

- Cloudflare APIでトークンの有効状態、対象アカウントのWorkers・D1の読み取りを確認。
- 公開前の型検査、102件のユニット・統合テスト、Workersドライランビルドが成功。
- 専用D1をAPACに新規作成。`0001_initial.sql`、`0002_analytics.sql`、`0003_growth.sql`の適用を、実DBの読み取りでも確認。
- Workerと静的アセット7件、定期実行設定のデプロイが成功。Workers.devの公開設定が有効であることをAPIで確認。
- `DB`・`ASSETS`・公開設定・別々の`ADMIN_TOKEN`と`CONVERSION_TOKEN`のバインディングをAPIで確認。既存の別サイトとDBは変更していません。

## 未確認・未接続

このクラウド作業環境から公開URLへの接続は、プロキシの`403 Forbidden`で拒否されました。Cloudflareのデプロイ成功と設定反映は確認済みですが、公開URLのHTTP応答・実ブラウザ表示・管理API認証はまだ確認できていません。次の確認時は、環境設定の通信許可に`shigoto-dougu.deepen-api.workers.dev`を追加・反映してから、`/api/health`、トップ、診断、比較、問い合わせ、管理画面を確認します。トークンを再入力する理由にはなりません。

ASP広告・実成果の連携、Search Console、Workers AIは未接続です。記事の自動公開は無効で、提携承認前のリンクは公式サイトへの案内です。別事業の承認をこのサイトへ転用していません。公開は収益発生を意味しません。

## 次回の更新

初回作成は完了しています。以後は上記`D1_DATABASE_ID`を指定して`npm run deploy`を使い、DBを作り直しません。

この作業環境の公開設定は`.wrangler/production-settings.json`、生成した管理用・成果連携用の秘密値は`.wrangler/production-secrets.json`に保存しています。どちらもGit対象外で権限は`0600`です。Cloudflare APIトークンは環境のシークレットを使用し、これらのファイルにはコピーしていません。秘密値を表示・コミットせず、安全なシークレット管理へ保管してください。別の環境からの再デプロイには、これらの設定と秘密値の引き継ぎが必要です。

`wrangler.production.json`もGit対象外です。コードとDBの手順は[公開手順](LAUNCH.md)、計測と改善の操作は[GROWTH.md](GROWTH.md)を参照してください。
