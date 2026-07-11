import { beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, checkAccessToken, completeAuthCallback, getAccessToken, getOAuthProviders, oauthRedirectNote, setAccessToken, signOut } from "./auth";

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

  it("verifies a persisted JWT against comma", async () => {
    setAccessToken("test-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ identity: "test" }), { status: 200 })));

    await expect(checkAccessToken()).resolves.toEqual({ status: "valid" });
    expect(fetch).toHaveBeenCalledWith("https://api.comma.ai/v1/me/", {
      headers: { Authorization: "JWT test-token" },
    });
  });

  it("distinguishes rejected JWTs from temporary auth-check errors", async () => {
    setAccessToken("test-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    await expect(checkAccessToken()).resolves.toEqual({ status: "invalid", httpStatus: 401 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    await expect(checkAccessToken()).resolves.toEqual({ status: "error", message: "comma auth check failed (503)." });
  });

  it("does not call comma when no JWT is stored", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkAccessToken()).resolves.toEqual({ status: "missing" });
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(providers[0].url).not.toContain("op-dm-reading-tool");
  });

  it("removes OAuth callback params without discarding a shared route", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "example.test",
        host: "example.test",
        origin: "https://example.test",
        search: "?code=abc&provider=g&route=5beb9b58bd12b691%7C0000010a--a51155e496",
        href: "https://example.test/?code=abc&provider=g&route=5beb9b58bd12b691%7C0000010a--a51155e496",
      },
      history: {
        replaceState,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 })),
    );

    await expect(completeAuthCallback()).resolves.toEqual({ handled: true });

    expect(getAccessToken()).toBe("test-token");
    expect(replaceState).toHaveBeenCalledWith({}, "", "https://example.test/?route=5beb9b58bd12b691%7C0000010a--a51155e496");
  });
});
