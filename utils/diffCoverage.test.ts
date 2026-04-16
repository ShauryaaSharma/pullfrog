import { describe, expect, it } from "vitest";
import {
  createDiffCoverageState,
  getDiffCoverageBreakdown,
  recordDiffReadFromToolUse,
} from "./diffCoverage.ts";

const diffPath = "/tmp/pr-1.diff";
const toc = `## Files (2)
- src/a.ts → lines 5-10
- yarn.lock → lines 12-20

---
`;

describe("diff coverage line checker", () => {
  it("treats Read offsets as zero based", () => {
    const state = createDiffCoverageState({
      diffPath,
      totalLines: 30,
      toc,
    });

    const tracked = recordDiffReadFromToolUse({
      state,
      toolName: "Read",
      input: {
        filePath: diffPath,
        offset: 0,
        limit: 3,
      },
      cwd: "/",
    });

    expect(tracked).toBe(true);
    const breakdown = getDiffCoverageBreakdown({ state });
    expect(breakdown.coveredRanges).toEqual([{ startLine: 1, endLine: 3 }]);
  });

  it("treats ReadFile offsets as one based", () => {
    const state = createDiffCoverageState({
      diffPath,
      totalLines: 30,
      toc,
    });

    const tracked = recordDiffReadFromToolUse({
      state,
      toolName: "ReadFile",
      input: {
        path: diffPath,
        offset: 1,
        limit: 2,
      },
      cwd: "/",
    });

    expect(tracked).toBe(true);
    const breakdown = getDiffCoverageBreakdown({ state });
    expect(breakdown.coveredRanges).toEqual([{ startLine: 1, endLine: 2 }]);
  });

  it("supports negative offsets from file end", () => {
    const state = createDiffCoverageState({
      diffPath,
      totalLines: 30,
      toc,
    });

    const tracked = recordDiffReadFromToolUse({
      state,
      toolName: "Read",
      input: {
        path: diffPath,
        offset: -2,
        limit: 2,
      },
      cwd: "/",
    });

    expect(tracked).toBe(true);
    const breakdown = getDiffCoverageBreakdown({ state });
    expect(breakdown.coveredRanges).toEqual([{ startLine: 29, endLine: 30 }]);
  });

  it("computes per-file unread ranges from tracked reads", () => {
    const state = createDiffCoverageState({
      diffPath,
      totalLines: 30,
      toc,
    });

    recordDiffReadFromToolUse({
      state,
      toolName: "Read",
      input: {
        path: diffPath,
        start_line: 5,
        end_line: 6,
      },
      cwd: "/",
    });

    recordDiffReadFromToolUse({
      state,
      toolName: "Read",
      input: {
        path: diffPath,
        start_line: 12,
        end_line: 14,
      },
      cwd: "/",
    });

    const breakdown = getDiffCoverageBreakdown({ state });
    const firstFile = breakdown.files[0];
    const secondFile = breakdown.files[1];

    expect(firstFile.filename).toBe("src/a.ts");
    expect(firstFile.coveredRanges).toEqual([{ startLine: 5, endLine: 6 }]);
    expect(firstFile.unreadRanges).toEqual([{ startLine: 7, endLine: 10 }]);

    expect(secondFile.filename).toBe("yarn.lock");
    expect(secondFile.coveredRanges).toEqual([{ startLine: 12, endLine: 14 }]);
    expect(secondFile.unreadRanges).toEqual([{ startLine: 15, endLine: 20 }]);
  });
});
