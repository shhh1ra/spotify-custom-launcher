import { SpotifyTokens, refreshTokens } from "./auth";

const API_ROOT = "https://api.spotify.com/v1";

export async function spotifyFetch<T>(
  path: string,
  tokens: SpotifyTokens,
  init: RequestInit = {},
): Promise<T> {
  const usableTokens =
    tokens.expiresAt - Date.now() < 60_000 ? await refreshTokens(tokens) : tokens;

  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${usableTokens.accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Spotify request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export type SpotifyImage = { url: string; width: number; height: number };
export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  album: { name: string; images: SpotifyImage[] };
  artists: Array<{ name: string }>;
  explicit?: boolean;
  popularity?: number;
};

export type SpotifyDevice = {
  id: string;
  name: string;
  type: string;
  volume_percent: number | null;
  is_active: boolean;
  is_private_session?: boolean;
  is_restricted?: boolean;
};

export type SpotifyUser = {
  display_name: string | null;
  id: string;
  images?: SpotifyImage[];
  product?: string;
};

export type PlaybackState = {
  is_playing: boolean;
  progress_ms: number;
  repeat_state?: "off" | "track" | "context";
  shuffle_state?: boolean;
  item: SpotifyTrack | null;
  device: SpotifyDevice | null;
};

export type SearchTracksResponse = {
  tracks: {
    items: SpotifyTrack[];
  };
};

export async function getMe(tokens: SpotifyTokens) {
  return spotifyFetch<SpotifyUser>("/me", tokens);
}

export async function getPlayback(tokens: SpotifyTokens) {
  return spotifyFetch<PlaybackState>("/me/player", tokens);
}

export async function getDevices(tokens: SpotifyTokens) {
  return spotifyFetch<{ devices: SpotifyDevice[] }>("/me/player/devices", tokens);
}

export async function transferPlayback(
  tokens: SpotifyTokens,
  deviceId: string,
  play = false,
) {
  return spotifyFetch<void>("/me/player", tokens, {
    method: "PUT",
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}

export async function togglePlayback(tokens: SpotifyTokens, isPlaying: boolean) {
  return spotifyFetch<void>(isPlaying ? "/me/player/pause" : "/me/player/play", tokens, {
    method: "PUT",
  });
}

export async function skipNext(tokens: SpotifyTokens) {
  return spotifyFetch<void>("/me/player/next", tokens, { method: "POST" });
}

export async function skipPrevious(tokens: SpotifyTokens) {
  return spotifyFetch<void>("/me/player/previous", tokens, { method: "POST" });
}

export async function seekPlayback(tokens: SpotifyTokens, positionMs: number) {
  const params = new URLSearchParams({ position_ms: String(Math.max(0, positionMs)) });
  return spotifyFetch<void>(`/me/player/seek?${params.toString()}`, tokens, {
    method: "PUT",
  });
}

export async function setPlaybackVolume(tokens: SpotifyTokens, volumePercent: number) {
  const clamped = Math.min(100, Math.max(0, Math.round(volumePercent)));
  const params = new URLSearchParams({ volume_percent: String(clamped) });
  return spotifyFetch<void>(`/me/player/volume?${params.toString()}`, tokens, {
    method: "PUT",
  });
}

export async function setShuffle(tokens: SpotifyTokens, state: boolean) {
  const params = new URLSearchParams({ state: String(state) });
  return spotifyFetch<void>(`/me/player/shuffle?${params.toString()}`, tokens, {
    method: "PUT",
  });
}

export async function setRepeat(
  tokens: SpotifyTokens,
  state: "off" | "track" | "context",
) {
  const params = new URLSearchParams({ state });
  return spotifyFetch<void>(`/me/player/repeat?${params.toString()}`, tokens, {
    method: "PUT",
  });
}

export async function searchTracks(tokens: SpotifyTokens, query: string) {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: "12",
  });
  return spotifyFetch<SearchTracksResponse>(`/search?${params.toString()}`, tokens);
}

export async function playTrack(
  tokens: SpotifyTokens,
  uri: string,
  deviceId?: string | null,
) {
  const params = new URLSearchParams();
  if (deviceId) params.set("device_id", deviceId);

  const suffix = params.size ? `?${params.toString()}` : "";
  return spotifyFetch<void>(`/me/player/play${suffix}`, tokens, {
    method: "PUT",
    body: JSON.stringify({ uris: [uri] }),
  });
}
