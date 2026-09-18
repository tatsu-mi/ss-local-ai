"use client";

import { useState } from "react";
import type { CurrentUser } from "@/lib/types";
import { ChatPanel } from "./chat-panel";
import { PdfPanel } from "./pdf-panel";
import { QaPanel } from "./qa-panel";
import { UsersPanel } from "./users-panel";

type View = "chat" | "qa" | "pdf" | "users";

export function Dashboard({ user }: { user: CurrentUser }) {
  const [view, setView] = useState<View>("chat");
  const links: Array<{ id: View; label: string; description: string; show: boolean }> = [
    { id: "chat", label: "チャット", description: "登録情報から回答", show: true },
    { id: "qa", label: "QA", description: "検索・管理", show: true },
    { id: "pdf", label: "PDF入力", description: "QA候補を抽出", show: user.canManageQa },
    { id: "users", label: "利用者", description: "権限を設定", show: user.canManageUsers },
  ];
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="メインメニュー">
        <p className="eyebrow">メニュー</p>
        {links.filter((link) => link.show).map((link) => (
          <button
            className={view === link.id ? "nav-item active" : "nav-item"}
            key={link.id}
            onClick={() => setView(link.id)}
          >
            <strong>{link.label}</strong>
            <small>{link.description}</small>
          </button>
        ))}
        <div className="privacy-note">
          <strong>回答の方針</strong>
          <span>閲覧可能な登録済みQAだけを根拠にします。</span>
        </div>
      </aside>
      <section className="workspace">
        {view === "chat" && <ChatPanel />}
        {view === "qa" && <QaPanel canManage={user.canManageQa} />}
        {view === "pdf" && user.canManageQa && <PdfPanel />}
        {view === "users" && user.canManageUsers && <UsersPanel />}
      </section>
    </main>
  );
}
