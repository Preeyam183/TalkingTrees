import { describe, expect, it } from "vitest";
import {
  treeSettingsSchema,
  treeCareGuide,
} from "../packages/shared/src/index";
describe("tree settings and camera care", () => {
  it("rejects empty names, malformed voices and unauthorized mutation fields", () => {
    const valid = {
      tree_id: "b7000000-0000-4000-8000-000000000001",
      name: "  Birch friend  ",
      voice_id: null,
    };
    expect(treeSettingsSchema.parse(valid).name).toBe("Birch friend");
    expect(treeSettingsSchema.safeParse({ ...valid, name: " " }).success).toBe(
      false,
    );
    expect(
      treeSettingsSchema.safeParse({ ...valid, voice_id: "../../secret" })
        .success,
    ).toBe(false);
    expect(
      treeSettingsSchema.safeParse({ ...valid, owner_id: "other" }).success,
    ).toBe(false);
  });
  it("keeps uncertain photo matches from triggering species-specific instructions", () => {
    expect(treeCareGuide("Acer palmatum").title).toContain("Japanese maple");
    const uncertain = treeCareGuide("Acer palmatum", true);
    expect(uncertain.title).not.toContain("Japanese maple");
    expect(uncertain.steps[0]).toContain("Confirm");
    expect(uncertain.steps.join(" ")).toContain("eligible care session");
    expect(uncertain.note).toContain("do not diagnose");
  });
});
