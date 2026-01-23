import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import {
  buildThreadBlocks,
  formatReviewThreads,
  type ParsedHunk,
  parseFilePatches,
  REVIEW_THREADS_QUERY,
  type ReviewThread,
  type ReviewThreadsQueryResponse,
} from "./reviewComments.ts";

describe("formatReviewThreads", () => {
  it("formats thread blocks with TOC and correct line numbers", async () => {
    const token = process.env.GH_TOKEN;
    if (!token) {
      throw new Error("GH_TOKEN is not set");
    }

    const octokit = new Octokit({ auth: token });
    const pullNumber = 49;
    const reviewId = 3485940013;

    // fetch review threads via GraphQL
    const response = await octokit.graphql<ReviewThreadsQueryResponse>(REVIEW_THREADS_QUERY, {
      owner: "pullfrog",
      name: "scratch",
      prNumber: pullNumber,
    });

    const allThreads = response.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    const threadsForReview = allThreads.filter((thread): thread is ReviewThread => {
      if (!thread?.comments?.nodes) return false;
      return thread.comments.nodes.some((c) => c?.pullRequestReview?.databaseId === reviewId);
    });

    // fetch file patches
    const prFilesResponse = await octokit.rest.pulls.listFiles({
      owner: "pullfrog",
      repo: "scratch",
      pull_number: pullNumber,
    });
    const filePatchMap = new Map<string, ParsedHunk[]>();
    for (const file of prFilesResponse.data) {
      if (file.patch) {
        filePatchMap.set(file.filename, parseFilePatches(file.patch));
      }
    }

    // build and format
    const { threadBlocks, reviewer } = buildThreadBlocks(threadsForReview, filePatchMap, reviewId);
    const result = formatReviewThreads(threadBlocks, { pullNumber, reviewId, reviewer });

    expect(result.toc).toMatchSnapshot("toc");
    expect(result.content).toMatchSnapshot("content");
  });
});
