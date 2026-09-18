# 事業部向けローカルAI

## アプリの概要

事業部の情報をQA形式で蓄積し、チャットで質問や簡易な情報整理を依頼できるWebアプリ。

アクセス権限を守り、登録済みQAだけを根拠に回答する。回答には出典QAの元データを表示し、根拠が不足する場合は無理に回答しない。

## 技術構成の前提

- Webアプリ：Next.js
- ホスティング：Vercel
- データベース：Supabase PostgreSQL + pgvector（QA本体・検索用Embedding・ユーザー・権限グループ・権限レベル・チャットログを管理）
- 認証：Microsoft Entra ID
- 意味検索：Gemini Embedding APIでQAと質問をベクトル化し、pgvectorで関連QAを検索
- 回答生成など：Gemini API（PDFからのQA抽出、チャット回答、リスト・表・要約の生成）

Gemini APIはNext.jsのサーバー側から呼び出し、APIキーをブラウザへ公開しない。PDF入力時は入力したPDFを送信する。QA登録・更新時には確定した質問・回答・カテゴリ・タグをEmbedding生成のために送信する。チャット時には検索用の質問をEmbedding APIへ、質問・必要な会話文脈・閲覧可能な関連QAを回答生成APIへ送信する。

名称は「ローカルAI」だが、AI処理は外部のGemini APIを利用する。登録時に検索用の索引を作り、質問時に関連QAを選び、回答時にそのQA本文をGeminiへ渡すRAG構成とする。Embeddingは検索に使い、回答の根拠にはQA本文を使う。初期構成ではFastAPIやMCPを追加しない。

初期実装ではEmbeddingに`gemini-embedding-001`の768次元出力、回答・PDF抽出に`gemini-3.8-flash`を使用する。意味検索の類似度閾値は評価開始値として0.70、候補10件、回答入力5件を採用し、環境変数で調整する。認証はAuth.jsのMicrosoft Entra IDプロバイダーによるシングルテナントJWTセッションとし、信頼できるサーバー処理だけがSupabaseのサービスロールでDBへアクセスする。全APIでセッションのアプリユーザーIDから最新権限を再取得する。

Geminiへの回答生成・PDF抽出・Embedding生成が`408`、`429`、`5xx`を返した場合や、タイムアウト・一時的な接続切断が発生した場合は、ジッター付き指数バックオフで再試行する。構造化JSON・出典・Embeddingの応答検証に失敗した場合も再生成する。既定は初回を含め最大4回、初回待機1秒、最大待機8秒。回答生成とPDF抽出では一次モデルの最初の一時障害または不正応答後に、残りの試行を`GEMINI_GENERATION_FALLBACK_MODEL`（既定値`gemini-3.6-flash`）へ切り替える。試行回数は`GEMINI_GENERATION_MAX_ATTEMPTS`と`GEMINI_EMBEDDING_MAX_ATTEMPTS`、待機時間は`GEMINI_RETRY_BASE_DELAY_MS`と`GEMINI_RETRY_MAX_DELAY_MS`で調整できる。認証・入力不備など再試行しても直らない`4xx`は再試行しない。再試行後も一時障害が続く場合、チャットAPIは`503 GENERATION_UNAVAILABLE`を返す。

## 実装

Next.js App Routerの単一アプリとして初期リリース範囲を実装している。

- Microsoft Entra IDのシングルテナント認証と、初回ログイン時の最低権限ユーザー登録
- 現在のDB権限を毎リクエスト取得するQA一覧・登録・編集・公開範囲変更・除外・削除
- Gemini Embeddingとpgvectorによる、権限フィルタを検索前に適用した意味検索
- 登録済みQAだけを入力にする回答生成、出典ID・版・現在権限の応答直前検証
- 現在利用できないQAに依存する過去回答を表示・会話文脈から除外するチャット履歴
- PDFからのQA抽出、ブラウザ上での編集・選択、項目単位の冪等な登録
- 利用者の権限グループ管理

### ローカル起動

必要条件はNode.js 20.19以上のLTS版、Supabaseプロジェクト、Microsoft Entra IDのアプリ登録、Gemini APIキー。

1. `npm install`を実行する。
2. `.env.example`を`.env.local`へコピーし、すべての必須値を設定する。
3. Supabase CLIの`supabase db push`を実行するか、SQL Editorで[`supabase/migrations/202609170001_initial_schema.sql`](supabase/migrations/202609170001_initial_schema.sql)を適用する。
4. Entra IDのWebリダイレクトURIへ`http://localhost:3100/api/auth/callback/microsoft-entra-id`を登録する。
5. `npm run dev`で起動する。

Entra IDには委任アクセス許可を追加せず、OIDCの`openid profile email`だけを使用する。Issuerは`https://login.microsoftonline.com/<TENANT_ID>/v2.0`（末尾スラッシュなし）を設定する。Issuer URLからテナントIDを取得してログイン結果の`tid`と照合し、メールアドレスは小文字へ正規化して利用者を識別する。Microsoft Graphと`User.Read`は使用しない。

ログインユーザーは`app_user`へ自動登録される。管理者は独立した`administrator_accounts`テーブルで管理し、アプリケーションからは追加・更新しない。管理者を登録する場合は、運用担当者がSupabase SQL Editorで次を手動実行する。

```sql
insert into public.administrator_accounts (email, display_name)
values ('admin@example.com', '管理者名');
```

メールアドレスはEntra IDのメールアドレスと同じ値を小文字で登録する。レコードが存在し、`is_active = true`の利用者だけが管理者として扱われる。無効化はレコードを削除するか、`is_active = false`へ更新することで即時に反映される。

Embeddingの既定値は`gemini-embedding-001`、768次元であり、DBの`vector(768)`と一致させている。モデル・次元数・入力方式を変更する場合は、[RAG設計](doc/rag-design.md#検索設定と拡張の境界)に従い、マイグレーションと全QAの再生成を同時に行う。

### 検証コマンド

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```

SupabaseのサービスロールキーとGemini APIキーはサーバー側でのみ使用する。ブラウザからDBを直接操作する経路は設けず、公開スキーマの全テーブルはRLSを有効化し、`anon`・`authenticated`からの権限を明示的に取り消している。

## ドキュメント

- [ユーザーストーリー](doc/user-stories.md)：利用者・受け入れ条件・初期リリースの到達点
- [ユースケース図](doc/use-cases.md)：利用者ごとの操作と共通の制約
- [ER図](doc/er-diagram.md)：ユーザーストーリーに基づく論理データモデル
- [RAG設計](doc/rag-design.md)：登録・意味検索・回答生成の流れと更新・失敗時の扱い
