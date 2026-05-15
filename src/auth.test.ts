import { beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, getAccessToken, getOAuthProviders, oauthRedirectNote, setAccessToken, signOut } from "./auth";

describe("comma auth token storage", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.unstubAllGlobals();
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
  });

  it("stores comma JWTs without a duplicated JWT prefix", () => {
    setAccessToken("JWT test-token");

    expect(getAccessToken()).toBe("test-token");
    expect(authHeaders()).toEqual({ Authorization: "JWT test-token" });
  });

  it("removes blank tokens", () => {
    setAccessToken("test-token");
    setAccessToken(" ");

    expect(getAccessToken()).toBeNull();
    expect(authHeaders()).toEqual({});
  });

  it("signs out", () => {
    setAccessToken("test-token");
    signOut();

    expect(getAccessToken()).toBeNull();
  });

  it("does not build OAuth links from file URLs", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "file:",
        hostname: "",
        host: "",
      },
    });

    expect(getOAuthProviders()).toEqual([]);
    expect(oauthRedirectNote()).toBe("Private routes need a JWT.");
  });

  it("builds OAuth links for localhost with a non-empty service", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        hostname: "localhost",
        host: "localhost:5173",
      },
    });

    const providers = getOAuthProviders();

    expect(providers).toHaveLength(3);
    expect(providers[0].url).toContain("state=service%2Clocalhost%3A5173");
    expect(providers[0].url).not.toContain("state=service%2C&");
  });

  it("hides OAuth links for custom domains rejected by comma", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "opcal.mindflakes.com",
        host: "opcal.mindflakes.com",
      },
    });

    expect(getOAuthProviders()).toEqual([]);
    expect(oauthRedirectNote()).toBe("Private routes need a JWT.");
  });

  it("builds OAuth links for comma Connect Pages hosts", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "new-connect.connect-d5y.pages.dev",
        host: "new-connect.connect-d5y.pages.dev",
      },
    });

    const providers = getOAuthProviders();

    expect(providers).toHaveLength(3);
    expect(providers[0].url).toContain("state=service%2Cnew-connect.connect-d5y.pages.dev");
    expect(providers[0].url).not.toContain("op-calibration-reading-tool");
  });
});
