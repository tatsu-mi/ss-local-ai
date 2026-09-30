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

意味検索は類似度閾値0.70を評価開始値とし、候補10件から最大5件を回答に渡す。認証はAuth.jsのMicrosoft Entra IDシングルテナントJWTセッションを使う。Supabaseへのアクセスは信頼できるサーバー処理だけが行い、全APIで利用者の最新権限を確認する。

## 実装

Next.js App Routerの単一アプリとして初期リリース範囲を実装している。

- Microsoft Entra IDのシングルテナント認証と、初回ログイン時の最低権限ユーザー登録
- 現在のDB権限を毎リクエスト取得するQA一覧・登録・編集・公開範囲変更・除外・削除
- Gemini Embeddingとpgvectorによる、権限フィルタを検索前に適用した意味検索
- 登録済みQAだけを入力にする回答生成、出典ID・版・現在権限の応答直前検証
- 会話履歴の一覧・再表示・本人による削除と、現在利用できないQAに依存する過去回答の非表示・会話文脈からの除外
- PDFからのQA抽出、ブラウザ上での編集・選択、項目単位の冪等な登録
- 利用者の権限グループ管理

### ローカル起動

必要条件はNode.js 20.19以上のLTS版、Supabaseプロジェクト、Microsoft Entra IDのアプリ登録、Gemini APIキー。

1. `npm install`を実行する。
2. `.env.example`を`.env.local`へコピーし、すべての必須値を設定する。
3. Supabase CLIの`supabase db push`を実行するか、SQL Editorで[`supabase/migrations/202609170001_initial_schema.sql`](supabase/migrations/202609170001_initial_schema.sql)を適用する。
4. Entra IDのWebリダイレクトURIへ`http://localhost:3100/api/auth/callback/microsoft-entra-id`を登録する。
5. `npm run dev`で起動する。

### Gemini の設定

モデルや出典チェックを変更するには、`.env.local` の該当項目を書き換えてアプリを再起動する。Vercelでは同じ名前の環境変数を変更し、再デプロイする。全項目の記入例は [`.env.example`](.env.example) を参照。

#### 使用モデル

| 処理 | 通常時 | 再試行時 |
| --- | --- | --- |
| チャット回答 | `GEMINI_GENERATION_MODEL=gemini-3.5-flash-lite` | `GEMINI_GENERATION_FALLBACK_MODEL=gemini-3.6-flash` |
| PDFからのQA抽出 | `GEMINI_PDF_MODEL=gemini-3.1-flash-lite` | `GEMINI_PDF_FALLBACK_MODEL=gemini-3.5-flash-lite` |
| 意味検索 | `GEMINI_EMBEDDING_MODEL=gemini-embedding-001` | 同じモデル |

#### 再試行

チャットとPDF抽出は、最初の呼び出しが再試行対象の理由で失敗すると、2回目から表の「再試行時」のモデルを使う。Embeddingは同じモデルで再試行する。

- 対象：`408`、`429`、`5xx`、タイムアウト、一時的な接続切断、応答内容の検証失敗。認証・入力不備など再試行しても直らない`4xx`は対象外。
- 回数：初回を含め最大4回。チャットとPDFは`GEMINI_GENERATION_MAX_ATTEMPTS`、Embeddingは`GEMINI_EMBEDDING_MAX_ATTEMPTS`で変更できる。
- 待機：最初の再試行まで約1秒、以降は指数的に増やし、最大8秒。揺らぎを加える。`GEMINI_RETRY_BASE_DELAY_MS`と`GEMINI_RETRY_MAX_DELAY_MS`で変更できる。

#### 出典チェック

チャット回答の出典チェックは`RAG_CITATION_VALIDATION_MODE`で切り替える。

| 値 | チャット回答の扱い |
| --- | --- |
| `relaxed`（既定） | 本文の有効な`[S番号]`を採用する。本文に番号がなければ、回答に付いた登録済みQAの引用情報を採用する。 |
| `strict` | 本文の`[S番号]`と引用情報が完全に一致する回答だけを採用する。 |

厳密なチェックに切り替える場合は、`.env.local`に次の値を設定する。

```dotenv
RAG_CITATION_VALIDATION_MODE=strict
```

どちらの値でも、渡していないQAの引用・存在しない番号・出典のない回答は拒否する。

### 認証と管理者登録

Entra IDには委任アクセス許可を追加せず、OIDCの`openid profile email`だけを使用する。Issuerは`https://login.microsoftonline.com/<TENANT_ID>/v2.0`（末尾スラッシュなし）を設定する。Issuer URLからテナントIDを取得してログイン結果の`tid`と照合し、メールアドレスは小文字へ正規化して利用者を識別する。Microsoft Graphと`User.Read`は使用しない。

ログインユーザーは`app_user`へ自動登録される。管理者は独立した`administrator_accounts`テーブルで管理し、アプリケーションからは追加・更新しない。管理者を登録する場合は、運用担当者がSupabase SQL Editorで次を手動実行する。

```sql
insert into public.administrator_accounts (email, display_name)
values ('admin@example.com', '管理者名');
```

メールアドレスはEntra IDのメールアドレスと同じ値を小文字で登録する。レコードが存在し、`is_active = true`の利用者だけが管理者として扱われる。無効化はレコードを削除するか、`is_active = false`へ更新することで即時に反映される。

### Embedding の変更

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
