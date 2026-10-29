# Google検索からの流入を確認する

対象URL: `https://shigoto-dougu.deepen-api.workers.dev/`

このサイトはHTMLの確認タグに対応しています。Googleアカウントへのログインと所有権の確認操作は、そのアカウントの所有者が行います。

## 最初の登録

1. [Google Search Console](https://search.google.com/search-console/welcome)を開き、**URLプレフィックス**に上記URLを入力します。`workers.dev`全体のドメインプロパティは使用しません。
2. 所有権の確認方法で**HTMLタグ**を選びます。`<meta name="google-site-verification" content="…">`の`content`の値を取得します。この値はサイトに公開する確認値で、Googleのログイン情報やAPIの秘密鍵ではありません。
3. 本番デプロイの環境変数`GOOGLE_SITE_VERIFICATION`へ、その値だけを設定してデプロイします。タグ全体は指定しません。既存の公開設定を保存した`.wrangler/production-settings.json`を使う場合は、その設定にも同じ項目を追加し、後の更新で消えないようにします。
4. 公開トップページのHTMLにタグが反映されたことを確認し、Search Consoleで**確認**を実行します。タグを置いただけで所有権確認完了とは扱いません。
5. **サイトマップ**から`https://shigoto-dougu.deepen-api.workers.dev/sitemap.xml`を送信します。

## 優先して確認するURL

URL検査で、取得可能か、robots/noindexで除外されていないか、Googleが選択した正規URLが意図どおりかを確認します。

- `/guides/meeting-notes-template`
- `/guides/meeting-notes-checklist`
- `/compare/make-vs-zapier`
- `/guides/make-zapier-workflow`
- `/compare/canva-vs-adobe-express`
- `/guides/canva-adobe-express`

URL検査・サイトマップ送信は、掲載や順位を保証する操作ではありません。未登録の理由と最終クロールを確認し、同じURLへの申請を繰り返すことを運用目標にしません。

## 改善に使うデータ

検索パフォーマンスを**ページ→検索語**の順で確認します。データがある場合は、比較する期間・国・端末・検索の種類をそろえ、表示回数・クリック・CTR・平均掲載順位を記録します。Search Console側の集計条件と遅延、検索語の一部が表示されないことにも注意します。

ページを絞った実検索語のCSVは[需要記録の取り込み](GROWTH.md)で登録できます。ページの異なる集計や重なる期間を同じ観測として重複登録せず、取得元URLと対象期間を保存します。

サイト側の検索入口別レポートは、匿名訪問内の回遊・広告クリック・照合できた確定成果を見るものです。Googleの表示回数・検索語とは異なる計測で、数値が一致するとは限りません。自然検索のためにURLへ`campaign`パラメータを付ける必要はありません。

掲載されない場合は取得・インデックス状態を、表示されるがクリックされない場合は検索意図・タイトル・表示順位を、訪問後に進まない場合は回答の具体性と比較・広告への案内を確認します。成果を見るときはASPの承認期間と取消を含め、観測が少ない段階で勝敗を決めません。
