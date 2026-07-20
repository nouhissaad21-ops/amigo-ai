import { describe, expect, it } from "vitest";
import {
  INSTAGRAM_CONVERSATION_MESSAGE_FIELDS,
  INSTAGRAM_MESSAGE_DETAIL_FIELDS,
} from "./instagram-poller.js";

describe("Instagram polling Graph fields", () => {
  it("lists lightweight messages before fetching their details", () => {
    expect(INSTAGRAM_CONVERSATION_MESSAGE_FIELDS).toBe(
      "messages.limit(20){id,created_time,is_unsupported}",
    );
    expect(INSTAGRAM_CONVERSATION_MESSAGE_FIELDS).not.toContain("text");
  });

  it("uses Meta's message field for the actual message body", () => {
    expect(INSTAGRAM_MESSAGE_DETAIL_FIELDS).toBe(
      "id,created_time,from,to,message",
    );
    expect(INSTAGRAM_MESSAGE_DETAIL_FIELDS).not.toContain("text");
  });
});
