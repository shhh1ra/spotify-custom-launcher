import {
  Laptop,
  LogOut,
  ListMusic,
  LogIn,
  Mic2,
  MonitorSpeaker,
  Pause,
  Play,
  Rows3,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildLoginUrl,
  clearTokens,
  exchangeCodeForTokens,
  getStoredTokens,
  SpotifyTokens,
} from "../spotify/auth";
import {
  getDevices,
  getAllMyPlaylists,
  getMe,
  getPlaylistTracks,
  getPlaylistTracksByHref,
  getPlayback,
  getQueue,
  getSavedTracks,
  isSpotifyAuthError,
  isSpotifyRateLimitError,
  playContext,
  playTrack,
  playTracks,
  PlaylistSummary,
  PlaylistTrack,
  PlaybackState,
  QueueState,
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
import {
  cachedTrackImage,
  clearUiCache,
  loadCachedPlaylists,
  rememberTrackImages,
  saveCachedPlaylists,
} from "./cache";
import { AppSettings, loadSettings, saveSettings } from "./settings";
import { useAccent } from "./useAccent";

type View = "now" | "playlists" | "search" | "devices" | "lyrics";

function formatTime(ms = 0) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function bestImage(track?: SpotifyTrack | null) {
  return cachedTrackImage(track);
}

function playlistImage(playlist: PlaylistSummary) {
  return playlist.image;
}

function playlistTrack(item: PlaylistTrack) {
  return item.track ?? item.item ?? null;
}

function rangeStyle(percent: number) {
  return { "--range-fill": `${Math.min(100, Math.max(0, percent))}%` } as React.CSSProperties;
}

function playlistStatusMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return error.message;
}

function profileInitial(profile?: SpotifyUser | null) {
  return (profile?.display_name?.trim()[0] ?? profile?.id?.trim()[0] ?? "?").toUpperCase();
}

