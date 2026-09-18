import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { updateQaAccess, updateQaContent, updateQaStatus } from "@/lib/qa-service";
import { currentUser } from "@/lib/session";
import { requireQaManager } from "@/lib/users";
import { updateQaSchema } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    requireQaManager(user);
    const { id } = await context.params;
    const input = updateQaSchema.parse(await request.json());
    const item =
      input.kind === "content"
        ? await updateQaContent(user, id, input)
        : input.kind === "access"
          ? await updateQaAccess(user, id, input.requiredPermissionLevelId)
          : await updateQaStatus(user, id, input.status);
    return NextResponse.json({ item });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    requireQaManager(user);
    const { id } = await context.params;
    await updateQaStatus(user, id, "deleted");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
