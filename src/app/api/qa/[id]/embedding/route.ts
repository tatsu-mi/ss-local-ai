import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { retryEmbedding } from "@/lib/qa-service";
import { currentUser } from "@/lib/session";
import { requireQaManager } from "@/lib/users";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await currentUser();
    requireQaManager(user);
    const { id } = await context.params;
    const ready = await retryEmbedding(user, id);
    return NextResponse.json({ embeddingStatus: ready ? "ready" : "failed" });
  } catch (error) {
    return errorResponse(error);
  }
}
