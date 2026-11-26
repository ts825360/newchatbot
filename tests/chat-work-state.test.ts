import { expect, it } from "vitest";
import { resolveWorkConditions, type WorkConditions } from "@/lib/chat-work-state";

it("reuses the same condition model for a schedule, preserving its deadline when an event slot is refreshed", () => {
  type Schedule = { roomSlot: string; deadline: string; duration: number };
  const stored: WorkConditions<Schedule> = {
    roomSlot: { value: "14:00", source: "event", status: "confirmed", revision: "3" },
    deadline: { value: "19:00", source: "user", nature: "required" },
    duration: { value: 45, source: "calculation", status: "candidate" },
  };
  const { active, persistent } = resolveWorkConditions(stored, {
    roomSlot: { value: "16:00", source: "event", revision: "4", status: "confirmed" },
    duration: { value: 60, source: "user", scope: "request", nature: "assumption" },
  });
  expect(active.duration?.value).toBe(60);
  expect(persistent).toEqual({ ...stored, roomSlot: { value: "16:00", source: "event", revision: "4", status: "confirmed" } });
  expect(stored.roomSlot?.value).toBe("14:00");
});
