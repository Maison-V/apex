const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "";
const DERIV_REDIRECT_URI =
  process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI || "https://apex-celestial.vercel.app/oauth/callback";
const DERIV_AUTH_URL = "https://oauth.deriv.com/oauth2/authorize";

interface OAuthListenEvent {
  type: string;
  info?: unknown;
}

type OAuthListener = (data: OAuthListenEvent) => void;

class OAuthService {
  private token: string | null = null;
  private accountInfo: unknown = null;
  private listeners = new Set<OAuthListener>();

  constructor() {
    if (!DERIV_APP_ID) {
      console.warn("NEXT_PUBLIC_DERIV_APP_ID not set — Deriv OAuth login will not work. Set it in Vercel env vars.");
    }
  }

  get appId(): string {
    return DERIV_APP_ID;
  }

  isConfigured(): boolean {
    return !!DERIV_APP_ID;
  }

  async login() {
    if (!DERIV_APP_ID) {
      alert("Deriv OAuth is not configured yet. The site admin needs to set NEXT_PUBLIC_DERIV_APP_ID.");
      return;
    }
    const state = crypto.randomUUID();
    sessionStorage.setItem("deriv_oauth_state", state);
    sessionStorage.removeItem("deriv_code_verifier");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: DERIV_APP_ID,
      redirect_uri: DERIV_REDIRECT_URI,
      state,
    });
    window.location.href = `${DERIV_AUTH_URL}?${params}`;
  }

  logout() {
    this.token = null;
    this.accountInfo = null;
    localStorage.removeItem("deriv_oauth_token");
    sessionStorage.removeItem("deriv_code_verifier");
    sessionStorage.removeItem("deriv_oauth_state");
    this.notify({ type: "logout" });
  }

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string) {
    this.token = token;
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  setAccountInfo(info: unknown) {
    this.accountInfo = info;
    this.notify({ type: "account", info });
  }

  getAccountInfo(): unknown {
    return this.accountInfo;
  }

  subscribe(fn: OAuthListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(data: OAuthListenEvent) {
    this.listeners.forEach((fn) => fn(data));
  }
}

export const oauthService = new OAuthService();