import type { ReactNode } from "react";
import { IconPlus } from "@tabler/icons-react";
import { t } from "../lib/i18n";

/**
 * Barra superior de cada pantalla: la primera fila de la superficie de trabajo, con los controles y la acción principal
 * a la derecha. El título no se ve (la barra lateral ya dice dónde estás), pero sigue para el lector de pantalla.
 */
function TopBar({
  title,
  children,
  end,
  action,
  shortcut,
  onAction,
}: {
  title: string;
  /** Controles junto al título (búsqueda, filtros, fecha…) */
  children?: ReactNode;
  /** Controles a la derecha, justo antes de la acción (p. ej. cambiar de vista) */
  end?: ReactNode;
  /** Texto de la acción principal, sin el «+»: lo pone el icono */
  action?: string;
  /** Atajo de teclado que hace lo mismo, en gris al lado del texto */
  shortcut?: string;
  onAction?: () => void;
}) {
  return (
    <header className="flex min-h-13 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-line py-2 pr-2.5 pl-4">
      <h1 className="sr-only">{t(title)}</h1>
      {children}
      <div className="flex-1" />
      {end}
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-2 rounded-control bg-primary px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-on-primary transition active:scale-[0.97]"
        >
          <IconPlus size={16} stroke={1.75} aria-hidden="true" />
          {t(action)}
          {shortcut && (
            <kbd className="rounded-chip border border-current px-1.5 text-xs font-medium opacity-80">{shortcut}</kbd>
          )}
        </button>
      )}
    </header>
  );
}

export default TopBar;
