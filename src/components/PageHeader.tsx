import type { ReactNode } from "react";
import { t } from "../lib/i18n";

function PageHeader({
  title,
  description,
  action,
  onAction,
  children,
}: {
  /** Se mantiene por compatibilidad con las pantallas; el encabezado ya no lo muestra */
  label?: string;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
  /** Extra controls next to the action (e.g. the Catalog tabs) */
  children?: ReactNode;
}) {
  return (
    <header className="px-8 py-5">
      <div className="flex items-center justify-between gap-6">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-tight">{t(title)}</h2>
          <p className="mt-1 text-sm text-muted">{t(description)}</p>
        </div>

        <div className="flex items-center gap-4">
        {children}
        {action && (
          <button
            onClick={onAction}
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            {t(action)}
          </button>
        )}
        </div>
      </div>
    </header>
  );
}

export default PageHeader;