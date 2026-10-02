import { NextRequest, NextResponse } from "next/server";
import { formatQaCsv, parseQaCsv, QA_CSV_MAX_BYTES, QaCsvError } from "@/lib/qa-csv";
import { AppError, errorResponse } from "@/lib/http";
import { importQaCsv, listQaForExport, listQaPermissionLevels } from "@/lib/qa-service";
import { currentUser } from "@/lib/session";
import { requireQaManager } from "@/lib/users";

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await currentUser();
    requireQaManager(user);
    const [items, levels] = await Promise.all([listQaForExport(user), listQaPermissionLevels()]);
    return new NextResponse(formatQaCsv(items, levels), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="qa.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    requireQaManager(user);
    const contentLength = Number(request.headers.get("content-length"));
    if (contentLength > QA_CSV_MAX_BYTES + 10000) throw new AppError(413, "CSVファイルが大きすぎます。", "CSV_TOO_LARGE");
    const form = await request.formData();
    const mode = form.get("mode");
    if (mode !== "append" && mode !== "replace") throw new AppError(400, "インポート方法は追加または全置き換えを選択してください。", "CSV_MODE_REQUIRED");
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(400, "CSVファイルを選択してください。", "CSV_REQUIRED");
    if (file.size > QA_CSV_MAX_BYTES) throw new AppError(413, "CSVファイルが大きすぎます。", "CSV_TOO_LARGE");
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw new AppError(400, "CSVはUTF-8で保存してください。", "CSV_ENCODING");
    }
    const levels = await listQaPermissionLevels();
    const rows = parseQaCsv(source, levels, user.permissionRank);
    return NextResponse.json(await importQaCsv(user, rows, mode));
  } catch (error) {
    if (error instanceof QaCsvError) return errorResponse(new AppError(400, error.message, "CSV_INVALID"));
    return errorResponse(error);
  }
}

