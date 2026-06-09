import {
  Laptop,
  ListMusic,
  LogIn,
  MonitorSpeaker,
  Pause,
  Play,
  Rows3,
  Repeat,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildLoginUrl,
  clearTokens,
  exchangeCodeForTokens,
  getStoredTokens,
  SpotifyTokens,
} from "../spotify/auth";
import {
  getDevices,
  getMyPlaylists,
  getMe,
  getPlaylistTracks,
  getPlayback,
  getSavedTracks,
  playContext,
  playTrack,
  PlaylistSummary,
  PlaylistTrack,
  PlaybackState,
  searchTracks,
  seekPlayback,
  setPlaybackVolume,
  setRepeat,
  setShuffle,
  skipNext,
  skipPrevious,
  SpotifyDevice,
  SpotifyTrack,
  SpotifyUser,
  togglePlayback,
  transferPlayback,
} from "../spotify/api";
import { createWebPlaybackDevice, WebPlaybackDevice } from "../spotify/webPlayback";
import { spotifyConfig } from "../spotify/config";
import { useAccent } from "./useAccent";

type View = "now" | "playlists" | "search" | "devices";

function formatTime(ms = 0) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function bestImage(track?: SpotifyTrack | null) {
  return track?.album.images?.[0]?.url;
}

function playlistImage(playlist: PlaylistSummary) {
  return playlist.image;
}

function rangeStyle(percent: number) {
  return { "--range-fill": `${Math.min(100, Math.max(0, percent))}%` } as React.CSSProperties;
}

