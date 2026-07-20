import { describe, expect, it } from "vitest";
import { audioAttachmentUrl } from "./media-intelligence.js";

describe("audioAttachmentUrl", () => {
  it("extracts Messenger and Instagram audio attachment URLs", () => {
    expect(
      audioAttachmentUrl({
        message: {
          attachments: [
            {
              type: "audio",
              payload: { url: "https://cdn.example.com/customer.ogg" },
            },
          ],
        },
      }),
    ).toBe("https://cdn.example.com/customer.ogg");
  });

  it("accepts voice attachments and rejects non-HTTPS media", () => {
    expect(
      audioAttachmentUrl({
        attachments: [
          { type: "voice", payload: { url: "https://cdn.example.com/note.m4a" } },
        ],
      }),
    ).toBe("https://cdn.example.com/note.m4a");
    expect(
      audioAttachmentUrl({
        message: {
          attachments: [
            { type: "audio", payload: { url: "http://unsafe.example.com/a.ogg" } },
          ],
        },
      }),
    ).toBeUndefined();
  });

  it("ignores images and unrelated attachments", () => {
    expect(
      audioAttachmentUrl({
        message: {
          attachments: [
            { type: "image", payload: { url: "https://cdn.example.com/photo.jpg" } },
          ],
        },
      }),
    ).toBeUndefined();
  });
});
