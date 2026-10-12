import { useDialog } from "../lib/useDialog";
import { t } from "../lib/i18n";

function ConfirmModal({
  eyebrow,
  eyebrowTone = "neutral",
  title,
  message,
  cancelLabel = "Cancel",
  confirmLabel,
  confirmingLabel,
  isConfirming = false,
  confirmVariant = "danger",
  onConfirm,
  onCancel,
}: {
  eyebrow: string;
  eyebrowTone?: "neutral" | "danger";
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel: string;
  confirmingLabel?: string;
  isConfirming?: boolean;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  // Mientras se confirma (borrando, guardando…) Esc no cancela
  const dialogRef = useDialog(isConfirming ? undefined : onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className="w-[450px] glass-heavy rounded-3xl p-6">
        <p
          className={
            eyebrowTone === "danger"
              ? "text-xs font-bold text-tone-bad"
              : "text-xs font-bold text-muted"
          }
        >
          {t(eyebrow)}
        </p>

        <h3 className="mt-2 text-2xl font-black text-ink">
          {t(title)}
        </h3>

        <p className="mt-4 whitespace-pre-line text-sm text-muted">
          {t(message)}
        </p>

        <div className="mt-6 flex justify-end gap-3">
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-2xl border border-line-strong px-4 py-2 font-semibold"
            >
              {t(cancelLabel)}
            </button>
          )}

          <button
            onClick={onConfirm}
            disabled={isConfirming}
            className={
              confirmVariant === "danger"
                ? "rounded-2xl bg-tone-bad px-4 py-2 font-bold text-on-tone disabled:cursor-not-allowed disabled:opacity-70"
                : "rounded-2xl bg-primary px-4 py-2 font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-70"
            }
          >
            {t(isConfirming && confirmingLabel ? confirmingLabel : confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;