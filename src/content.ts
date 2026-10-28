import type { Source } from './types';
export { ARTICLES } from './articles';
export const CATEGORIES = [
 {id:'writing',label:'文章を書く',description:'下書き、要約、アイデアを形に。'},
 {id:'meeting',label:'会議をまとめる',description:'記録と振り返りを、スムーズに。'},
 {id:'design',label:'デザインする',description:'伝わる資料や画像をつくる。'},
 {id:'automation',label:'作業を自動化',description:'くり返す仕事を、仕組みへ。'},
 {id:'knowledge',label:'情報を整理する',description:'メモと知識を、使える資産に。'}
] as const;
export type CategoryId = typeof CATEGORIES[number]['id'];
export interface Tool { id:string;name:string;tagline:string;description:string;category:CategoryId;officialUrl:string;sourceId:string;pricingNote:string;goodFor:string[];cautions:string[];features:string[];icon:string;color:string }
export const SOURCES:Source[] = [
 {id:'chatgpt',label:'ChatGPT 公式サービス紹介',url:'https://chatgpt.com/overview/'},
 {id:'claude',label:'Claude 公式サービス紹介',url:'https://claude.com/product/overview'},
 {id:'notion',label:'Notion 公式サービス紹介',url:'https://www.notion.com/product'},
 {id:'canva',label:'Canva 公式サービス紹介',url:'https://www.canva.com/ja_jp/'},
 {id:'adobe-express',label:'Adobe Express 公式サービス紹介',url:'https://www.adobe.com/jp/express/'},
 {id:'make',label:'Make 公式サービス紹介',url:'https://www.make.com/en'},
 {id:'zapier',label:'Zapier 公式サービス紹介',url:'https://zapier.com/'},
 {id:'notta',label:'Notta 公式サービス紹介',url:'https://www.notta.ai/ja'}
];
const sourceUrl=(id:string)=>SOURCES.find(s=>s.id===id)!.url;
const price='無料枠・体験利用の有無、対象機能、使用量の上限、有料プランの料金は公式サイトで確認してください。';
export const TOOLS:Tool[] = [
 {id:'notion',name:'Notion',tagline:'散らばる情報を、チームの知識に。',description:'メモ、ドキュメント、タスクの情報をひとつのワークスペースで扱う道具。記録する場所と探す場所をそろえたい人に。',category:'knowledge',officialUrl:sourceUrl('notion'),sourceId:'notion',pricingNote:price,goodFor:['案件ごとに資料や議事メモをまとめたい','チームの手順やナレッジの置き場所を統一したい'],cautions:['共有範囲とゲスト権限を確認してから外部に資料を渡す','自由度が高いため、ページ命名と更新担当のルールが必要','AI機能の利用条件は通常のワークスペース機能と分けて確認する'],features:['ドキュメントの作成と共有','データベースによる情報整理','タスクとメモの関連付け'],icon:'N',color:'#f1f1eb'},
 {id:'claude',name:'Claude',tagline:'考えを整理して、伝わる文章へ。',description:'対話しながら文章の構成、下書き、情報整理を進めるAI。自分の意図を言葉にして、検討を重ねたいときの候補です。',category:'writing',officialUrl:sourceUrl('claude'),sourceId:'claude',pricingNote:price,goodFor:['構成や論点から文章の下書きを相談したい','自分で確認できる資料をもとに整理や要約を進めたい'],cautions:['生成結果の事実・引用元・固有名詞を人が確認する','顧客情報や未公開資料の入力前にデータ利用条件を確認する','扱えるファイル、モデル、利用量はプランと時期で異なる'],features:['対話による文章の作成・修正','論点整理とアイデアの検討','資料をもとにした要約支援'],icon:'✳',color:'#f5e8df'},
 {id:'canva',name:'Canva',tagline:'思いを、伝わるビジュアルに。',description:'テンプレートから資料や画像を編集するデザインの道具。見た目をゼロから組み立てる負担を減らしたいときに。',category:'design',officialUrl:sourceUrl('canva'),sourceId:'canva',pricingNote:price,goodFor:['提案資料や告知画像の見た目を整えたい','チームで編集方針をそろえて制作物を共有したい'],cautions:['素材の商用利用・再配布・商標利用の条件を確認する','無料と有料の素材・機能を区別して書き出し条件を確認する','機密情報を含む資料の共有リンクの範囲を確認する'],features:['テンプレートを使ったデザイン編集','プレゼンテーションや画像の制作','共同編集と制作物の共有'],icon:'C',color:'#d7f0ec'},
 {id:'chatgpt',name:'ChatGPT',tagline:'書き始める前の、相談相手に。',description:'対話を通じてアイデアを整理し、文章のたたき台をつくるAI。目的と条件を伝えながら作業を進めたい人向けです。',category:'writing',officialUrl:sourceUrl('chatgpt'),sourceId:'chatgpt',pricingNote:price,goodFor:['白紙から始める代わりに、構成案を複数検討したい','自分の下書きを読み手に合わせて書き直したい'],cautions:['回答には誤りがあり得るため、そのまま対外公開しない','個人情報・秘密情報の入力は契約と利用ポリシーに従う','利用できるモデル、ファイル処理、上限は公式情報で確認する'],features:['対話によるアイデア出し','文章の下書き・言い換え','要点整理と構成案の作成'],icon:'◎',color:'#e0ece3'},
 {id:'make',name:'Make',tagline:'いつもの作業を、流れる仕組みに。',description:'サービス間の処理を視覚的につなぐ自動化ツール。入力から通知までの手順を整理して、繰り返しを減らしたい人に。',category:'automation',officialUrl:sourceUrl('make'),sourceId:'make',pricingNote:price,goodFor:['複数サービスへの転記や通知をつなぎたい','分岐を含む作業の流れを画面で把握したい'],cautions:['使うアプリの連携先と必要なプランを先に確認する','処理回数やデータ量が料金に与える影響を確認する','失敗時の通知・再試行・重複防止を設計してから本番利用する'],features:['サービスをつなぐワークフロー','条件による処理の分岐','実行結果の確認'],icon:'≋',color:'#eee2f9'},
 {id:'zapier',name:'Zapier',tagline:'アプリの間の「ひと手間」をつなぐ。',description:'アプリで起きた出来事をきっかけに、別の処理を実行する自動化ツール。定型的な受け渡しを仕組みにしたいときに。',category:'automation',officialUrl:sourceUrl('zapier'),sourceId:'zapier',pricingNote:price,goodFor:['フォーム受付から記録・通知までの流れをつくりたい','普段使うアプリ同士の受け渡しを自動化したい'],cautions:['利用するアプリとアクションが対応しているか確認する','有料機能・実行回数・更新頻度の条件を照合する','接続アカウントの権限を必要最小限にし、担当者を決める'],features:['きっかけとアクションの接続','アプリ間の情報連携','ワークフローの管理'],icon:'✷',color:'#fbebe3'},
 {id:'adobe-express',name:'Adobe Express',tagline:'伝えたいことを、すぐ形に。',description:'テンプレートや編集機能を使って、画像・動画などの制作を進める道具。手元の素材から発信用の形をつくりたい人に。',category:'design',officialUrl:sourceUrl('adobe-express'),sourceId:'adobe-express',pricingNote:price,goodFor:['SNSや社内発信用の画像をつくりたい','用途の異なる制作物の見た目をそろえたい'],cautions:['素材・フォント・生成物ごとの利用条件を確認する','他のAdobe製品の契約との違いや機能の対象範囲を確認する','書き出し形式・サイズ・共同作業の条件を確かめる'],features:['テンプレートを使った画像制作','動画や発信用素材の編集','制作物のサイズ・見た目の調整'],icon:'Ae',color:'#f8e2ee'},
 {id:'notta',name:'Notta',tagline:'会議の記憶を、見返せる記録に。',description:'音声の文字起こしや内容の整理を支援する道具。聞きながらメモを取り切れない会議の振り返りを助けます。',category:'meeting',officialUrl:sourceUrl('notta'),sourceId:'notta',pricingNote:price,goodFor:['会議内容を文字で見返して確認したい','録音から議事録の下書きをつくる手間を減らしたい'],cautions:['録音や外部サービスへの送信について参加者の同意を得る','文字起こしの誤認識、決定事項、固有名詞を確認する','対応言語・録音方法・保存期間・時間上限を公式情報で確認する'],features:['音声の文字起こし','会議内容の記録・整理','文字になった記録の確認と共有'],icon:'n',color:'#e4eafa'}
];
