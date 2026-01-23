import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { fetchAndFormatPrDiff } from "./checkout.ts";

describe("fetchAndFormatPrDiff", () => {
  it("fetches PR files and generates TOC with formatted diff", async () => {
    const token = process.env.GH_TOKEN;
    if (!token) {
      throw new Error("GH_TOKEN not set in .env");
    }

    const octokit = new Octokit({ auth: token });
    const result = await fetchAndFormatPrDiff({
      octokit,
      owner: "pullfrog",
      repo: "scratch",
      pullNumber: 49,
    });

    // verify TOC structure
    expect(result.toc).toContain("## Files");
    expect(result.toc).toContain("→ lines");

    // verify content includes TOC at the start
    expect(result.content.startsWith(result.toc)).toBe(true);

    // verify content includes diff headers
    expect(result.content).toContain("diff --git");
    expect(result.content).toContain("---");
    expect(result.content).toContain("+++");

    // snapshot the full output
    expect(result.toc).toMatchSnapshot("toc");
    expect(result.content).toMatchSnapshot("content");
  });
});
