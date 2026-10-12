import { useEffect } from "react";

/** Esc cierra el diálogo. Sin función no hace nada (p. ej. mientras se guarda). */
export function useEscape(onEscape?: () => void): void {
  useEffect(() => {
    if (!onEscape) return;

    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onEscape]);
}
