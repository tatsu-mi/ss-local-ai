import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Dashboard } from "@/components/dashboard";
import { loadCurrentUser } from "@/lib/users";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.appUserId) redirect("/login");
  const user = await loadCurrentUser(session.user.appUserId);

  return (
    <>
      <header className="topbar">
        <div>
          <span className="brand-mark">L</span>
          <strong>ローカルAI</strong>
        </div>
        <div className="account">
          <span>{user.displayName}</span>
          <span className="badge">{user.permissionGroupName}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="link-button" type="submit">ログアウト</button>
          </form>
        </div>
      </header>
      {user.permissionRank < 1 ? (
        <main className="center-panel">
          <section className="empty-state">
            <div className="empty-icon">…</div>
            <h1>利用権限の設定待ちです</h1>
            <p>ログインは完了しました。管理者が役割を設定すると利用できます。</p>
          </section>
        </main>
      ) : (
        <Dashboard user={user} />
      )}
    </>
  );
}