export function App() {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(() => getStoredTokens());
  const [profile, setProfile] = useState<SpotifyUser | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [webDevice, setWebDevice] = useState<WebPlaybackDevice | null>(null);
  const [status, setStatus] = useState("Ready");
  const [view, setView] = useState<View>("now");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistSummary | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrack[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);

  const track = playback?.item ?? null;
  const cover = bestImage(track);
  const accent = useAccent(cover);

  const artists = useMemo(
    () => track?.artists.map((artist) => artist.name).join(", ") ?? "No active track",
    [track],
  );

  const activeDeviceId = playback?.device?.id ?? devices.find((device) => device.is_active)?.id;
  const targetDeviceId = webDevice?.deviceId ?? activeDeviceId;
  const volume = playback?.device?.volume_percent ?? 75;
  const duration = track?.duration_ms ?? 0;
  const progressPercent = duration ? (localProgress / duration) * 100 : 0;

  async function refreshState(nextTokens = tokens) {
    if (!nextTokens) return;
    const [nextPlayback, nextDevices] = await Promise.all([
      getPlayback(nextTokens),
      getDevices(nextTokens),
    ]);
    setPlayback(nextPlayback ?? null);
    setDevices(nextDevices.devices);
    setLocalProgress(nextPlayback?.progress_ms ?? 0);
    setStatus(nextPlayback?.device ? "Connected" : "Choose a Spotify device");
  }

  async function loadPlaylists(nextTokens = tokens) {
    if (!nextTokens) return;
    setLoadingPlaylists(true);
    try {
      const [savedTracks, myPlaylists] = await Promise.all([
        getSavedTracks(nextTokens, 1),
        getMyPlaylists(nextTokens),
      ]);
      const playlistItems = myPlaylists?.items ?? [];

      const likedSongs: PlaylistSummary = {
        id: "liked",
        name: "Liked Songs",
        description: "Saved tracks",
        owner: profile?.display_name ?? "You",
        total: savedTracks?.total ?? 0,
        kind: "liked",
      };

      setPlaylists([
        likedSongs,
        ...playlistItems.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          uri: playlist.uri,
          description: playlist.description,
          image: playlist.images?.[0]?.url,
          owner: playlist.owner?.display_name ?? playlist.owner?.id ?? "Unknown",
          total: playlist.tracks?.total ?? 0,
          kind: "playlist" as const,
        })),
      ]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Playlists unavailable");
    } finally {
      setLoadingPlaylists(false);
    }
  }

  async function openPlaylist(playlist: PlaylistSummary) {
    if (!tokens) return;
    setSelectedPlaylist(playlist);
    setView("playlists");
    setLoadingPlaylists(true);
    try {
      const response =
        playlist.kind === "liked"
          ? await getSavedTracks(tokens, 50)
          : await getPlaylistTracks(tokens, playlist.id, 100);
      setPlaylistTracks((response?.items ?? []).filter((item) => item.track?.uri));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Playlist tracks unavailable");
      setPlaylistTracks([]);
    } finally {
      setLoadingPlaylists(false);
    }
  }

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code || tokens) return;

    exchangeCodeForTokens(code)
      .then(async (nextTokens) => {
        setTokens(nextTokens);
        window.history.replaceState({}, document.title, "/");
        setProfile(await getMe(nextTokens));
        await loadPlaylists(nextTokens);
        await refreshState(nextTokens);
      })
      .catch(() => setStatus("Login failed"));
  }, [tokens]);

  useEffect(() => {
    if (!tokens) return;

    let active = true;
    getMe(tokens)
      .then((nextProfile) => {
        if (active) setProfile(nextProfile);
      })
      .catch(() => setStatus("Profile unavailable"));
    void loadPlaylists(tokens);

    const poll = async () => {
      try {
        await refreshState(tokens);
      } catch (error) {
        if (!active) return;
        setStatus(error instanceof Error ? error.message : "Waiting for Spotify");
      }
    };

    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [tokens]);

  useEffect(() => {
    if (!playback?.is_playing || !duration) return;

    const timer = window.setInterval(() => {
      setLocalProgress((progress) => Math.min(duration, progress + 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [duration, playback?.is_playing]);

  useEffect(() => {
    if (!tokens || webDevice) return;

    createWebPlaybackDevice(tokens, (state) => {
      const current = state.track_window.current_track;
      setPlayback((previous) => ({
        is_playing: !state.paused,
        progress_ms: state.position,
        repeat_state: previous?.repeat_state,
        shuffle_state: previous?.shuffle_state,
        item: {
          id: current.id,
          name: current.name,
          uri: current.uri,
          duration_ms: state.duration,
          album: current.album,
          artists: current.artists,
        },
        device: {
          id: "web-playback",
          name: "This app",
          type: "Computer",
          volume_percent: volume,
          is_active: true,
        },
      }));
      setLocalProgress(state.position);
    })
      .then((device) => {
        setWebDevice(device);
        setStatus("In-app playback ready");
      })
      .catch(() => setStatus("Connect fallback ready"));
  }, [tokens, volume, webDevice]);

  useEffect(() => {
    if (!tokens || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchTracks(tokens, query.trim())
        .then((response) => {
          if (active) setResults(response.tracks.items);
        })
        .catch(() => {
          if (active) setStatus("Search unavailable");
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 280);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, tokens]);

  async function login() {
    if (!spotifyConfig.clientId) {
      setStatus("Add Spotify client id to .env");
      return;
    }
    window.location.href = await buildLoginUrl();
  }

  async function run(action: () => Promise<void>, message = "Updating playback") {
    if (!tokens) return;
    setBusy(true);
    setStatus(message);
    try {
      await action();
      await refreshState(tokens);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Spotify command failed");
    } finally {
      setBusy(false);
    }
  }

  function control(action: "toggle" | "next" | "previous") {
    if (!tokens || !playback) return;
    void run(async () => {
      if (action === "toggle") await togglePlayback(tokens, playback.is_playing);
      if (action === "next") await skipNext(tokens);
      if (action === "previous") await skipPrevious(tokens);
    });
  }

  function transfer(deviceId: string, play = false) {
    if (!tokens) return;
    void run(() => transferPlayback(tokens, deviceId, play), "Switching device");
  }

  function play(trackToPlay: SpotifyTrack) {
    if (!tokens) return;
    void run(
      async () => {
        if (webDevice?.deviceId && activeDeviceId !== webDevice.deviceId) {
          await transferPlayback(tokens, webDevice.deviceId, false);
        }
        await playTrack(tokens, trackToPlay.uri, targetDeviceId);
      },
      `Playing ${trackToPlay.name}`,
    );
    setView("now");
  }

  function playPlaylist(playlist: PlaylistSummary) {
    if (!tokens) return;
    void run(
      async () => {
        if (webDevice?.deviceId && activeDeviceId !== webDevice.deviceId) {
          await transferPlayback(tokens, webDevice.deviceId, false);
        }

        if (playlist.kind === "playlist" && playlist.uri) {
          await playContext(tokens, playlist.uri, targetDeviceId);
          return;
        }

        const firstSaved = playlistTracks.find((item) => item.track?.uri)?.track;
        if (firstSaved) await playTrack(tokens, firstSaved.uri, targetDeviceId);
      },
      `Playing ${playlist.name}`,
    );
    setView("now");
  }

  function seek(value: number) {
    if (!tokens) return;
    setLocalProgress(value);
    void run(() => seekPlayback(tokens, value), "Seeking");
  }

  function changeVolume(value: number) {
    if (!tokens) return;
    setPlayback((previous) =>
      previous?.device
        ? { ...previous, device: { ...previous.device, volume_percent: value } }
        : previous,
    );
    void run(() => setPlaybackVolume(tokens, value), "Changing volume");
  }

  function cycleRepeat() {
    if (!tokens || !playback) return;
    const next =
      playback.repeat_state === "off"
        ? "context"
        : playback.repeat_state === "context"
          ? "track"
          : "off";
    void run(() => setRepeat(tokens, next), "Changing repeat");
  }

  const signedIn = Boolean(tokens);

  return (
    <main
      className="shell"
      style={
        {
          "--accent": accent.primary,
          "--accent-muted": accent.muted,
        } as React.CSSProperties
      }
    >
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" />
          <span>Custom Spotify</span>
        </div>
        <button
          className={view === "now" ? "nav active" : "nav"}
          title="Now playing"
          onClick={() => setView("now")}
        >
          <ListMusic size={20} />
          Now
        </button>
        <button
          className={view === "playlists" ? "nav active" : "nav"}
          title="Playlists"
          onClick={() => {
            setView("playlists");
            setSelectedPlaylist(null);
          }}
        >
          <Rows3 size={20} />
          Playlists
        </button>
        <button
          className={view === "search" ? "nav active" : "nav"}
          title="Search"
          onClick={() => setView("search")}
        >
          <Search size={20} />
          Search
        </button>
        <button
          className={view === "devices" ? "nav active" : "nav"}
          title="Devices"
          onClick={() => setView("devices")}
        >
          <MonitorSpeaker size={20} />
          Devices
        </button>
        <div className="rail-footer">
          <p>{profile?.display_name ?? "Not connected"}</p>
          {signedIn ? (
            <button
              className="ghost"
              onClick={() => {
                clearTokens();
                setTokens(null);
                setProfile(null);
                setPlayback(null);
                setDevices([]);
                setWebDevice(null);
                setPlaylists([]);
                setSelectedPlaylist(null);
                setPlaylistTracks([]);
              }}
            >
              Sign out
            </button>
          ) : (
            <button className="primary" onClick={login}>
              <LogIn size={18} />
              Connect Spotify
            </button>
          )}
        </div>
      </aside>

      <section className="stage">
        <header className="topbar">
          <span>{status}</span>
          <span>{playback?.device?.name ?? window.desktop?.platform ?? "desktop"}</span>
        </header>

        {view === "now" && (
          <section className="now-playing">
            <div className="cover-wrap">
              {cover ? <img src={cover} alt="" /> : <div className="cover-placeholder" />}
            </div>
            <div className="track-copy">
              <p>{track?.album.name ?? "No album selected"}</p>
              <h1>{track?.name ?? "Play something in Spotify"}</h1>
              <h2>{artists}</h2>
              {!signedIn && (
                <button className="hero-action" onClick={login}>
                  <LogIn size={18} />
                  Connect Spotify
                </button>
              )}
            </div>
          </section>
        )}

        {view === "playlists" && (
          <section className="playlists-view">
            {!selectedPlaylist ? (
              <>
                <div className="section-heading">
                  <div>
                    <p>Library</p>
                    <h2>Playlists</h2>
                  </div>
                  <button
                    className="ghost compact"
                    onClick={() => void loadPlaylists(tokens)}
                    disabled={!signedIn || loadingPlaylists}
                  >
                    Refresh
                  </button>
                </div>
                <div className="playlist-grid">
                  {playlists.map((playlist) => (
                    <button
                      className={
                        playlist.kind === "liked" ? "playlist-card liked" : "playlist-card"
                      }
                      key={`${playlist.kind}-${playlist.id}`}
                      onClick={() => void openPlaylist(playlist)}
                      disabled={loadingPlaylists}
                    >
                      {playlistImage(playlist) ? (
                        <img src={playlistImage(playlist)} alt="" />
                      ) : (
                        <span className="playlist-art">
                          <ListMusic size={32} />
                        </span>
                      )}
                      <strong>{playlist.name}</strong>
                      <small>
                        {playlist.total} tracks - {playlist.owner}
                      </small>
                    </button>
                  ))}
                  {signedIn && !loadingPlaylists && playlists.length === 0 && (
                    <p className="empty">No playlists found</p>
                  )}
                  {loadingPlaylists && <p className="empty">Loading playlists...</p>}
                </div>
              </>
            ) : (
              <div className="playlist-detail">
                <div className="playlist-hero">
                  {playlistImage(selectedPlaylist) ? (
                    <img src={playlistImage(selectedPlaylist)} alt="" />
                  ) : (
                    <span className="playlist-art large">
                      <ListMusic size={52} />
                    </span>
                  )}
                  <div>
                    <button className="text-button" onClick={() => setSelectedPlaylist(null)}>
                      Back to playlists
                    </button>
                    <p>{selectedPlaylist.kind === "liked" ? "Saved tracks" : "Playlist"}</p>
                    <h2>{selectedPlaylist.name}</h2>
                    <small>
                      {selectedPlaylist.total} tracks - {selectedPlaylist.owner}
                    </small>
                    <button
                      className="hero-action"
                      onClick={() => playPlaylist(selectedPlaylist)}
                      disabled={busy || playlistTracks.length === 0}
                    >
                      <Play size={18} />
                      Play
                    </button>
                  </div>
                </div>
                <div className="track-list">
                  {playlistTracks.map((item, index) =>
                    item.track ? (
                      <button
                        className="track-row"
                        key={`${item.track.uri}-${index}`}
                        onClick={() => play(item.track!)}
                        disabled={busy}
                      >
                        <span>{index + 1}</span>
                        {bestImage(item.track) ? <img src={bestImage(item.track)} alt="" /> : <i />}
                        <span>
                          <strong>{item.track.name}</strong>
                          <small>{item.track.artists.map((artist) => artist.name).join(", ")}</small>
                        </span>
                        <small>{item.track.album.name}</small>
                        <small>{formatTime(item.track.duration_ms)}</small>
                      </button>
                    ) : null,
                  )}
                  {loadingPlaylists && <p className="empty">Loading tracks...</p>}
                  {!loadingPlaylists && playlistTracks.length === 0 && (
                    <p className="empty">No playable tracks here</p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {view === "search" && (
          <section className="search-view">
            <label className="search-box">
              <Search size={20} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tracks"
                disabled={!signedIn}
              />
            </label>
            <div className="results">
              {searching && <p className="empty">Searching...</p>}
              {!searching &&
                results.map((result) => (
                  <button
                    className="result"
                    key={result.uri}
                    onClick={() => play(result)}
                    disabled={busy}
                  >
                    {bestImage(result) ? <img src={bestImage(result)} alt="" /> : <span />}
                    <span>
                      <strong>{result.name}</strong>
                      <small>
                        {result.artists.map((artist) => artist.name).join(", ")} -{" "}
                        {result.album.name}
                      </small>
                    </span>
                    <Play size={18} />
                  </button>
                ))}
              {!searching && signedIn && query.length > 1 && results.length === 0 && (
                <p className="empty">No tracks found</p>
              )}
            </div>
          </section>
        )}

        {view === "devices" && (
          <section className="devices-view">
            {webDevice && (
              <button
                className="device-row"
                onClick={() => transfer(webDevice.deviceId, false)}
                disabled={busy}
              >
                <Laptop size={22} />
                <span>
                  <strong>This app</strong>
                  <small>Web Playback SDK device</small>
                </span>
              </button>
            )}
            {devices.map((device) => (
              <button
                key={device.id}
                className={device.is_active ? "device-row active" : "device-row"}
                onClick={() => transfer(device.id, false)}
                disabled={busy || device.is_restricted}
              >
                <MonitorSpeaker size={22} />
                <span>
                  <strong>{device.name}</strong>
                  <small>
                    {device.type}
                    {device.is_restricted ? " - restricted" : ""}
                  </small>
                </span>
              </button>
            ))}
            {signedIn && devices.length === 0 && !webDevice && (
              <p className="empty">Open Spotify on another device or wait for in-app playback.</p>
            )}
          </section>
        )}

        <footer className="player">
          <div className="mini-track">
            {cover ? <img src={cover} alt="" /> : <span />}
            <div>
              <strong>{track?.name ?? "Nothing playing"}</strong>
              <small>{artists}</small>
            </div>
          </div>

          <div className="transport">
            <div className="transport-buttons">
              <button
                className={playback?.shuffle_state ? "active-icon" : ""}
                onClick={() =>
                  tokens && playback
                    ? void run(() => setShuffle(tokens, !playback.shuffle_state), "Changing shuffle")
                    : undefined
                }
                title="Shuffle"
                disabled={!playback || busy}
              >
                <Shuffle size={18} />
              </button>
              <button onClick={() => control("previous")} title="Previous" disabled={!playback || busy}>
                <SkipBack size={22} />
              </button>
              <button
                className="play"
                onClick={() => control("toggle")}
                title={playback?.is_playing ? "Pause" : "Play"}
                disabled={!playback || busy}
              >
                {playback?.is_playing ? <Pause size={26} /> : <Play size={26} />}
              </button>
              <button onClick={() => control("next")} title="Next" disabled={!playback || busy}>
                <SkipForward size={22} />
              </button>
              <button
                className={playback?.repeat_state && playback.repeat_state !== "off" ? "active-icon" : ""}
                onClick={cycleRepeat}
                title="Repeat"
                aria-label={playback?.repeat_state === "track" ? "Repeat one" : "Repeat"}
                disabled={!playback || busy}
              >
                <Repeat size={18} />
              </button>
            </div>

            <div className="progress">
              <span>{formatTime(localProgress)}</span>
              <div className="progress-slider">
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  value={Math.min(localProgress, duration || 1)}
                  onChange={(event) => setLocalProgress(Number(event.target.value))}
                  onMouseUp={(event) => seek(Number(event.currentTarget.value))}
                  onKeyUp={(event) => seek(Number(event.currentTarget.value))}
                  disabled={!track || busy}
                  style={rangeStyle(progressPercent)}
                />
              </div>
              <span>{formatTime(duration)}</span>

              <div className="volume compact-volume">
                <Volume2 size={18} />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(event) => changeVolume(Number(event.target.value))}
                  disabled={!playback?.device || busy}
                  style={rangeStyle(volume)}
                />
              </div>
            </div>
          </div>
        </footer>
      </section>
    </main>
  );
}
