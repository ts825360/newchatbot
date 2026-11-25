import { after } from "next/server";
import { dispatchReportNotifications, reportPost } from "@/lib/server/issue-reports";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await reportPost(request);
  if (response.ok) after(async () => { try { await dispatchReportNotifications(); } catch { /* Submission remains stored. */ } });
  return response;
}
