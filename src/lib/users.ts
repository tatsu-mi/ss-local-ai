import "server-only";
import { DEFAULT_PERMISSION_GROUP_ID, PERMISSION_LEVEL_IDS } from "./constants";
import { AppError } from "./http";
import { db, throwIfDbError } from "./supabase";
import type { CurrentUser } from "./types";

interface EntraIdentity {
  email: string;
  displayName: string;
}

export async function ensureAppUser(identity: EntraIdentity) {
  const database = db();
  const { data: existing, error: lookupError } = await database
    .from("app_user")
    .select("id, display_name")
    .eq("email", identity.email)
    .maybeSingle();
  throwIfDbError(lookupError);

  if (existing) {
    if (existing.display_name !== identity.displayName) {
      const { error } = await database
        .from("app_user")
        .update({ display_name: identity.displayName })
        .eq("id", existing.id);
      throwIfDbError(error);
    }
    return existing.id as string;
  }

  const { data: inserted, error } = await database
    .from("app_user")
    .insert({
      email: identity.email,
      display_name: identity.displayName,
      permission_group_id: DEFAULT_PERMISSION_GROUP_ID,
    })
    .select("id")
    .single();

  if (!error) return inserted.id as string;
  // Concurrent first logins can race on the unique normalized email.
  if (error.code === "23505") {
    const { data: raced, error: raceError } = await database
      .from("app_user")
      .select("id")
      .eq("email", identity.email)
      .single();
    throwIfDbError(raceError);
    if (!raced) throw new Error("Concurrent user creation could not be resolved");
    return raced.id as string;
  }
  throwIfDbError(error);
  throw new Error("Failed to create user");
}

export async function loadCurrentUser(appUserId: string): Promise<CurrentUser> {
  const database = db();
  const { data, error } = await database
    .from("app_user")
    .select("id, email, display_name, permission_group_id")
    .eq("id", appUserId)
    .single();
  throwIfDbError(error);
  if (!data) throw new Error("Current user not found");
  const [groupResult, administratorResult] = await Promise.all([
    database
      .from("permission_group")
      .select("id, name, can_manage_qa, permission_level_id")
      .eq("id", data.permission_group_id)
      .single(),
    database
      .from("administrator_accounts")
      .select("id")
      .eq("email", data.email)
      .eq("is_active", true)
      .maybeSingle(),
  ]);
  const { data: group, error: groupError } = groupResult;
  const { data: administrator, error: administratorError } = administratorResult;
  throwIfDbError(groupError);
  throwIfDbError(administratorError);
  if (!group) throw new Error("Permission group not found");
  const { data: level, error: levelError } = await database
    .from("permission_level")
    .select("rank")
    .eq(
      "id",
      administrator ? PERMISSION_LEVEL_IDS.backoffice : group.permission_level_id,
    )
    .single();
  throwIfDbError(levelError);
  if (!level) throw new Error("Permission level not found");
  return {
    id: data.id,
    displayName: data.display_name,
    permissionGroupId: data.permission_group_id,
    permissionGroupName: administrator ? "管理者" : group.name,
    permissionRank: level.rank,
    canManageQa: Boolean(administrator) || group.can_manage_qa,
    canManageUsers: Boolean(administrator),
  };
}

export function requireBusinessAccess(user: CurrentUser) {
  if (user.permissionRank < 1) {
    throw new AppError(403, "利用権限がまだ設定されていません。管理者に連絡してください。", "ROLE_REQUIRED");
  }
}

export function requireQaManager(user: CurrentUser) {
  if (!user.canManageQa) {
    throw new AppError(403, "QAを管理する権限がありません。", "FORBIDDEN");
  }
}

export function requireUserManager(user: CurrentUser) {
  if (!user.canManageUsers) {
    throw new AppError(403, "利用者を管理する権限がありません。", "FORBIDDEN");
  }
}
