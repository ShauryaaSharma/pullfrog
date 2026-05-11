import { describe, expect, it } from "vitest";
import type { ToolState } from "../toolState.ts";
import { getUnsubmittedReview } from "./postRun.ts";

function makeToolState(overrides: Partial<ToolState> = {}): ToolState {
  return {
    progressComment: undefined,
    hadProgressComment: true,
    backgroundProcesses: new Map(),
    usageEntries: [],
    ...overrides,
  };
}

describe("getUnsubmittedReview", () => {
  it("returns null when mode is not a review mode", () => {
    expect(getUnsubmittedReview(makeToolState({ selectedMode: "Build" }))).toBeNull();
    expect(getUnsubmittedReview(makeToolState())).toBeNull();
  });

  it("returns null when a review was already submitted", () => {
    expect(
      getUnsubmittedReview(
        makeToolState({
          selectedMode: "Review",
          review: { id: 1, nodeId: "n", reviewedSha: undefined },
        })
      )
    ).toBeNull();
  });

  it("returns null when report_progress wrote a final summary", () => {
    expect(
      getUnsubmittedReview(makeToolState({ selectedMode: "Review", finalSummaryWritten: true }))
    ).toBeNull();
  });

  it("returns null when there is no progress comment to anchor the failure to", () => {
    expect(
      getUnsubmittedReview(makeToolState({ selectedMode: "Review", hadProgressComment: false }))
    ).toBeNull();
  });

  it("returns the selected mode when the gate should fire", () => {
    expect(getUnsubmittedReview(makeToolState({ selectedMode: "Review" }))).toBe("Review");
    expect(getUnsubmittedReview(makeToolState({ selectedMode: "IncrementalReview" }))).toBe(
      "IncrementalReview"
    );
  });
});
