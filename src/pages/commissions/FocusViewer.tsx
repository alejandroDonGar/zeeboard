import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { imageUrl } from "../../lib/images";
import { pinNumber } from "../../lib/commissionHelpers";
import { addCorrection, getAllCorrections, type CommissionCorrection, type CommissionStageImage, type TemplateStage } from "../../lib/database";
import AmbientBackground from "../../components/AmbientBackground";
import { useToast } from "../../context/ToastContext";

export type FocusItem = { image: CommissionStageImage; stage: TemplateStage };

/**
 * Focus mode: one image at a time over a dark background, with versions, correction pins and arrows to move.
 * Mounted only while open, so the pin tools start closed every time.
 */
function FocusViewer({
  commissionId,
  focusImages,
  focusIndex,
  focusImageId,
  setFocusImageId,
  getVersions,
  versionLabel,
  workflowStages,
  currentStageIndex,
  activeCorrections,
  setCorrections,
  toggleCorrectionDone,
  removeCorrection,
  importingStageId,
  handleAddVersion,
}: {
  commissionId: number | null;
  focusImages: FocusItem[];
  focusIndex: number;
  focusImageId: number | null;
  setFocusImageId: (id: number | null) => void;
  getVersions: (image: CommissionStageImage) => CommissionStageImage[];
  versionLabel: (image: CommissionStageImage, versions: CommissionStageImage[], done: boolean) => string;
  workflowStages: TemplateStage[];
  currentStageIndex: number;
  activeCorrections: CommissionCorrection[];
  setCorrections: (corrections: CommissionCorrection[]) => void;
  toggleCorrectionDone: (correction: CommissionCorrection) => Promise<void>;
  removeCorrection: (correction: CommissionCorrection) => Promise<void>;
  importingStageId: number | null;
  handleAddVersion: (image: CommissionStageImage) => Promise<void>;
}) {
  // Correction pins: placing one, writing it, or reading an existing one
  const [pinMode, setPinMode] = useState(false);
  const [pinDraft, setPinDraft] = useState<{ x: number; y: number; text: string } | null>(null);
  const [openPinId, setOpenPinId] = useState<number | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // First Esc leaves the pin tools; the next one closes the view
        if (pinMode || pinDraft || openPinId !== null) {
          setPinMode(false);
          setPinDraft(null);
          setOpenPinId(null);
        } else {
          setFocusImageId(null);
        }
        return;
      }

      // Arrows move the text cursor while writing a pin
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight") setFocusImageId(focusImages[(focusIndex + 1) % focusImages.length].image.id);
      if (event.key === "ArrowLeft")
        setFocusImageId(focusImages[(focusIndex - 1 + focusImages.length) % focusImages.length].image.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Another image, or leaving focus mode: nothing of the pin tools stays open
  useEffect(() => {
    setPinDraft(null);
    setOpenPinId(null);
  }, [focusImageId]);


  return (
    <div
      role="dialog" aria-modal="true" aria-label={t("Open in focus mode")}
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden bg-[#0e0e10]"
      onClick={() => setFocusImageId(null)}
    >
      <AmbientBackground strong />
      {(() => {
        const { image: current, stage } = focusImages[focusIndex];
        const versions = getVersions(current);
        const shown = versions.find((version) => version.id === focusImageId) ?? current;
        const done = workflowStages.findIndex((item) => item.id === stage.id) < currentStageIndex;
        const pins = activeCorrections.filter((correction) => correction.image_id === shown.id && correction.x !== null && correction.y !== null);
        // Pending pins from earlier versions of this alternative show faded on the new one
        const earlier = versions.filter((version) => version.version < shown.version);
        const ghosts = activeCorrections.filter(
          (correction) =>
            correction.done_at === null &&
            correction.x !== null &&
            correction.y !== null &&
            earlier.some((version) => version.id === correction.image_id),
        );
        const openPin = [...pins, ...ghosts].find((correction) => correction.id === openPinId) ?? null;
        // Keeps the text box inside the image when a pin sits near an edge
        const boxLeft = (x: number) => `${Math.min(Math.max(x, 0.15), 0.85) * 100}%`;

        return (
          <>
            <div
              className={`relative ${pinMode ? "cursor-crosshair" : ""}`}
              onClick={(event) => {
                if (!pinMode) return;

                event.stopPropagation();
                const box = event.currentTarget.getBoundingClientRect();
                setOpenPinId(null);
                setPinDraft({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, text: "" });
              }}
            >
              <img
                src={imageUrl(shown.image_data_url)}
                alt=""
                className="block max-h-[88vh] max-w-[94vw] object-contain"
              />

              {ghosts.map((correction) => (
                <button
                  key={correction.id}
                  type="button"
                  title={correction.text}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPinDraft(null);
                    setOpenPinId(openPinId === correction.id ? null : correction.id);
                  }}
                  style={{ left: `${(correction.x ?? 0) * 100}%`, top: `${(correction.y ?? 0) * 100}%` }}
                  className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed border-white bg-amber-400/50 text-xs font-black text-black"
                >
                  {pinNumber(activeCorrections, correction)}
                </button>
              ))}

              {pins.map((correction) => (
                <button
                  key={correction.id}
                  type="button"
                  title={correction.text}
                  onClick={(event) => {
                    event.stopPropagation();
                    setPinDraft(null);
                    setOpenPinId(openPinId === correction.id ? null : correction.id);
                  }}
                  style={{ left: `${(correction.x ?? 0) * 100}%`, top: `${(correction.y ?? 0) * 100}%` }}
                  className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-black shadow-lg ring-2 ring-white ${
                    correction.done_at === null ? "bg-amber-400 text-black" : "bg-green-500 text-white"
                  }`}
                >
                  {correction.done_at === null ? pinNumber(activeCorrections, correction) : "✓"}
                </button>
              ))}

              {openPin && (
                <div
                  onClick={(event) => event.stopPropagation()}
                  style={{ left: boxLeft(openPin.x ?? 0), top: `${(openPin.y ?? 0) * 100}%` }}
                  className="absolute z-10 mt-4 w-60 -translate-x-1/2 rounded-md bg-surface p-2.5 text-sm text-ink shadow-2xl"
                >
                  {openPin.image_id !== shown.id && (
                    <p className="mb-1 text-xs text-faint">
                      {t("From v{n}", { n: versions.find((version) => version.id === openPin.image_id)?.version ?? "" })}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{openPin.text}</p>
                  <div className="mt-1.5 flex gap-3 text-xs">
                    <button type="button" onClick={() => { setOpenPinId(null); toggleCorrectionDone(openPin); }} className="font-semibold hover:underline">
                      {openPin.done_at === null ? t("Mark as done") : t("Mark as not done")}
                    </button>
                    <button type="button" onClick={() => { setOpenPinId(null); removeCorrection(openPin); }} className="text-faint hover:text-tone-bad">
                      {t("Remove correction")}
                    </button>
                  </div>
                </div>
              )}

              {pinDraft && (
                <>
                  <span
                    style={{ left: `${pinDraft.x * 100}%`, top: `${pinDraft.y * 100}%` }}
                    className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-400/70 text-xs font-black text-black ring-2 ring-white"
                  >
                    {activeCorrections.filter((correction) => correction.image_id === shown.id).length + 1}
                  </span>
                  <input
                    autoFocus
                    value={pinDraft.text}
                    onChange={(event) => setPinDraft({ ...pinDraft, text: event.target.value })}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={async (event) => {
                      if (event.key !== "Enter" || !pinDraft.text.trim() || commissionId === null) return;

                      try {
                        await addCorrection(commissionId, stage.id, pinDraft.text, { imageId: shown.id, x: pinDraft.x, y: pinDraft.y });
                        setPinDraft(null);
                        setCorrections(await getAllCorrections());
                      } catch (error) {
                        showToast(error instanceof Error ? error.message : `${error}`, "error");
                      }
                    }}
                    placeholder={t("What should change here? Enter to add")}
                    style={{ left: boxLeft(pinDraft.x), top: `${pinDraft.y * 100}%` }}
                    className="absolute z-10 mt-4 w-64 -translate-x-1/2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink shadow-2xl outline-none focus:border-ink"
                  />
                </>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm text-white/80" onClick={(event) => event.stopPropagation()}>
              <span>
                {stage.name} · {shown.label}
              </span>
              {versions.length > 1 &&
                versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setFocusImageId(version.id)}
                    className={`rounded-sm px-2 py-0.5 text-xs font-bold ${
                      version.id === shown.id ? "bg-white text-black" : "bg-white/20 text-white hover:bg-white/30"
                    }`}
                  >
                    {versionLabel(version, versions, done)}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => {
                  setPinMode(!pinMode);
                  setPinDraft(null);
                  setOpenPinId(null);
                }}
                className={`rounded-sm px-2 py-0.5 text-xs font-bold ${
                  pinMode ? "bg-amber-400 text-black" : "bg-white/20 text-white hover:bg-white/30"
                }`}
              >
                {pinMode ? t("Click the image to add a correction") : t("+ Correction pin")}
              </button>
              <button
                type="button"
                disabled={importingStageId !== null}
                onClick={() => handleAddVersion(shown)}
                className="rounded-sm bg-white/20 px-2 py-0.5 text-xs font-bold text-white hover:bg-white/30 disabled:opacity-50"
              >
                {t("+ New version")}
              </button>
              <span className="text-white/50">
                {focusIndex + 1} / {focusImages.length} · ← → to move · Esc to close
              </span>
            </div>
          </>
        );
      })()}
    </div>
  );
}

export default FocusViewer;
