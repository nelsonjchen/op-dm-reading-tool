import { API_BASE_URL } from "./constants";

const AUTH_STORAGE_KEY = "ai.comma.api.authorization";
const LOCAL_OAUTH_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface OAuthProvider {
  label: string;
  url: string;
}

export interface AuthCallbackResult {
  handled: boolean;
  error?: string;
}

export function getAccessToken(): string | null {
  const storage = getStorage();
  return storage?.getItem(AUTH_STORAGE_KEY) ?? null;
}

export function setAccessToken(token: string | null): void {
  const storage = getStorage();
  if (!storage) return;
  const normalized = normalizeAccessToken(token);
  if (!normalized) {
    storage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  storage.setItem(AUTH_STORAGE_KEY, normalized);
}

export function signOut(): void {
  setAccessToken(null);
}

export function isSignedIn(): boolean {
  return !!getAccessToken();
}

export function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { Authorization: `JWT ${token}` } : {};
}

export function getOAuthProviders(): OAuthProvider[] {
  const service = getOAuthService();
  if (!service || !canUseOAuthRedirect(service)) return [];
  return [
    {
      label: "Google",
      url: oauthUrl("https://accounts.google.com/o/oauth2/auth", {
        type: "web_server",
        client_id: "45471411055-ornt4svd2miog6dnopve7qtmh5mnu6id.apps.googleusercontent.com",
        redirect_uri: `${API_BASE_URL}/v2/auth/g/redirect/`,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/userinfo.email",
        prompt: "select_account",
        state: `service,${service}`,
      }),
    },
    {
      label: "GitHub",
      url: oauthUrl("https://github.com/login/oauth/authorize", {
        client_id: "28c4ecb54bb7272cb5a4",
        redirect_uri: `${API_BASE_URL}/v2/auth/h/redirect/`,
        scope: "read:user",
        state: `service,${service}`,
      }),
    },
    {
      label: "Apple",
      url: oauthUrl("https://appleid.apple.com/auth/authorize", {
        client_id: "ai.comma.login",
        redirect_uri: `${API_BASE_URL}/v2/auth/a/redirect/`,
        response_type: "code",
        response_mode: "form_post",
        scope: "name email",
        state: `service,${service}`,
      }),
    },
  ];
}

export function oauthRedirectNote(): string {
  const service = getOAuthService();
  if (service && canUseOAuthRedirect(service)) return "";
  if (!service) {
    return "Private routes need a JWT.";
  }
  return "Private routes need a JWT.";
}

export async function completeAuthCallback(): Promise<AuthCallbackResult> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const provider = params.get("provider");
  if (!code || !provider) return { handled: false };

  try {
    await refreshAccessToken(code, provider);
    removeAuthParamsFromUrl();
    return { handled: true };
  } catch (error) {
    return {
      handled: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refreshAccessToken(code: string, provider: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v2/auth/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ code, provider }),
  });

  if (!response.ok) {
    throw new Error(`Could not exchange comma OAuth code (${response.status}).`);
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("comma OAuth response did not include an access token.");
  }
  setAccessToken(json.access_token);
}

function getOAuthService(): string | null {
  if (typeof window === "undefined") return null;
  if (!["http:", "https:"].includes(window.location.protocol)) return null;
  if (!window.location.host) return null;
  return window.location.host;
}

function canUseOAuthRedirect(service: string): boolean {
  const hostname = service.split(":", 1)[0];
  return LOCAL_OAUTH_HOSTNAMES.has(hostname) || hostname === "connect.comma.ai" || hostname.endsWith(".connect-d5y.pages.dev");
}

function normalizeAccessToken(token: string | null): string | null {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^JWT\s+/i, "");
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof localStorage === "undefined") return null;
  if (
    typeof localStorage.getItem !== "function" ||
    typeof localStorage.setItem !== "function" ||
    typeof localStorage.removeItem !== "function"
  ) {
    return null;
  }
  return localStorage;
}

function oauthUrl(baseUrl: string, params: Record<string, string>): string {
  return `${baseUrl}?${new URLSearchParams(params).toString()}`;
}

function removeAuthParamsFromUrl(): void {
  const basePath = import.meta.env.BASE_URL;
  const url = new URL(basePath, window.location.origin);
  window.history.replaceState({}, "", url);
}
