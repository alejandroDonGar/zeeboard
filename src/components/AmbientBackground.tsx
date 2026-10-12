import type { CSSProperties } from "react";
import { useAmbientColors } from "../lib/ambient";

/** Fondo de color detrás de toda la app; sus tres tonos salen de la imagen en pantalla (lib/ambient.ts). */
function AmbientBackground({ strong = false }: { strong?: boolean }) {
  const [a, b, c] = useAmbientColors();

  return (
    <div
      aria-hidden="true"
      className="ambient pointer-events-none absolute inset-0"
      style={{ "--amb-a": a, "--amb-b": b, "--amb-c": c, opacity: strong ? 0.8 : "var(--ambient-opacity)" } as CSSProperties}
    />
  );
}

export default AmbientBackground;
