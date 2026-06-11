import { PlaylistSummary, PlaylistTrack, SpotifyTrack } from "../spotify/api";

const UI_CACHE_KEY = "custom_spotify_ui_cache_v1";
const IMAGE_CACHE_NAME = "custom-spotify-images-v1";
const IMAGE_DB_NAME = "custom_spotify_image_cache";
const IMAGE_STORE_NAME = "images";
const IMAGE_DB_VERSION = 1;

type UiCache = {
  playlists: PlaylistSummary[];
  playlistTracks: Record<string, CachedPlaylistTracks>;
  trackImages: Record<string, string>;
  trackAccents: Record<string, CachedTrackAccent>;
  updatedAt: number;
};

export type CachedAccent = {
  primary: string;
  muted: string;
  text: string;
};

type CachedTrackAccent = {
  imageUrl?: string;
  accent: CachedAccent;
  updatedAt: number;
};

type CachedImageRecord = {
  url: string;
  blob: Blob;
  updatedAt: number;
};

type CachedPlaylistTracks = {
  snapshotId?: string;
  total: number;
  items: PlaylistTrack[];
  updatedAt: number;
};

function readCache(): UiCache {
  const empty: UiCache = {
    playlists: [],
    playlistTracks: {},
    trackImages: {},
    trackAccents: {},
    updatedAt: 0,
  };
  const raw = localStorage.getItem(UI_CACHE_KEY);
  if (!raw) return empty;

  try {
    return { ...empty, ...(JSON.parse(raw) as Partial<UiCache>) };
  } catch {
    localStorage.removeItem(UI_CACHE_KEY);
    return empty;
  }
}

function writeCache(cache: UiCache) {
  localStorage.setItem(UI_CACHE_KEY, JSON.stringify({ ...cache, updatedAt: Date.now() }));
}

export function loadCachedPlaylists() {
  return readCache().playlists;
}

export function clearUiCache() {
  localStorage.removeItem(UI_CACHE_KEY);
}

export function saveCachedPlaylists(playlists: PlaylistSummary[]) {
  writeCache({ ...readCache(), playlists });
  void warmImageCache(playlists.map((playlist) => playlist.image));
}

function playlistCacheKey(playlist: PlaylistSummary) {
  return `${playlist.kind}:${playlist.id}`;
}

export function mergeCachedPlaylistMetadata(playlists: PlaylistSummary[]) {
  const cachedPlaylists = readCache().playlists;

  return playlists.map((playlist) => {
    const cached = cachedPlaylists.find(
      (item) => item.kind === playlist.kind && item.id === playlist.id,
    );
    if (!cached) return playlist;

    const sameSnapshot =
      playlist.kind === "playlist" && playlist.snapshotId && playlist.snapshotId === cached.snapshotId;
    if (!sameSnapshot) return playlist;

    return {
      ...playlist,
      total: cached.total || playlist.total,
      image: playlist.image ?? cached.image,
      tracksHref: playlist.tracksHref ?? cached.tracksHref,
    };
  });
}

export function loadCachedPlaylistTracks(playlist: PlaylistSummary) {
  const cached = readCache().playlistTracks[playlistCacheKey(playlist)];
  if (!cached) return null;
  if (playlist.kind === "playlist" && playlist.snapshotId && cached.snapshotId !== playlist.snapshotId) {
    return null;
  }
  return cached;
}

export function saveCachedPlaylistTracks(
  playlist: PlaylistSummary,
  items: PlaylistTrack[],
  total: number,
) {
  const cache = readCache();
  cache.playlistTracks[playlistCacheKey(playlist)] = {
    snapshotId: playlist.snapshotId,
    total,
    items,
    updatedAt: Date.now(),
  };
  writeCache(cache);
}

export function rememberTrackImages(tracks: Array<SpotifyTrack | null | undefined>) {
  const cache = readCache();
  let changed = false;

  for (const track of tracks) {
    const image = track?.album.images?.[0]?.url;
    if (!track?.id || !image || cache.trackImages[track.id] === image) continue;
    cache.trackImages[track.id] = image;
    changed = true;
  }

  if (changed) writeCache(cache);
  void warmImageCache(tracks.map((track) => track?.album.images?.[0]?.url));
}

export function cachedTrackImage(track?: SpotifyTrack | null) {
  if (!track) return undefined;
  return track.album.images?.[0]?.url ?? readCache().trackImages[track.id];
}

function openImageDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        db.createObjectStore(IMAGE_STORE_NAME, { keyPath: "url" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function readImageRecord(url: string) {
  const db = await openImageDb();
  return new Promise<CachedImageRecord | null>((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE_NAME, "readonly");
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const request = store.get(url);
    request.onsuccess = () => resolve((request.result as CachedImageRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Image cache read failed"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Image cache transaction failed"));
    };
  });
}

async function writeImageRecord(record: CachedImageRecord) {
  const db = await openImageDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    store.put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Image cache write failed"));
    };
  });
}

const objectUrls = new Map<string, string>();

export async function getCachedImageObjectUrl(url?: string | null) {
  if (!url) return null;
  const existing = objectUrls.get(url);
  if (existing) return existing;

  const record = await readImageRecord(url);
  if (!record?.blob) return null;

  const objectUrl = URL.createObjectURL(record.blob);
  objectUrls.set(url, objectUrl);
  return objectUrl;
}

export async function cacheImageBlob(url?: string | null) {
  if (!url) return null;

  const cached = await getCachedImageObjectUrl(url);
  if (cached) return cached;

  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error("Image download failed");

  const blob = await response.blob();
  await writeImageRecord({ url, blob, updatedAt: Date.now() });

  const objectUrl = URL.createObjectURL(blob);
  objectUrls.set(url, objectUrl);
  return objectUrl;
}

export function loadCachedTrackAccent(trackId?: string | null, imageUrl?: string) {
  if (!trackId) return null;

  const cached = readCache().trackAccents[trackId];
  if (!cached) return null;
  if (imageUrl && cached.imageUrl && cached.imageUrl !== imageUrl) return null;

  return cached.accent;
}

export function saveCachedTrackAccent(
  trackId: string | undefined | null,
  imageUrl: string | undefined,
  accent: CachedAccent,
) {
  if (!trackId) return;

  const cache = readCache();
  cache.trackAccents[trackId] = {
    imageUrl,
    accent,
    updatedAt: Date.now(),
  };
  writeCache(cache);
}

export async function warmImageCache(urls: Array<string | null | undefined>) {
  const uniqueUrls = [...new Set(urls.filter((url): url is string => Boolean(url)))].slice(0, 80);
  if (!("caches" in window) || uniqueUrls.length === 0) return;

  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);

    for (const url of uniqueUrls) {
      try {
        const request = new Request(url, { mode: "no-cors" });
        const cached = await cache.match(request);
        if (cached) continue;

        const response = await fetch(request);
        await cache.put(request, response);
      } catch {
        // Image warmup is best-effort; the UI can still load the source URL normally.
      }
    }
  } catch {
    // Cache API can be unavailable in some renderer contexts.
  }
}
