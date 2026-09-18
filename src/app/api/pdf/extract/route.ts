import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { extractQaFromPdf } from "@/lib/gemini";
import { AppError, errorResponse } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { requireQaManager } from "@/lib/users";

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    requireQaManager(user);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "application/pdf") {
      throw new AppError(400, "PDFファイルを選択してください。", "INVALID_PDF");
    }
    if (file.size === 0 || file.size > env().MAX_PDF_BYTES) {
      throw new AppError(400, "PDFのサイズが許容範囲を超えています。", "INVALID_PDF_SIZE");
    }
    const result = await extractQaFromPdf(new Uint8Array(await file.arrayBuffer()));
    if (!result.items.length) {
      throw new AppError(422, "PDFからQAを抽出できませんでした。", "NO_QA_EXTRACTED");
    }
    // No PDF metadata or draft is persisted here. The browser owns this result until registration.
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