export function App() {
  const [tokens, setTokens] = useState<SpotifyTokens | null>(() => getStoredTokens());
  const [profile, setProfile] = useState<SpotifyUser | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [webDevice, setWebDevice] = useState<WebPlaybackDevice | null>(null);
  const [status, setStatus] = useState("Ready");
  const [view, setView] = useState<View>("now");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>(() => loadCachedPlaylists());
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistSummary | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrack[]>([]);
  const [playlistTrackQuery, setPlaylistTrackQuery] = useState("");
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [loadingMoreTracks, setLoadingMoreTracks] = useState(false);
  const [playlistHasMore, setPlaylistHasMore] = useState(false);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistScrolled, setPlaylistScrolled] = useState(false);
  const [localVolume, setLocalVolume] = useState(75);
  const [busy, setBusy] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authExpiredOpen, setAuthExpiredOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadSettings());
  const [localProgress, setLocalProgress] = useState(0);
  const playlistLoadVersion = useRef(0);
  const libraryRateLimitUntil = useRef(0);

  const track = playback?.item ?? null;
  const cover = bestImage(track);
  const accent = useAccent(cover);

  const artists = useMemo(
    () => track?.artists.map((artist) => artist.name).join(", ") ?? "No active track",
    [track],
  );

  const activeDeviceId = playback?.device?.id ?? devices.find((device) => device.is_active)?.id;
  const targetDeviceId = webDevice?.deviceId ?? activeDeviceId;
  const volume = playback?.device?.volume_percent ?? localVolume;
  const duration = track?.duration_ms ?? 0;
  const progressPercent = duration ? (localProgress / duration) * 100 : 0;
  const profileImage = profile?.images?.[0]?.url;
  const nextQueueTracks = queueState?.queue.filter((item) => item?.uri).slice(0, 5) ?? [];
  const visiblePlaylistTracks = useMemo(() => {
    const normalizedQuery = playlistTrackQuery.trim().toLowerCase();
    if (!normalizedQuery) return playlistTracks;

    return playlistTracks.filter((item) => {
      const itemTrack = playlistTrack(item);
      if (!itemTrack) return false;

      const haystack = [
        itemTrack.name,
        itemTrack.album.name,
        ...itemTrack.artists.map((artist) => artist.name),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [playlistTrackQuery, playlistTracks]);

  function isLibraryRateLimited() {
    return appSettings.rateLimitGuardEnabled && Date.now() < libraryRateLimitUntil.current;
  }

  function handleLibraryRateLimit(
    error: unknown,
    fallback = "Spotify is rate limiting playlists. Using cached library.",
  ) {
    if (!isSpotifyRateLimitError(error)) return false;

    if (!appSettings.rateLimitGuardEnabled) {
      setStatus("Rate limit guard is off, but Spotify still rejected this request.");
      return true;
    }

    libraryRateLimitUntil.current = Math.max(
      libraryRateLimitUntil.current,
      Date.now() + error.retryAfterMs,
    );
    setStatus(fallback);
    return true;
  }

  function updateSettings(nextSettings: AppSettings) {
    setAppSettings(nextSettings);
    saveSettings(nextSettings);
    if (!nextSettings.rateLimitGuardEnabled) {
      libraryRateLimitUntil.current = 0;
      setStatus("Rate limit guard disabled");
    } else {
      setStatus("Rate limit guard enabled");
    }
  }

  function resetSession(clearCache = false) {
    clearTokens();
    setTokens(null);
    setProfile(null);
    setPlayback(null);
    setQueueState(null);
    setDevices([]);
    setWebDevice(null);
    setSelectedPlaylist(null);
    setPlaylistTracks([]);
    setPlaylistTrackQuery("");
    setProfileMenuOpen(false);
    if (clearCache) {
      setPlaylists([]);
      clearUiCache();
    }
  }

  function handleAuthExpired(error: unknown) {
    if (!isSpotifyAuthError(error)) return false;

    resetSession(false);
    setAuthExpiredOpen(true);
    setStatus("Spotify session expired");
    return true;
  }

  function spotifyErrorMessage(error: unknown, fallback: string) {
    if (isSpotifyRateLimitError(error)) return error.message;
    if (error instanceof Error) return error.message;
    return fallback;
  }

  async function refreshState(nextTokens = tokens) {
    if (!nextTokens) return;
    const [nextPlayback, nextDevices, nextQueue] = await Promise.all([
      getPlayback(nextTokens),
      getDevices(nextTokens),
      getQueue(nextTokens).catch(() => null),
    ]);
    setPlayback(nextPlayback ?? null);
    setDevices(nextDevices.devices);
    setQueueState(nextQueue);
    setLocalProgress(nextPlayback?.progress_ms ?? 0);
    rememberTrackImages([nextPlayback?.item, ...(nextQueue?.queue ?? [])]);
    if (nextPlayback?.device?.volume_percent !== null && nextPlayback?.device?.volume_percent !== undefined) {
      setLocalVolume(nextPlayback.device.volume_percent);
    }
    setStatus(nextPlayback?.device ? "Connected" : "Choose a Spotify device");
  }

  async function loadPlaylists(nextTokens = tokens, force = false) {
    if (!nextTokens || (!force && isLibraryRateLimited())) return;
    const loadVersion = playlistLoadVersion.current + 1;
    playlistLoadVersion.current = loadVersion;
    const hasCachedPlaylists = playlists.length > 0;
    setLoadingPlaylists(!hasCachedPlaylists);
    try {
      const [savedTracks, myPlaylists] = await Promise.all([
        getSavedTracks(nextTokens, 1),
        getAllMyPlaylists(nextTokens),
      ]);
      if (playlistLoadVersion.current !== loadVersion) return;

      const playlistItems = myPlaylists?.items ?? [];

      const likedSongs: PlaylistSummary = {
        id: "liked",
        name: "Liked Songs",
        description: "Saved tracks",
        owner: profile?.display_name ?? "You",
        total: savedTracks?.total ?? 0,
        kind: "liked",
      };

      const nextPlaylists = [
        likedSongs,
        ...playlistItems.map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          uri: playlist.uri,
          description: playlist.description,
          image: playlist.images?.[0]?.url,
          owner: playlist.owner?.display_name ?? playlist.owner?.id ?? "Unknown",
          total: playlist.tracks?.total ?? 0,
          tracksHref: playlist.tracks?.href,
          kind: "playlist" as const,
        })),
      ];

      setPlaylists(nextPlaylists);
      saveCachedPlaylists(nextPlaylists);
    } catch (error) {
      if (handleAuthExpired(error)) return;
      if (handleLibraryRateLimit(error)) return;
      setStatus(
        playlists.length > 0
          ? "Spotify is rate limiting. Using cached library."
          : error instanceof Error
            ? error.message
            : "Playlists unavailable",
      );
    } finally {
      if (playlistLoadVersion.current === loadVersion) {
        setLoadingPlaylists(false);
      }
    }
  }

  async function openPlaylist(playlist: PlaylistSummary) {
    if (!tokens) return;
    setSelectedPlaylist(playlist);
    setView("playlists");
    setLoadingPlaylists(true);
    setPlaylistScrolled(false);
    setPlaylistTrackQuery("");
    setPlaylistOffset(0);
    setPlaylistHasMore(false);
    try {
      const response = await loadPlaylistTrackPage(playlist, 0);
      const items = response?.items ?? [];
      const total = response?.total ?? playlist.total;
      setSelectedPlaylist((current) => (current ? { ...current, total } : current));
      setPlaylists((current) =>
        {
          const next = current.map((item) =>
            item.kind === playlist.kind && item.id === playlist.id ? { ...item, total } : item,
          );
          saveCachedPlaylists(next);
          return next;
        },
      );
      const playableItems = items.filter((item) => playlistTrack(item)?.uri);
      rememberTrackImages(playableItems.map((item) => playlistTrack(item)));
      setPlaylistTracks(playableItems);
      setPlaylistOffset(items.length);
      setPlaylistHasMore(Boolean(response?.next));
    } catch (error) {
      if (handleAuthExpired(error)) return;
      setStatus(playlistStatusMessage(error, "Playlist tracks unavailable"));
      setPlaylistTracks([]);
    } finally {
      setLoadingPlaylists(false);
    }
  }

  async function loadPlaylistTrackPage(playlist: PlaylistSummary, offset: number) {
    if (playlist.kind === "liked") {
      return getSavedTracks(tokens!, 50, offset);
    }

    if (playlist.tracksHref) {
      return getPlaylistTracksByHref(tokens!, playlist.tracksHref, 50, offset);
    }

    return getPlaylistTracks(tokens!, playlist.id, 50, offset);
  }

  async function loadMorePlaylistTracks() {
    if (!tokens || !selectedPlaylist || loadingPlaylists || loadingMoreTracks || !playlistHasMore) {
      return;
    }

    setLoadingMoreTracks(true);
    try {
      const response = await loadPlaylistTrackPage(selectedPlaylist, playlistOffset);
      const items = response?.items ?? [];
      const playableItems = items.filter((item) => playlistTrack(item)?.uri);
      rememberTrackImages(playableItems.map((item) => playlistTrack(item)));
      setPlaylistTracks((current) => [
        ...current,
        ...playableItems,
      ]);
      setPlaylistOffset((current) => current + items.length);
      setPlaylistHasMore(Boolean(response?.next));
    } catch (error) {
      if (handleAuthExpired(error)) return;
      setStatus(playlistStatusMessage(error, "More tracks unavailable"));
    } finally {
      setLoadingMoreTracks(false);
    }
  }

  function handlePlaylistScroll(event: React.UIEvent<HTMLElement>) {
    const target = event.currentTarget;
    setPlaylistScrolled(target.scrollTop > 180);

    if (target.scrollHeight - target.scrollTop - target.clientHeight < 420) {
      void loadMorePlaylistTracks();
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
      .catch((error) => {
        if (handleAuthExpired(error)) return;
        if (!handleLibraryRateLimit(error, "Spotify is rate limiting playlists. Login finished, waiting.")) {
          setStatus("Login failed");
        }
      });
  }, [tokens]);

  useEffect(() => {
    if (!tokens) return;

    let active = true;
    getMe(tokens)
      .then((nextProfile) => {
        if (active) setProfile(nextProfile);
      })
      .catch((error) => {
        if (!active || handleAuthExpired(error)) return;
        if (!handleLibraryRateLimit(error)) setStatus(spotifyErrorMessage(error, "Profile unavailable"));
      });
    void loadPlaylists(tokens);

    const poll = async () => {
      try {
        await refreshState(tokens);
      } catch (error) {
        if (!active) return;
        if (handleAuthExpired(error)) return;
        setStatus(error instanceof Error ? error.message : "Waiting for Spotify");
      }
    };

    poll();
    const timer = window.setInterval(poll, 15000);
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
      rememberTrackImages([
        {
          id: current.id,
          name: current.name,
          uri: current.uri,
          duration_ms: state.duration,
          album: current.album,
          artists: current.artists,
        },
      ]);
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
    if (isLibraryRateLimited()) {
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchTracks(tokens, query.trim())
        .then((response) => {
          if (active) {
            rememberTrackImages(response.tracks.items);
            setResults(response.tracks.items);
          }
        })
        .catch((error) => {
          if (!active || handleAuthExpired(error)) return;
          if (!handleLibraryRateLimit(error, "Spotify is rate limiting search.")) {
            setStatus(spotifyErrorMessage(error, "Search unavailable"));
          }
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
    setAuthExpiredOpen(false);
    window.location.href = await buildLoginUrl();
  }

  function signOut() {
    setAuthExpiredOpen(false);
    resetSession(true);
  }

  async function run(action: () => Promise<void>, message = "Updating playback") {
    if (!tokens) return;
    setBusy(true);
    setStatus(message);
    try {
      await action();
      await refreshState(tokens);
    } catch (error) {
      if (handleAuthExpired(error)) return;
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

  function playQueueItem(index: number) {
    if (!tokens || !playback) return;
    void run(
      async () => {
        for (let step = 0; step <= index; step += 1) {
          await skipNext(tokens);
        }
      },
      "Moving through queue",
    );
    setView("now");
  }

  function playPlaylistTrack(trackToPlay: SpotifyTrack, index: number) {
    if (!tokens || !selectedPlaylist) return;
    void run(
      async () => {
        if (webDevice?.deviceId && activeDeviceId !== webDevice.deviceId) {
          await transferPlayback(tokens, webDevice.deviceId, false);
        }

        const restoreShuffle = Boolean(playback?.shuffle_state);
        if (restoreShuffle) {
          await setShuffle(tokens, false);
        }

        if (selectedPlaylist.kind === "playlist" && selectedPlaylist.uri) {
          await playContext(tokens, selectedPlaylist.uri, targetDeviceId, trackToPlay.uri);
          if (restoreShuffle) await setShuffle(tokens, true);
          return;
        }

        const nextUris = playlistTracks
          .slice(index)
          .map((item) => playlistTrack(item)?.uri)
          .filter((uri): uri is string => Boolean(uri));

        if (nextUris.length > 1) {
          await playTracks(tokens, nextUris, targetDeviceId);
          if (restoreShuffle) await setShuffle(tokens, true);
          return;
        }

        await playTrack(tokens, trackToPlay.uri, targetDeviceId);
        if (restoreShuffle) await setShuffle(tokens, true);
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

        const firstSaved = playlistTracks
          .map((item) => playlistTrack(item))
          .find((item) => item?.uri);
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
    setLocalVolume(value);
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
            setPlaylistTrackQuery("");
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
          {signedIn && (
            <section className="queue-preview">
              <div className="queue-preview-title">
                <span>Up next</span>
                {nextQueueTracks.length > 0 && <small>{nextQueueTracks.length}</small>}
              </div>
              {nextQueueTracks.length > 0 ? (
                nextQueueTracks.map((queueTrack, index) => (
                  <button
                    className="queue-preview-row"
                    key={`${queueTrack.uri}-${index}`}
                    onClick={() => playQueueItem(index)}
                    disabled={busy}
                  >
                    {bestImage(queueTrack) ? <img src={bestImage(queueTrack)} alt="" /> : <i />}
                    <span>
                      <strong>{queueTrack.name}</strong>
                      <small>{queueTrack.artists.map((artist) => artist.name).join(", ")}</small>
                    </span>
                  </button>
                ))
              ) : (
                <p className="queue-empty">No queue yet</p>
              )}
            </section>
          )}
          {signedIn ? (
            <div className="profile-menu-wrap">
              {profileMenuOpen && (
                <div className="profile-menu">
                  <button
                    onClick={() => {
                      setSettingsOpen(true);
                      setProfileMenuOpen(false);
                    }}
                  >
                    <Settings size={16} />
                    Settings
                  </button>
                  <button onClick={signOut}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              )}
              <button className="profile-pill" onClick={() => setProfileMenuOpen((open) => !open)}>
                {profileImage ? (
                  <img src={profileImage} alt="" />
                ) : (
                  <span>{profileInitial(profile)}</span>
                )}
                <strong>{profile?.display_name ?? profile?.id ?? "Profile"}</strong>
              </button>
            </div>
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
                    onClick={() => void loadPlaylists(tokens, true)}
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
                      disabled={loadingPlaylists && playlists.length === 0}
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
              <div className="playlist-detail" onScroll={handlePlaylistScroll}>
                <div className={playlistScrolled ? "playlist-sticky visible" : "playlist-sticky"}>
                  <strong>{selectedPlaylist.name}</strong>
                  <button
                    className="playlist-play compact-play"
                    onClick={() => playPlaylist(selectedPlaylist)}
                    disabled={busy || playlistTracks.length === 0}
                  >
                    <Play size={16} />
                    Play
                  </button>
                </div>
                <div className="playlist-hero">
                  {playlistImage(selectedPlaylist) ? (
                    <img src={playlistImage(selectedPlaylist)} alt="" />
                  ) : (
                    <span className="playlist-art large">
                      <ListMusic size={52} />
                    </span>
                  )}
                  <div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelectedPlaylist(null);
                        setPlaylistTrackQuery("");
                      }}
                    >
                      Back to playlists
                    </button>
                    <p>{selectedPlaylist.kind === "liked" ? "Saved tracks" : "Playlist"}</p>
                    <div className="playlist-title-row">
                      <h2>{selectedPlaylist.name}</h2>
                      <button
                        className="hero-action playlist-play"
                        onClick={() => playPlaylist(selectedPlaylist)}
                        disabled={busy || playlistTracks.length === 0}
                      >
                        <Play size={18} />
                        Play
                      </button>
                    </div>
                    <small>
                      {selectedPlaylist.total} tracks - {selectedPlaylist.owner}
                    </small>
                  </div>
                </div>
                <label className="search-box playlist-search">
                  <Search size={18} />
                  <input
                    value={playlistTrackQuery}
                    onChange={(event) => setPlaylistTrackQuery(event.target.value)}
                    placeholder="Search in this playlist"
                    disabled={playlistTracks.length === 0}
                  />
                </label>
                <div className="track-list">
                  {visiblePlaylistTracks.map((item) => {
                    const savedTrack = playlistTrack(item);
                    const trackIndex = playlistTracks.findIndex(
                      (candidate) => playlistTrack(candidate)?.uri === savedTrack?.uri,
                    );
                    return savedTrack ? (
                      <button
                        className="track-row"
                        key={`${savedTrack.uri}-${trackIndex}`}
                        onClick={() => playPlaylistTrack(savedTrack, trackIndex)}
                        disabled={busy}
                      >
                        <span>{trackIndex + 1}</span>
                        {bestImage(savedTrack) ? <img src={bestImage(savedTrack)} alt="" /> : <i />}
                        <span>
                          <strong>{savedTrack.name}</strong>
                          <small>{savedTrack.artists.map((artist) => artist.name).join(", ")}</small>
                        </span>
                        <small>{savedTrack.album.name}</small>
                        <small>{formatTime(savedTrack.duration_ms)}</small>
                      </button>
                    ) : null;
                  })}
                  {loadingPlaylists && <p className="empty">Loading tracks...</p>}
                  {loadingMoreTracks && <p className="empty">Loading more tracks...</p>}
                  {!loadingPlaylists && playlistTracks.length === 0 && (
                    <p className="empty">No playable tracks here</p>
                  )}
                  {!loadingPlaylists && playlistTracks.length > 0 && visiblePlaylistTracks.length === 0 && (
                    <p className="empty">No tracks match this search</p>
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
                placeholder="Search Spotify tracks"
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

        {view === "lyrics" && (
          <section className="lyrics-view">
            <div className="lyrics-header">
              <div>
                <p>Lyrics</p>
                <h2>{track?.name ?? "Nothing playing"}</h2>
                <small>{artists}</small>
              </div>
              <button className="ghost compact" onClick={() => setView("now")}>
                Now
              </button>
            </div>

            <div className="lyrics-panel">
              <p>Lyrics unavailable</p>
              <span>
                Provider is not connected yet. The screen is ready for synced or plain lyrics.
              </span>
            </div>
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
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="volume compact-volume">
            <button
              className={view === "lyrics" ? "lyrics-toggle active-icon" : "lyrics-toggle"}
              onClick={() => setView(view === "lyrics" ? "now" : "lyrics")}
              title="Lyrics"
              disabled={!track}
            >
              <Mic2 size={18} />
            </button>
            <Volume2 size={18} />
            <input
              type="range"
              min={0}
              max={100}
              value={localVolume}
              onChange={(event) => setLocalVolume(Number(event.target.value))}
              onMouseUp={(event) => changeVolume(Number(event.currentTarget.value))}
              onTouchEnd={(event) => changeVolume(Number(event.currentTarget.value))}
              onKeyUp={(event) => changeVolume(Number(event.currentTarget.value))}
              disabled={!playback?.device || busy}
              style={rangeStyle(localVolume)}
            />
          </div>
        </footer>
      </section>

      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <section className="settings-dialog" onClick={(event) => event.stopPropagation()}>
            <header className="settings-header">
              <div>
                <span>Custom Spotify</span>
                <h2>Settings</h2>
              </div>
              <button className="settings-close" onClick={() => setSettingsOpen(false)} title="Close">
                <X size={18} />
              </button>
            </header>

            <label className="settings-row">
              <span>
                <strong>Rate limit guard</strong>
                <small>Pause playlist and search requests when Spotify returns too many requests.</small>
              </span>
              <input
                type="checkbox"
                checked={appSettings.rateLimitGuardEnabled}
                onChange={(event) =>
                  updateSettings({
                    ...appSettings,
                    rateLimitGuardEnabled: event.target.checked,
                  })
                }
              />
              <i />
            </label>
          </section>
        </div>
      )}

      {authExpiredOpen && (
        <div className="settings-overlay session-overlay">
          <section className="settings-dialog session-dialog">
            <header className="settings-header">
              <div>
                <span>Spotify session</span>
                <h2>Sign in again</h2>
              </div>
            </header>
            <p className="session-copy">
              Spotify says the authorization key is no longer valid. Connect your account again to continue.
            </p>
            <button className="hero-action session-action" onClick={login}>
              <LogIn size={18} />
              Connect Spotify
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
