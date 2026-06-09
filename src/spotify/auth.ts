import { spotifyConfig } from "./config";
import { createCodeChallenge, createCodeVerifier } from "./pkce";

const TOKEN_KEY = "spotify_tokens";
const VERIFIER_KEY = "spotify_pkce_verifier";

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export function getStoredTokens(): SpotifyTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SpotifyTokens;
  } catch {
    clearTokens();
    return null;
  }
}

export function storeTokens(tokens: SpotifyTokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function buildLoginUrl() {
  const verifier = createCodeVerifier();
  const challenge = await createCodeChallenge(verifier);
  localStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: spotifyConfig.clientId,
    scope: spotifyConfig.scopes.join(" "),
    redirect_uri: spotifyConfig.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error("Missing PKCE verifier.");

  const body = new URLSearchParams({
    client_id: spotifyConfig.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: spotifyConfig.redirectUri,
    code_verifier: verifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) throw new Error("Spotify token exchange failed.");
  const payload = await response.json();

  const tokens: SpotifyTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };

  storeTokens(tokens);
  localStorage.removeItem(VERIFIER_KEY);
  return tokens;
}

export async function refreshTokens(tokens: SpotifyTokens) {
  const body = new URLSearchParams({
    client_id: spotifyConfig.clientId,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) throw new Error("Spotify token refresh failed.");
  const payload = await response.json();

  const nextTokens: SpotifyTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };

  storeTokens(nextTokens);
  return nextTokens;
}
