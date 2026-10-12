import { t } from "../lib/i18n";

function PageHeader({
  title,
  description,
  bare = false,
  action,
  onAction,
}: {
  /** Se mantiene por compatibilidad con las pantallas; el encabezado ya no lo muestra */
  label?: string;
  title: string;
  description: string;
  /** Sin línea inferior: para pantallas con sus propios paneles de cristal */
  bare?: boolean;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header className={`px-8 py-5 ${bare ? "" : "border-b border-line"}`}>
      <div className="flex items-center justify-between gap-6">
        <div>
          <h2 className="font-display text-3xl font-semibold tracking-tight">{t(title)}</h2>
          <p className="mt-1 text-sm text-muted">{t(description)}</p>
        </div>

        {action && (
          <button
            onClick={onAction}
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            {t(action)}
          </button>
        )}
      </div>
    </header>
  );
}

export default PageHeader;