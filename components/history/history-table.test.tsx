// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HistoryTable, sortHistoryRows, type HistoryRow, type SortDescriptor } from "./history-table";

const sampleRows: HistoryRow[] = [
  {
    id: "run-1",
    createdAt: "2024-01-02T10:00:00.000Z",
    rootUrl: "https://example.com/a",
    status: "COMPLETE_WITH_ISSUES",
    issueTotal: 5
  },
  {
    id: "run-2",
    createdAt: "2024-01-03T12:00:00.000Z",
    rootUrl: "https://example.com/b",
    status: "FAILED",
    issueTotal: 2
  }
];

describe("HistoryTable", () => {
  it("renders table structure that matches snapshot", () => {
    render(
      <HistoryTable
        rows={sampleRows}
        sort={{ column: "date", direction: "desc" }}
        onSort={vi.fn()}
        hasMore={false}
        onShowMore={vi.fn()}
        isLoadingMore={false}
      />
    );

    const headers = screen.getAllByRole("columnheader").map((header) => {
      const button = header.querySelector("button");
      const raw = button?.textContent?.trim() ?? header.textContent?.trim() ?? "";
      return raw.replace(/[-^v]$/, "").trim();
    });

    const bodyRows = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent?.trim())
      );

    expect({ headers, rows: bodyRows }).toMatchInlineSnapshot(`
      {
        "headers": [
          "Date",
          "Page reviewed",
          "Status",
          "Link to audit",
          "Total errors found",
        ],
        "rows": [
          [
            "2024-01-02 10:00",
            "example.com/a",
            "Klar med problem",
            "View audit for example.com/a",
            "5",
          ],
          [
            "2024-01-03 12:00",
            "example.com/b",
            "Misslyckades",
            "View audit for example.com/b",
            "2",
          ],
        ],
      }
    `);
  });

  it("ensures column headers and links have accessible labels", () => {
    render(
      <HistoryTable
        rows={sampleRows}
        sort={{ column: "date", direction: "desc" }}
        onSort={vi.fn()}
        hasMore={true}
        onShowMore={vi.fn()}
        isLoadingMore={false}
      />
    );

    const headers = screen.getAllByRole("columnheader");
    for (const header of headers) {
      expect(header).toHaveAttribute("scope", "col");
    }

    expect(headers[0]).toHaveAttribute("aria-sort", "desc");

    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link).toHaveAccessibleName(/^View audit for /);
    }
  });
});

describe("sortHistoryRows", () => {
  it("sorts by total errors ascending", () => {
    const sort: SortDescriptor = { column: "errors", direction: "asc" };
    const result = sortHistoryRows(sampleRows, sort);
    expect(result.map((row) => row.id)).toEqual(["run-2", "run-1"]);
  });

  it("sorts by date descending", () => {
    const sort: SortDescriptor = { column: "date", direction: "desc" };
    const result = sortHistoryRows(sampleRows, sort);
    expect(result.map((row) => row.id)).toEqual(["run-2", "run-1"]);
  });
});
