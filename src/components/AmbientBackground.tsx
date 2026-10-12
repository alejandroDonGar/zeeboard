import { useAmbientColors } from "../lib/ambient";

/** Tres manchas de color desenfocadas detrás de toda la app; su color viene de la imagen en pantalla. */
/** `strong`: sobre fondo oscuro (modo foco) las manchas pueden ser más intensas. */
function AmbientBackground({ strong = false }: { strong?: boolean }) {
  const [a, b, c] = useAmbientColors();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-[10%]"
      style={{ filter: "blur(70px) saturate(140%)", opacity: strong ? 0.55 : "var(--ambient-opacity)" }}
    >
      <i className="ambient-blob absolute rounded-full" style={{ left: "45%", top: "5%", width: "46%", height: "60%", backgroundColor: a }} />
      <i className="ambient-blob absolute rounded-full" style={{ left: "62%", top: "50%", width: "40%", height: "50%", backgroundColor: b }} />
      <i className="ambient-blob absolute rounded-full" style={{ left: "20%", top: "60%", width: "30%", height: "40%", backgroundColor: c }} />
    </div>
  );
}

export default AmbientBackground;
