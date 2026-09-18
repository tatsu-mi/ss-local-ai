"use client";

import { useCallback, useEffect, useState } from "react";
import { api, jsonRequest } from "./api";

interface User { id: string; email: string; display_name: string; permission_group_id: string; created_at: string; }
interface Group { id: string; name: string; can_manage_qa: boolean; }

export function UsersPanel() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const result = await api<{ users: User[]; groups: Group[] }>("/api/users"); setUsers(result.users); setGroups(result.groups); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "利用者を取得できませんでした。"); }
  }, []);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  async function change(userId: string, permissionGroupId: string) {
    setBusy(true); setError("");
    try { await api(`/api/users/${userId}`, jsonRequest("PATCH", { permissionGroupId })); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "権限を更新できませんでした。"); }
    finally { setBusy(false); }
  }

  return <div className="panel">
    <div className="panel-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h1>利用者と権限</h1><p>変更は次のデータ取得から即時に適用されます。</p></div></div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>メールアドレス</th><th>表示名</th><th>権限グループ</th><th>登録日時</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.email}</td><td><strong>{user.display_name}</strong></td><td><select value={user.permission_group_id} disabled={busy} onChange={(e) => void change(user.id, e.target.value)}>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></td><td>{new Date(user.created_at).toLocaleDateString("ja-JP")}</td></tr>)}</tbody></table></div>
  </div>;
}
