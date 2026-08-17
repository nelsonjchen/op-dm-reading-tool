import { describe, expect, it } from "vitest";
import { normalizeGitRemote, recordedBuildInfo } from "./routeBuild";

describe("recorded route build metadata", () => {
  it("normalizes the comma route API's host/path remote", () => {
    expect(normalizeGitRemote("github.com/sunnypilot/openpilot")).toBe("https://github.com/sunnypilot/openpilot");
  });

  it("normalizes SSH remotes and preserves route branch and commit", () => {
    expect(recordedBuildInfo({
      fullname: "route",
      git_remote: "git@github.com:commaai/openpilot.git",
      git_branch: "release-mici",
      git_commit: "abc123",
    })).toEqual({
      remoteUrl: "https://github.com/commaai/openpilot",
      branch: "release-mici",
      commit: "abc123",
    });
  });

  it("returns no build metadata when the route does not provide it", () => {
    expect(recordedBuildInfo({ fullname: "route" })).toEqual({});
  });
});
