import { describe, expect, it } from "vitest";
import { runConformanceSuite } from "@supersemantics/vsl-core";
import { LangGraphAdapter } from "../src/adapter.js";

describe("LangGraphAdapter", () => {
  it("is fully conformant -- runConformanceSuite returns no failures", async () => {
    const failures = await runConformanceSuite(new LangGraphAdapter());
    expect(failures).toEqual([]);
  });
});
