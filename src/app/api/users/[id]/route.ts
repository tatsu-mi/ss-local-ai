import { NextRequest, NextResponse } from "next/server";
import { AppError, errorResponse } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { db, throwIfDbError } from "@/lib/supabase";
import { requireUserManager } from "@/lib/users";
import { updateUserSchema } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await currentUser();
    requireUserManager(actor);
    const { id } = await context.params;
    const input = updateUserSchema.parse(await request.json());
    const { data: group, error: groupError } = await db()
      .from("permission_group")
      .select("id")
      .eq("id", input.permissionGroupId)
      .maybeSingle();
    throwIfDbError(groupError);
    if (!group) throw new AppError(400, "権限グループが見つかりません。", "INVALID_GROUP");

    const { data, error } = await db()
      .from("app_user")
      .update({ permission_group_id: input.permissionGroupId })
      .eq("id", id)
      .select("id, email, display_name, permission_group_id")
      .maybeSingle();
    throwIfDbError(error);
    if (!data) throw new AppError(404, "利用者が見つかりません。", "NOT_FOUND");
    return NextResponse.json({ user: data });
  } catch (error) {
    return errorResponse(error);
  }
}
