import { NextRequest, NextResponse } from "next/server";
import { answerQuestion, listConversation } from "@/lib/chat-service";
import { errorResponse } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { requireBusinessAccess } from "@/lib/users";
import { chatRequestSchema } from "@/lib/validation";
import { z } from "zod";

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    requireBusinessAccess(user);
    const conversationId = z.uuid().parse(request.nextUrl.searchParams.get("conversationId"));
    const messages = await listConversation(user, conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    requireBusinessAccess(user);
    const input = chatRequestSchema.parse(await request.json());
    const result = await answerQuestion(user, input.question, input.conversationId);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
