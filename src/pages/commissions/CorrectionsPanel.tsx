import { useState } from "react";
import { locale, t } from "../../lib/i18n";
import { pinNumber } from "../../lib/commissionHelpers";
import { addCorrection, getAllCorrections, type CommissionCorrection, type CommissionStageImage, type TemplateStage } from "../../lib/database";
import { useToast } from "../../context/ToastContext";

/** Client corrections of one stage: list (with pins), a field to add one, and the retouched-version buttons. */
function CorrectionsPanel({
  commissionId,
  stage,
  corrections,
  commissionImages,
  stageImages,
  importingStageId,
  setFocusImageId,
  copyPending,
  toggleDone,
  remove,
  setCorrections,
  addVersion,
  onClose,
}: {
  commissionId: number;
  stage: TemplateStage;
  /** Corrections of the whole commission (this panel filters its stage) */
  corrections: CommissionCorrection[];
  commissionImages: CommissionStageImage[];
  /** Alternatives of this stage */
  stageImages: CommissionStageImage[];
  importingStageId: number | null;
  setFocusImageId: (id: number | null) => void;
  copyPending: (stageId: number) => void;
  toggleDone: (correction: CommissionCorrection) => Promise<void>;
  remove: (correction: CommissionCorrection) => Promise<void>;
  setCorrections: (corrections: CommissionCorrection[]) => void;
  addVersion: (image: CommissionStageImage) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const { showToast } = useToast();

  return (
    <div className="rounded-md border border-line bg-surface/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-muted">
          {t("Corrections")} · {stage.name}
        </p>
        <button type="button" onClick={() => copyPending(stage.id)} className="text-xs text-faint transition hover:text-ink">
          {t("Copy corrections")}
        </button>
      </div>

      {corrections
        .filter((correction) => correction.stage_id === stage.id)
        .map((correction) => {
          const pinImage = correction.image_id === null ? null : commissionImages.find((image) => image.id === correction.image_id);

          return (
            <div key={correction.id} className="group flex items-baseline gap-3 py-1 text-sm">
              <input
                type="checkbox"
                checked={correction.done_at !== null}
                onChange={() => toggleDone(correction)}
                title={correction.done_at === null ? t("Mark as done") : t("Mark as not done")}
                className="shrink-0 self-center"
              />
              <span className="w-14 shrink-0 text-xs text-faint">
                {new Date(correction.created_at).toLocaleDateString(locale, { day: "numeric", month: "short" })}
              </span>
              {pinImage && (
                <button
                  type="button"
                  title={t("Show on the image")}
                  onClick={() => setFocusImageId(pinImage.id)}
                  className="chip chip-warn shrink-0 self-center"
                >
                  {pinNumber(corrections, correction)}
                  <span className="font-semibold">· v{pinImage.version}</span>
                </button>
              )}
              <span className={`flex-1 whitespace-pre-wrap ${correction.done_at !== null ? "text-faint line-through" : ""}`}>{correction.text}</span>
              <button
                type="button"
                title={t("Remove correction")}
                onClick={() => remove(correction)}
                className="text-faint opacity-0 transition group-hover:opacity-100 hover:text-tone-bad focus-visible:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}

      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={async (event) => {
          if (event.key === "Escape") onClose();
          if (event.key !== "Enter" || !draft.trim()) return;

          try {
            await addCorrection(commissionId, stage.id, draft);
            setDraft("");
            setCorrections(await getAllCorrections());
          } catch (error) {
            showToast(error instanceof Error ? error.message : `${error}`, "error");
          }
        }}
        placeholder={t("What did the client ask to change? Enter to add")}
        className="mt-2 w-full rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink"
      />

      {stageImages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {stageImages.map((image) => (
            <button
              key={image.id}
              type="button"
              disabled={importingStageId !== null}
              onClick={() => addVersion(image)}
              className="rounded-sm border border-line-strong px-2.5 py-1 text-xs font-semibold text-muted transition hover:border-ink hover:text-ink disabled:opacity-50"
            >
              {stageImages.length > 1 ? t("Upload retouched version · {name}", { name: image.label }) : t("Upload retouched version")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default CorrectionsPanel;
