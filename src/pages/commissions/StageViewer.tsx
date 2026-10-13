import type { ReactNode } from "react";
import { IconCheck, IconPhotoPlus } from "@tabler/icons-react";
import { t } from "../../lib/i18n";
import { imageUrl, thumbUrl } from "../../lib/images";
import type { CommissionCorrection, CommissionStageImage, TemplateStage } from "../../lib/database";

/**
 * The stages of a commission: the image of the chosen stage big (with its alternatives and versions),
 * and below it the strip of stages to choose from. Every stage is also a drop zone for images.
 */
function StageViewer({
  commissionId,
  stages,
  currentStageIndex,
  viewStageId,
  setViewStageId,
  getStageImages,
  getVersions,
  versionLabel,
  getActiveIndex,
  setActiveIndex,
  importingStageId,
  dragZoneId,
  addImages,
  addVersion,
  deleteImage,
  setFocusImageId,
  setHoveredImagePath,
  corrections,
  correctionsStageId,
  toggleCorrections,
  correctionsPanel,
}: {
  commissionId: number;
  /** Visible stages (the last one stays hidden until the commission is finished) */
  stages: TemplateStage[];
  currentStageIndex: number;
  viewStageId: number | null;
  setViewStageId: (id: number) => void;
  getStageImages: (commissionId: number, stageId: number) => CommissionStageImage[];
  getVersions: (image: CommissionStageImage) => CommissionStageImage[];
  versionLabel: (image: CommissionStageImage, versions: CommissionStageImage[], done: boolean) => string;
  getActiveIndex: (stageId: number, images: CommissionStageImage[]) => number;
  setActiveIndex: (stageId: number, index: number) => void;
  importingStageId: number | null;
  dragZoneId: string | null;
  addImages: (stageId: number) => void;
  addVersion: (image: CommissionStageImage) => void;
  deleteImage: (imageId: number) => void;
  setFocusImageId: (id: number | null) => void;
  setHoveredImagePath: (path: string | null) => void;
  corrections: CommissionCorrection[];
  correctionsStageId: number | null;
  toggleCorrections: (stageId: number) => void;
  /** Open corrections of a stage, shown under the strip */
  correctionsPanel: ReactNode;
}) {
  // The stage chosen in the strip; until one is chosen, the current stage
  const viewIndex = stages.findIndex((item) => item.id === viewStageId);
  const stageIndex = viewIndex >= 0 ? viewIndex : Math.min(Math.max(currentStageIndex, 0), stages.length - 1);
  const stage = stages[stageIndex];
  const images = getStageImages(commissionId, stage.id);
  const imageIndex = getActiveIndex(stage.id, images);
  const image = images[imageIndex] ?? null;
  const isDone = stageIndex < currentStageIndex;
  const isCurrent = stageIndex === currentStageIndex;
  const isDropTarget = dragZoneId === `stage:${stage.id}`;
  const overlay = "flex h-7 items-center justify-center rounded-sm bg-black/65 px-2 text-xs font-bold text-white hover:bg-black/85 disabled:opacity-50";

  return (
    <div className="grid min-h-0 min-w-0 gap-3.5 p-4 @min-[760px]:h-full @min-[760px]:grid-rows-[minmax(14rem,1fr)_auto] @min-[760px]:overflow-y-auto">
      <div data-image-drop={`stage:${stage.id}`} className={`relative grid h-[clamp(280px,48vh,520px)] min-h-0 place-items-center [container-type:size] @min-[760px]:h-auto ${isDropTarget ? "opacity-60" : ""}`}>
        {image ? (
          <div className="group relative inline-block">
            <button
              type="button"
              title={t("Open in focus mode")}
              onClick={() => setFocusImageId(image.id)}
              onMouseEnter={() => setHoveredImagePath(image.image_data_url)}
              onMouseLeave={() => setHoveredImagePath(null)}
              className="block cursor-zoom-in"
            >
              <img
                src={imageUrl(image.image_data_url)}
                alt={`${stage.name} · ${image.label}`}
                className="block max-h-[100cqh] max-w-[100cqw] rounded-md object-contain shadow-md ring-1 ring-line"
              />
            </button>

            {(getVersions(image).length > 1 || isDone) && (
              <span className="absolute top-2 left-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-xs font-bold text-white">
                {versionLabel(image, getVersions(image), isDone)}
              </span>
            )}

            {images.length > 1 && (
              <span className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-md bg-black/65 p-0.5 text-xs whitespace-nowrap text-white">
                <button
                  type="button"
                  title={t("Previous alt")}
                  onClick={() => setActiveIndex(stage.id, (imageIndex - 1 + images.length) % images.length)}
                  className="h-6 w-6 rounded-sm hover:bg-white/15"
                >
                  ‹
                </button>
                <span className="px-1.5 tabular-nums">{t("Alt {n} of {total}", { n: imageIndex + 1, total: images.length })}</span>
                <button
                  type="button"
                  title={t("Next alt")}
                  onClick={() => setActiveIndex(stage.id, (imageIndex + 1) % images.length)}
                  className="h-6 w-6 rounded-sm hover:bg-white/15"
                >
                  ›
                </button>
              </span>
            )}

            <span className="absolute top-2 right-2 flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              <button type="button" title={t("Add an alt")} disabled={importingStageId !== null} onClick={() => addImages(stage.id)} className={overlay}>
                + Alt
              </button>
              <button type="button" title={t("New version of this image (retouched)")} disabled={importingStageId !== null} onClick={() => addVersion(image)} className={overlay}>
                + v
              </button>
              <button type="button" title={t("Remove this image")} onClick={() => deleteImage(image.id)} className={`${overlay} w-7 px-0 hover:bg-tone-bad`}>
                ×
              </button>
            </span>

            {importingStageId === stage.id && <span className="absolute right-2 bottom-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-xs text-white">{t("Optimizing…")}</span>}
          </div>
        ) : (
          <button
            type="button"
            disabled={importingStageId !== null}
            onClick={() => addImages(stage.id)}
            className={`flex h-[min(100cqh,320px)] w-[min(100cqw,420px)] flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center text-sm transition ${
              isDropTarget ? "border-ink bg-highlight text-ink" : "border-line-strong text-faint hover:border-ink hover:text-ink"
            }`}
          >
            <IconPhotoPlus size={28} stroke={1.5} aria-hidden="true" />
            {importingStageId === stage.id ? t("Optimizing…") : isCurrent ? t("Drop or Ctrl+V") : t("Drop here")}
          </button>
        )}
      </div>

      <div className="grid gap-3">
        <div role="group" aria-label={t("Stages")} className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-x-2.5 gap-y-3 p-1">
          {stages.map((item, index) => {
            const itemImages = getStageImages(commissionId, item.id);
            const thumb = itemImages[getActiveIndex(item.id, itemImages)] ?? null;
            const done = index < currentStageIndex;
            const current = index === currentStageIndex;
            const selected = index === stageIndex;
            const own = corrections.filter((correction) => correction.stage_id === item.id);
            const pending = own.filter((correction) => correction.done_at === null).length;
            const open = correctionsStageId === item.id;

            return (
              <div key={item.id} data-image-drop={`stage:${item.id}`} className={`min-w-0 ${dragZoneId === `stage:${item.id}` ? "opacity-60" : ""}`}>
                <button
                  type="button"
                  onClick={() => setViewStageId(item.id)}
                  aria-pressed={selected}
                  title={item.name}
                  className={`flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border bg-paper transition ${
                    thumb ? "border-line" : "border-dashed border-line-strong text-faint hover:border-ink hover:text-ink"
                  } ${selected ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
                >
                  {thumb ? <img src={thumbUrl(thumb.image_data_url)} loading="lazy" decoding="async" alt="" className="h-full w-full object-cover" /> : <span className="text-lg">+</span>}
                </button>

                <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      done ? "bg-tone-ok text-on-tone" : current ? "bg-primary text-on-primary" : "border border-line-strong text-faint"
                    }`}
                  >
                    {done ? <IconCheck size={10} stroke={3} aria-hidden="true" /> : index + 1}
                  </span>
                  <span className={`truncate ${current ? "font-bold" : done ? "font-semibold" : "text-faint"}`}>{item.name}</span>
                </p>

                <button
                  type="button"
                  onClick={() => toggleCorrections(item.id)}
                  aria-expanded={open}
                  className={`mt-0.5 max-w-full self-start truncate rounded-sm px-1 py-0.5 text-xs transition ${
                    pending > 0 ? "bg-tone-warn/15 font-semibold text-ink" : open ? "text-ink" : "text-faint hover:text-ink"
                  }`}
                >
                  {own.length > 0 ? t(own.length === 1 ? "{n} correction" : "{n} corrections", { n: own.length }) : t("+ correction")}
                  {own.length > 0 && pending === 0 ? " ✓" : ""}
                  {open ? " ▴" : own.length > 0 ? " ▾" : ""}
                </button>
              </div>
            );
          })}
        </div>

        {correctionsPanel}
      </div>
    </div>
  );
}

export default StageViewer;
