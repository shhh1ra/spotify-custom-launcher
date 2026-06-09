# Custom Spotify Client

Cross-platform desktop Spotify client with a custom React UI, dynamic accent color, Spotify Web Playback SDK support where available, and Spotify Connect controller fallback.

## What it does

- Uses your own desktop UI instead of Spotify's native shell.
- Derives the accent color from the current album cover.
- Attempts in-app playback through Spotify Web Playback SDK.
- Falls back to Spotify Connect controls when in-app playback is unavailable.
- Searches Spotify tracks and starts playback on the in-app player or active Connect device.
- Shows available Spotify Connect devices and lets you transfer playback.
- Supports play/pause, previous/next, seek, volume, shuffle, and repeat controls.
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
   npm run electron:dev
   ```

## Spotify limitations

Spotify does not allow third-party clients to access raw audio files. In-app playback depends on Spotify Web Playback SDK availability and usually requires Spotify Premium. When that path is unavailable, the app still works as a Spotify Connect controller for another active Spotify device.

## License

MIT
