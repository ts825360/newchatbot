// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/files/[roomId]/[documentId]/route";
import { requireUser } from "@/lib/server/auth";
import { queueFileCleanup, retireFileCleanup } from "@/lib/server/files";
import { ApiError } from "@/lib/server/http";

vi.mock("@/lib/server/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/server/files", () => ({ requireFileScope: vi.fn(), queueFileCleanup: vi.fn(), retireFileCleanup: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("file cleanup request authorization", () => {
  it.each(["queue", "retire"])("rechecks a suspended session after reading %s request bytes", async (action) => {
    vi.mocked(requireUser).mockReturnValueOnce({ id: "member" } as ReturnType<typeof requireUser>).mockImplementationOnce(() => { throw new ApiError(401, "로그인이 필요합니다."); });
    const request = new Request("http://localhost/api/files/room/file?accountId=member&conversationId=initial-room", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const response = await POST(request, { params: Promise.resolve({ roomId: "room", documentId: "file" }) });
    expect(response.status).toBe(401);
    expect(queueFileCleanup).not.toHaveBeenCalled();
    expect(retireFileCleanup).not.toHaveBeenCalled();
  });
});
