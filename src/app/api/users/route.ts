import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { db, throwIfDbError } from "@/lib/supabase";
import { requireUserManager } from "@/lib/users";

export async function GET() {
  try {
    const actor = await currentUser();
    requireUserManager(actor);
    const [{ data: users, error: usersError }, { data: groups, error: groupsError }] =
      await Promise.all([
        db()
          .from("app_user")
          .select("id, email, display_name, permission_group_id, created_at")
          .order("email"),
        db()
          .from("permission_group")
          .select("id, name, can_manage_qa")
          .order("name"),
      ]);
    throwIfDbError(usersError);
    throwIfDbError(groupsError);
    return NextResponse.json({ users, groups });
  } catch (error) {
    return errorResponse(error);
  }
}
