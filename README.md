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

使用モデル・ベクトルの次元数・検索の調整値・Microsoft Entra IDとアプリの認証連携方式は、実装前に確定する。

## ドキュメント

- [ユーザーストーリー](doc/user-stories.md)：利用者・受け入れ条件・初期リリースの到達点
- [ユースケース図](doc/use-cases.md)：利用者ごとの操作と共通の制約
- [ER図](doc/er-diagram.md)：ユーザーストーリーに基づく論理データモデル
- [RAG設計](doc/rag-design.md)：登録・意味検索・回答生成の流れと更新・失敗時の扱い
