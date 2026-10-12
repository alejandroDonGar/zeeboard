import type { ReactNode } from "react";

/**
 * Panel de cristal. El cristal (backdrop-filter) va en una capa hermana y no en el contenedor:
 * un backdrop-filter convierte al elemento en el origen de sus descendientes "fixed", y los modales
 * que viven dentro de un panel quedarían encerrados en él.
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
