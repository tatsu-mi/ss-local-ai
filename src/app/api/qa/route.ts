import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { createQa, listQa } from "@/lib/qa-service";
import { currentUser } from "@/lib/session";
import { requireBusinessAccess, requireQaManager } from "@/lib/users";
import { createQaSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    requireBusinessAccess(user);
    const items = await listQa(user, request.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    requireQaManager(user);
    const input = createQaSchema.parse(await request.json());
    const item = await createQa(user, input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
