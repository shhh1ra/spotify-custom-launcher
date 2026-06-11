import { useEffect, useMemo, useState } from "react";
import {
  CachedAccent,
  cacheImageBlob,
  loadCachedTrackAccent,
  saveCachedTrackAccent,
  warmImageCache,
} from "./cache";

const fallback = { primary: "#1ed760", muted: "#122f25", text: "#f8fff9" };

function extractAccent(imageUrl: string) {
  return new Promise<CachedAccent>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error("Canvas unavailable"));
        return;
      }

      canvas.width = 24;
      canvas.height = 24;
      context.drawImage(image, 0, 0, 24, 24);
      const { data } = context.getImageData(0, 0, 24, 24);
      let red = 0;
      let green = 0;
      let blue = 0;
      let samples = 0;

      for (let index = 0; index < data.length; index += 16) {
        const alpha = data[index + 3];
        if (alpha < 128) continue;
        red += data[index];
        green += data[index + 1];
        blue += data[index + 2];
        samples += 1;
      }

      if (!samples) {
        reject(new Error("No color samples"));
        return;
      }

      const color = `rgb(${Math.round(red / samples)}, ${Math.round(
        green / samples,
      )}, ${Math.round(blue / samples)})`;
      resolve({ primary: color, muted: color, text: "#ffffff" });
    };
    image.onerror = () => reject(new Error("Image unavailable"));
  });
}

export async function preloadTrackAccent(
  trackId?: string | null,
  imageUrl?: string,
  preparedImageUrl?: string | null,
) {
  if (!trackId || !imageUrl || loadCachedTrackAccent(trackId, imageUrl)) return;

  void warmImageCache([imageUrl]);
  const localImageUrl = preparedImageUrl ?? (await cacheImageBlob(imageUrl).catch(() => null));
  const accent = await extractAccent(localImageUrl ?? imageUrl);
  saveCachedTrackAccent(trackId, imageUrl, accent);
}

export function useAccent(imageUrl?: string, trackId?: string | null) {
  const [accent, setAccent] = useState(fallback);
  const cachedAccent = useMemo(
    () => loadCachedTrackAccent(trackId, imageUrl),
    [imageUrl, trackId],
  );

  useEffect(() => {
    if (!imageUrl) {
      setAccent(fallback);
      return;
    }

    if (cachedAccent) {
      setAccent(cachedAccent);
      return;
    }

    let active = true;
    void extractAccent(imageUrl)
      .then((nextAccent) => {
        saveCachedTrackAccent(trackId, imageUrl, nextAccent);
        if (active) setAccent(nextAccent);
      })
      .catch(() => {
        if (active) setAccent(fallback);
      });

    return () => {
      active = false;
    };
  }, [cachedAccent, imageUrl, trackId]);

  return cachedAccent ?? accent;
}
