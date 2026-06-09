import { getStoredTokens, refreshTokens, SpotifyTokens } from "./auth";

export type WebPlaybackDevice = {
  deviceId: string;
  player: Spotify.Player;
};

export async function loadWebPlaybackSdk() {
  if (window.Spotify?.Player) return;

  await new Promise<void>((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);
  });
}

export async function createWebPlaybackDevice(
  tokens: SpotifyTokens,
  onState: (state: Spotify.WebPlaybackState) => void,
) {
  await loadWebPlaybackSdk();

  return new Promise<WebPlaybackDevice>((resolve, reject) => {
    const player = new Spotify.Player({
      name: "Custom Spotify Client",
      getOAuthToken: (callback) => {
        const storedTokens = getStoredTokens() ?? tokens;
        if (storedTokens.expiresAt - Date.now() < 60_000) {
          refreshTokens(storedTokens)
            .then((nextTokens) => callback(nextTokens.accessToken))
            .catch(() => callback(storedTokens.accessToken));
          return;
        }

        callback(storedTokens.accessToken);
      },
      volume: 0.75,
    });

    player.addListener("ready", ({ device_id }: { device_id: string }) => {
      resolve({ deviceId: device_id, player });
    });

    player.addListener("player_state_changed", (state: Spotify.WebPlaybackState) => {
      if (state) onState(state);
    });

    player.addListener("initialization_error", reject);
    player.addListener("authentication_error", reject);
    player.addListener("account_error", reject);
    player.addListener("playback_error", reject);

    player.connect().then((connected) => {
      if (!connected) reject(new Error("Spotify Web Playback SDK connection failed."));
    });
  });
}
