# Custom Spotify Client

Cross-platform desktop Spotify client with a custom React UI, dynamic or custom accent color, Spotify Web Playback SDK support where available, and Spotify Connect controller fallback.

## What it does

- Uses your own desktop UI instead of Spotify's native shell.
- Derives the accent color from the current album cover, or uses a saved custom accent from Settings.
- Attempts in-app playback through Spotify Web Playback SDK.
- Falls back to Spotify Connect controls when in-app playback is unavailable.
- Searches Spotify tracks globally and inside loaded playlists.
- Shows Liked Songs and Spotify playlists, with a full-screen track list view and playlist search.
- Loads full playlist track lists for local filtering instead of stopping at the first page.
- Caches playlist metadata, playlist covers, track counts, track image URLs, extracted accent colors, and local artwork blobs for faster visual rendering.
- Preloads the current and next track visuals so album art and background glow switch faster.
- Uses optimistic UI transitions for natural track changes and the next button, then syncs back to Spotify after a short delay.
- Shows a compact "Up next" preview with a local pocket-queue snapshot that updates immediately and later reconciles with Spotify.
- Adds tracks to the Spotify queue from a right-click track menu.
- Adds tracks to playlists and removes tracks from the current playlist or Liked Songs.
- Shows available Spotify Connect devices and lets you transfer playback.
- Supports play/pause, previous/next, seek, volume, shuffle, and repeat controls.
- Includes a lyrics screen shell, ready for a future lyrics provider.
- Includes a Settings dialog with rate-limit guard and custom accent controls.
- Does not access or download raw audio files.
- Uses Spotify Web API + PKCE OAuth, so no client secret is stored in the app.

## Stack

- Electron for cross-platform desktop packaging.
- React + TypeScript + Vite for the UI.
- Spotify Web Playback SDK for Premium-capable in-app playback.
- Spotify Web API for playback state, device discovery, and Connect controls.

## Setup

1. Install Node.js LTS from <https://nodejs.org/>.
2. Create a Spotify app at <https://developer.spotify.com/dashboard>.
3. Add this redirect URI in Spotify dashboard:

   ```text
   http://127.0.0.1:5173/callback
   ```

4. Copy `.env.example` to `.env` and add your Spotify client id.
5. Install dependencies:

   ```bash
   npm install
   ```

6. Start the desktop app:

   ```bash
   npm run dev
   ```

If scopes change during development, sign out in the app and connect Spotify again. Playlist editing requires the `playlist-modify-private`, `playlist-modify-public`, and `user-library-modify` scopes.

## Build

Create a production build:

```bash
npm run build
```

Build a Windows installer:

```bash
npm run dist:win
```

The Windows output is written to `release/`.

## Settings

- Rate limit guard: pauses playlist and search refreshes when Spotify returns `429 Too Many Requests`.
- Custom accent color: replaces the dynamic album-cover accent across the UI, including the background glow and active controls. The selected color is saved locally and restored after restart.
- Borders: toggles accent borders for the app frame, dock, profile button, active sidebar item, and queue panel.

## Local cache and sync

The renderer keeps lightweight UI data in local storage and saves artwork blobs in IndexedDB. This is only for visual speed: album covers, accent colors, playlist metadata, and loaded playlist tracks can be reused without waiting for every Spotify image URL to decode again.

Playback state still comes from Spotify. To avoid slow visual updates between tracks, the app applies an optimistic local transition near the end of a track or when pressing next, updates the pocket queue immediately, and then reconciles with Spotify after the API state has had time to settle.

## Spotify limitations

Spotify does not allow third-party clients to access raw audio files. In-app playback depends on Spotify Web Playback SDK availability and usually requires Spotify Premium. When that path is unavailable, the app still works as a Spotify Connect controller for another active Spotify device.

## License

MIT
