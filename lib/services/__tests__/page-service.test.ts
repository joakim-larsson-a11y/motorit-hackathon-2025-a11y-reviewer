import { describe, expect, it } from "vitest";

import { groupIssuesIntoViolations } from "../page-service";

describe("groupIssuesIntoViolations", () => {
  it("groups issues by rule and preserves severity ordering", () => {
    const result = groupIssuesIntoViolations([
      {
        ruleId: "color-contrast",
        impact: "serious",
        helpUrl: "https://example.com/contrast",
        html: "<div>Foo</div>",
        nodes: {
          target: [".foo"],
          failureSummary: "Element has insufficient contrast"
        }
      },
      {
        ruleId: "color-contrast",
        impact: "serious",
        helpUrl: "https://example.com/contrast",
        html: "<span>Bar</span>",
        nodes: {
          target: [".bar"],
          failureSummary: "Another occurrence"
        }
      },
      {
        ruleId: "label",
        impact: "moderate",
        helpUrl: null,
        html: null,
        nodes: {
          target: ["#input"],
          failureSummary: "Input lacks label"
        }
      }
    ]);

    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].id).toBe("color-contrast");
    expect(result.violations[0].nodes).toHaveLength(2);
    expect(result.violations[1].id).toBe("label");
  });
});
