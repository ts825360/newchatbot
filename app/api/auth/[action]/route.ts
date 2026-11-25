import { authGet, authPost } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try { return await authGet(request, (await context.params).action); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try { return await authPost(request, (await context.params).action); }
  catch (error) { return errorResponse(error); }
}
