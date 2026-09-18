import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage() {
  if (await auth()) redirect("/");
  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">事業部ナレッジ</p>
        <h1>ローカルAI</h1>
        <p className="muted">
          登録済みの社内QAだけを根拠に、質問への回答や情報整理を行います。
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/" });
          }}
        >
          <button className="primary wide" type="submit">
            会社アカウントでログイン
          </button>
        </form>
        <p className="fine-print">Microsoft Entra IDで認証します。</p>
      </section>
    </main>
  );
}
