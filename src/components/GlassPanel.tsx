import type { ReactNode } from "react";

/**
 * Panel de cristal con su capa de fondo aparte del contenido.
 * (Ya no usa backdrop-filter, que era lento y encerraba a los descendientes "fixed"; la capa aparte
 * se mantiene por si algún día vuelve a hacer falta.)
 */
function GlassPanel({
  as: Tag = "div",
  heavy = false,
  className = "",
  contentClassName = "",
  children,
}: {
  as?: "div" | "nav" | "aside" | "section";
  heavy?: boolean;
  /** Posición en el layout (grid/flex): min-h-0, col-span… */
  className?: string;
  /** Aspecto del interior: padding, scroll, flex… */
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={`relative min-w-0 ${className}`}>
      <div aria-hidden="true" className={`${heavy ? "glass-heavy" : "glass"} absolute inset-0 rounded-3xl`} />
      <div className={`relative h-full min-h-0 rounded-3xl ${contentClassName}`}>{children}</div>
    </Tag>
  );
}

export default GlassPanel;
