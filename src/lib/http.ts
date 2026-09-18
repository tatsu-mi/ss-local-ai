import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "入力を確認してください", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: "処理に失敗しました。時間を置いて再試行してください。", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
