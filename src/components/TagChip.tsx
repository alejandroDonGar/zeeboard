import type { CSSProperties } from "react";

/** Etiqueta (tag) de una comisión: chip neutro con un punto del color de la tag. */
function TagChip({
  name,
  color,
  selected,
  onClick,
  title,
  suffix,
}: {
  name: string;
  color: string;
  /** Solo en selectores: `false` la dibuja apagada (con borde) y `true` resaltada */
  selected?: boolean;
  onClick?: () => void;
  title?: string;
  suffix?: string;
}) {
  const className = `chip ${selected === false ? "chip-outline hover:text-ink" : ""} ${selected ? "ring-1 ring-ink" : ""}`;
  const style = { "--tone": color } as CSSProperties;

  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={`${className} transition hover:opacity-80`} style={style} aria-pressed={selected}>
      {name}
      {suffix}
    </button>
  ) : (
    <span title={title} className={className} style={style}>
      {name}
    </span>
  );
}

export default TagChip;
