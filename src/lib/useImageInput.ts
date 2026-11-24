import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { IMAGE_EXTENSIONS } from "./images";

/**
 * Drag and drop + Ctrl+V paste.
 *
 * Image-accepting zones are marked with `data-image-drop="<id>"`. Tauri delivers dropped files
 * with their path and the cursor position; that position finds the zone underneath.
 * Returns the id of the zone being dragged over, to highlight it.
 */
export function useImageInput({
  onDrop,
  onPaste,
}: {
  onDrop: (zoneId: string, paths: string[]) => void;
  onPaste: (files: File[]) => void;
}): string | null {
  const [dragZoneId, setDragZoneId] = useState<string | null>(null);

  // Handlers change every render; listeners register once and always read the latest
  const handlers = useRef({ onDrop, onPaste });
  handlers.current = { onDrop, onPaste };

  useEffect(() => {
    function zoneAt(position: { x: number; y: number }): string | null {
      const x = position.x / window.devicePixelRatio;
      const y = position.y / window.devicePixelRatio;
      const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-image-drop]");

      return zone?.dataset.imageDrop ?? null;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          setDragZoneId(null);
          return;
        }

        const zoneId = zoneAt(payload.position);

        if (payload.type === "drop") {
          setDragZoneId(null);

          // Extension after the last dot (a name without one gives the whole name, which matches nothing)
          const images = payload.paths.filter((path) =>
            IMAGE_EXTENSIONS.includes(path.slice(path.lastIndexOf(".") + 1).toLowerCase()),
          );

          if (zoneId && images.length > 0) {
            handlers.current.onDrop(zoneId, images);
          }
        } else {
          setDragZoneId(zoneId);
        }
      })
      .then((stop) => {
        // StrictMode unmounts before the promise resolves: clean up here
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      });

    function handlePaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );

      if (files.length > 0) {
        event.preventDefault();
        handlers.current.onPaste(files);
      }
    }

    window.addEventListener("paste", handlePaste);

    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("paste", handlePaste);
    };
  }, []);

  return dragZoneId;
}
