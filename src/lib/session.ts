import "server-only";
import { auth } from "@/auth";
import { AppError } from "./http";
import { loadCurrentUser } from "./users";

export async function currentUser() {
  const session = await auth();
  if (!session?.user?.appUserId) {
    throw new AppError(401, "ログインが必要です。", "UNAUTHENTICATED");
  }
  return loadCurrentUser(session.user.appUserId);
}
