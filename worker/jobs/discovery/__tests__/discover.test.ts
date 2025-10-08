import { describe, expect, it } from "vitest";

import { __testables } from "../../discover";

describe("discover internals", () => {
  describe("isSameOrigin", () => {
    it("treats www-prefixed hosts as same origin", () => {
      const origin = new URL("https://www.useit.se");
      expect(__testables.isSameOrigin("https://useit.se/om-useit/", origin)).toBe(true);
      expect(__testables.isSameOrigin("https://www.useit.se/kontakt", origin)).toBe(true);
    });

    it("rejects different protocols or hosts", () => {
      const origin = new URL("https://www.useit.se");
      expect(__testables.isSameOrigin("http://www.useit.se", origin)).toBe(false);
      expect(__testables.isSameOrigin("https://blog.useit.se", origin)).toBe(false);
    });
  });
});
