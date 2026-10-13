import { useEffect, useState, type CSSProperties } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { t } from "../../lib/i18n";
import {
  appSettings,
  getTemplateStages,
  saveTemplateStages,
  updateTemplateBasePrice,
  updateTemplateName,
  updateTemplateRevisions,
  type Commission,
  type StageDraft,
  type Template,
} from "../../lib/database";
import { formatMoney, parsePrice } from "../../lib/commissionHelpers";
import { PALETTE } from "../../lib/catalog";
import { tintStrengths } from "../../lib/ambient";
import { useToast } from "../../context/ToastContext";
import Swatches from "./Swatches";

// `key` only serves the draggable list: new stages have no id yet
type EditableStage = StageDraft & { key: string };

export type TypeFigures = { n: number; avgPrice: number | null; avgHours: number | null; rate: number | null };

function StageRow({
  stage,
  index,
  isLast,
  onRename,
  onRemove,
}: {
  stage: EditableStage;
  index: number;
  isLast: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={stage}
      dragListener={false}
      dragControls={dragControls}
      className={`mb-1.5 flex items-center gap-2 rounded-md border bg-surface px-1.5 py-1.5 ${isLast ? "border-dashed border-line-strong" : "border-line"}`}
    >
      <span
        title={t("Drag to reorder")}
        onPointerDown={(event) => dragControls.start(event)}
        className="cursor-grab touch-none px-1 text-faint select-none active:cursor-grabbing"
      >
        ⋮⋮
      </span>

      <span
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isLast ? "bg-tone-ok text-on-tone" : "bg-highlight text-ink"
        }`}
      >
        {index + 1}
      </span>

      <input
        value={stage.name}
        onChange={(event) => onRename(event.target.value)}
        aria-label={t("Stage {n}", { n: index + 1 })}
        className="min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 outline-none hover:border-line focus:border-ink focus:bg-paper"
      />

      <button
        type="button"
        title={t("Remove stage")}
        onClick={onRemove}
        className="rounded-sm px-2 py-0.5 text-faint transition hover:bg-tone-bad/10 hover:text-tone-bad"
      >
        ×
      </button>
    </Reorder.Item>
  );
}

/** Editor of a commission type (template): name, price, revisions, colour and stages; beside it, what uses it. */
function TypeEditor({
  template,
  inProgress,
  figures,
  onSaved,
  onColor,
  onDuplicate,
  onDelete,
  onOpenCommission,
}: {
  template: Template;
  inProgress: Commission[];
  figures: TypeFigures;
  /** Saved: the parent reloads the catalog */
  onSaved: () => Promise<void>;
  onColor: (color: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenCommission: (commission: Commission) => void;
}) {
  const [name, setName] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [revisions, setRevisions] = useState("");
  const [stages, setStages] = useState<EditableStage[]>([]);
  const [newStageName, setNewStageName] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  // Switching to another type loads its stages and fields
  useEffect(() => {
    let current = true;

    setName(template.name);
    setBasePrice(template.base_price !== null ? String(template.base_price).replace(".", ",") : "");
    setRevisions(template.revisions_included !== null ? String(template.revisions_included) : "");
    setNewStageName("");
    loadStages().then((list) => current && setStages(list)).catch(console.error);

    return () => {
      current = false;
    };
  }, [template.id]);

  const loadStages = async () =>
    (await getTemplateStages(template.id)).map(({ id, name: stageName }) => ({ id, name: stageName, key: String(id) }));

  function handleAddStage() {
    const stageName = newStageName.trim();

    if (!stageName) return;

    setStages((current) => [...current, { id: null, name: stageName, key: crypto.randomUUID() }]);
    setNewStageName("");
  }

  async function handleSave() {
    try {
      setSaving(true);
      await updateTemplateName(template.id, name);
      await updateTemplateBasePrice(template.id, parsePrice(basePrice));
      // Empty = no revision limit
      await updateTemplateRevisions(template.id, revisions.trim() === "" ? null : Math.max(0, Math.round(Number(revisions)) || 0));
      await saveTemplateStages(template.id, stages);
      await onSaved();
      // New stages now have their ids; without them a second save would remove and recreate them
      setStages(await loadStages());
      showToast("Template saved.", "success");
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : `Save error: ${error}`, "error");
    } finally {
      setSaving(false);
    }
  }

  const strengths = tintStrengths(template.color);
  const heroStyle = { "--tint": template.color, "--ts-light": strengths.light, "--ts-dark": strengths.dark } as CSSProperties;
  const field = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm font-semibold outline-none focus:border-ink";
  const btn =
    "rounded-2xl border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition hover:bg-highlight active:scale-[0.97] disabled:opacity-50";

  return (
    <>
      <div className="hero-tint shrink-0 px-6 pt-4 pb-4" style={heroStyle}>
        <span className="text-xs text-faint">{t("Commission type")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("Template name")}
          aria-label={t("Template name")}
          className="-ml-1 block w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-display text-3xl leading-tight font-semibold tracking-tight outline-none hover:border-line focus:border-line-strong focus:bg-paper"
        />

        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3 text-xs text-faint">
          <label className="grid gap-1">
            {t("Base price")}
            <input value={basePrice} onChange={(event) => setBasePrice(event.target.value)} placeholder="160" inputMode="decimal" className={`${field} w-28 tabular-nums`} />
          </label>
          <label className="grid gap-1">
            {t("Revisions included")}
            <input type="number" min={0} value={revisions} onChange={(event) => setRevisions(event.target.value)} placeholder="—" className={`${field} w-28 tabular-nums`} />
          </label>
          <div className="grid gap-1">
            {t("Colour")}
            <Swatches colors={PALETTE} value={template.color} onChange={onColor} />
          </div>
        </div>
        <p className="mt-2 text-xs text-faint">
          {t("The base price is for one character · +{n}% per extra character · the colour is the bar and chip of every commission of this type · revisions: each client correction counts as one, empty = no limit", {
            n: Math.round(appSettings().extra_character_rate * 100),
          })}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto border-t border-line @min-[700px]:grid-cols-[minmax(0,1fr)_clamp(240px,32%,300px)] @min-[700px]:overflow-hidden">
        <div className="min-w-0 p-5 @min-[700px]:overflow-y-auto">
          <p className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
            {t("Stages")} <span className="font-medium text-faint tabular-nums">{stages.length}</span>
          </p>

          <Reorder.Group axis="y" values={stages} onReorder={setStages} className="max-w-[560px]">
            {stages.map((stage, index) => (
              <StageRow
                key={stage.key}
                stage={stage}
                index={index}
                isLast={index === stages.length - 1}
                onRename={(stageName) => setStages((current) => current.map((item) => (item.key === stage.key ? { ...item, name: stageName } : item)))}
                onRemove={() => setStages((current) => current.filter((item) => item.key !== stage.key))}
              />
            ))}
          </Reorder.Group>

          <input
            value={newStageName}
            onChange={(event) => setNewStageName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleAddStage();
            }}
            placeholder={t("Add a stage and press Enter")}
            className="mt-2 w-full max-w-[560px] rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink"
          />
          <p className="mt-2 max-w-[480px] text-xs text-faint">{t("The last stage stays hidden until you press “Mark as finished” on the commission.")}</p>
        </div>

        <div className="grid min-w-0 content-start gap-5 border-t border-line p-4 @min-[700px]:overflow-y-auto @min-[700px]:border-t-0 @min-[700px]:border-l">
          <div>
            <p className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
              {t("In progress")} <span className="font-medium text-faint tabular-nums">{inProgress.length}</span>
            </p>
            {inProgress.length === 0 ? (
              <p className="text-faint">{t("None right now.")}</p>
            ) : (
              inProgress.map((commission) => (
                <button
                  key={commission.id}
                  type="button"
                  title={t("Open commission")}
                  onClick={() => onOpenCommission(commission)}
                  className="block w-full truncate rounded-md px-1.5 py-1.5 text-left transition hover:bg-highlight/60"
                >
                  <span className="font-semibold">{commission.title}</span>
                </button>
              ))
            )}
          </div>

          <div>
            <p className="mb-2 text-[13px] font-semibold">{t("Finished")}</p>
            {figures.n === 0 ? (
              <p className="text-faint">{t("You haven't delivered any yet.")}</p>
            ) : (
              <dl className="grid tabular-nums">
                {[
                  [t("Delivered"), figures.n],
                  [t("Average price"), figures.avgPrice !== null ? formatMoney(figures.avgPrice) : "—"],
                  [t("Average hours"), figures.avgHours !== null ? `${String(figures.avgHours).replace(".", ",")} h` : "—"],
                  [t("Per hour"), figures.rate !== null ? formatMoney(figures.rate) : "—"],
                ].map(([label, value], index) => (
                  <div key={label} className={`flex items-baseline justify-between gap-2.5 py-2 ${index > 0 ? "border-t border-line" : ""}`}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface/60 px-4 py-2.5">
        <button type="button" onClick={onDuplicate} className={btn}>
          {t("Duplicate")}
        </button>
        <button type="button" onClick={onDelete} className={`${btn} text-tone-bad`}>
          {t("Delete")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="ml-auto rounded-2xl bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover active:scale-[0.97] disabled:opacity-50"
        >
          {saving ? t("Saving…") : t("Save changes")}
        </button>
      </div>
    </>
  );
}

export default TypeEditor;
