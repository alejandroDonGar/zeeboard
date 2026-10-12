import type { CSSProperties } from "react";
import { useAmbient } from "../lib/ambient";

/** Fondo de color detrás de toda la app: tonos y posición salen de la pantalla y de la imagen en curso (lib/ambient.ts). */
function AmbientBackground({ strong = false }: { strong?: boolean }) {
  const { colors, layout } = useAmbient();
  const [ax, ay, bx, by, cx, cy] = layout;
  // Sin imagen en pantalla: los tonos neutros del tema
  const [a, b, c] = colors ?? ["var(--amb-neutral-a)", "var(--amb-neutral-b)", "var(--amb-neutral-c)"];

  return (
    <div
      aria-hidden="true"
      className="ambient pointer-events-none absolute inset-0"
      style={
        {
          "--amb-a": a,
          "--amb-b": b,
          "--amb-c": c,
          "--amb-ax": `${ax}%`,
          "--amb-ay": `${ay}%`,
          "--amb-bx": `${bx}%`,
          "--amb-by": `${by}%`,
          "--amb-cx": `${cx}%`,
          "--amb-cy": `${cy}%`,
          opacity: strong ? 0.8 : "var(--ambient-opacity)",
        } as CSSProperties
      }
    />
  );
}

export default AmbientBackground;
