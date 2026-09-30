import { NextRequest, NextResponse } from "next/server";
import {
  answerQuestion,
  deleteConversation,
  listConversation,
  listConversations,
} from "@/lib/chat-service";
import { errorResponse } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { requireBusinessAccess } from "@/lib/users";
import { chatRequestSchema } from "@/lib/validation";
import { z } from "zod";

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    requireBusinessAccess(user);
    const requestedId = request.nextUrl.searchParams.get("conversationId");
    if (!requestedId) {
      const conversations = await listConversations(user);
      return NextResponse.json({ conversations });
    }
    const conversationId = z.uuid().parse(requestedId);
    const messages = await listConversation(user, conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await currentUser();
    requireBusinessAccess(user);
    const conversationId = z.uuid().parse(request.nextUrl.searchParams.get("conversationId"));
    await deleteConversation(user, conversationId);
    return new NextResponse(null, { status: 204 });
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
