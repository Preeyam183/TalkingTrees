import { describe, expect, it } from "vitest";
import {
  chatSchema,
  decodeBase64,
  connectionMessage,
} from "../packages/shared/src/index";

describe("native upload and conversation boundaries", () => {
  it("preserves image/audio bytes without fetching a local file URI", () => {
    for (const data of [
      Buffer.from([0, 255, 17, 128, 34]),
      Buffer.from("a"),
      Buffer.from("ab"),
      Buffer.from("abc"),
      Buffer.alloc(0),
    ]) {
      expect(Buffer.from(decodeBase64(data.toString("base64")))).toEqual(data);
    }
    expect(() => decodeBase64("not%base64")).toThrow();
  });
  it("rejects unbounded chat history and caller-supplied identity or points", () => {
    const body = {
      tree_id: "40000000-0000-4000-8000-000000000001",
      message: "How are you?",
    };
    expect(chatSchema.parse(body).history).toEqual([]);
    expect(
      chatSchema.safeParse({ ...body, player_id: "other", points: 100 })
        .success,
    ).toBe(false);
    expect(
      chatSchema.safeParse({
        ...body,
        history: Array(13).fill({ role: "user", content: "hello" }),
      }).success,
    ).toBe(false);
    expect(chatSchema.safeParse({ ...body, message: " " }).success).toBe(false);
  });
  it("turns an opaque native network error into an actionable endpoint message", () => {
    expect(
      connectionMessage(
        new Error("Network request failed"),
        "http://127.0.0.1:54321",
      ),
    ).toContain("localhost points to the phone");
    expect(
      connectionMessage(
        new Error("Invalid login credentials"),
        "https://example.supabase.co",
      ),
    ).toBe("Invalid login credentials");
  });
});
