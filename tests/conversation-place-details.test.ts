import { expect, it } from "vitest";
import { conversationPlaceDetails, isConversationPlaceRecord, readConversationPlaces } from "../lib/conversation-places";

it("looks up only the confirmed exact venue and supports saved overrides", () => {
  const name = "한화리조트 대천 파로스";
  expect(conversationPlaceDetails(name)?.address).toBe("충청남도 보령시 해수욕장3길 11-10");
  expect(conversationPlaceDetails("한화리조트")).toBeUndefined();
  const record = { location: name, places: [name], details: [{ name, address: "검증한 주소", notes: "단체 집결은 정문" }] };
  expect(isConversationPlaceRecord(record)).toBe(true);
  expect(conversationPlaceDetails(name, record.details)?.address).toBe("검증한 주소");
  expect(readConversationPlaces(record)).toEqual([name]);
});
