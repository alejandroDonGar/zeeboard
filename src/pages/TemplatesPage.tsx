import { t } from "../lib/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getCommissions,
  getTemplateStages,
  getTemplates,
  saveTemplateStages,
  updateTemplateBasePrice,
  updateTemplateRevisions,
  appSettings,
  updateTemplateName,
  updateTemplateColor,
  type StageDraft,
  type Template,
} from "../lib/database";
import { formatMoney, parsePrice } from "../lib/commissionHelpers";
import PageHeader from "../components/PageHeader";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../context/ToastContext";
import { undoToast } from "../lib/undo";
import { PALETTE } from "../lib/catalog";

// `key` only serves the draggable list: new stages have no id yet
type EditableStage = StageDraft & { key: string };

type TemplateSummary = { stages: number; commissions: number };

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
      className="flex items-center gap-3 border-b border-line bg-surface px-2 py-2"
    >
      <span
        title={t("Drag to reorder")}
        onPointerDown={(event) => dragControls.start(event)}
        className="cursor-grab touch-none select-none px-1 text-faint active:cursor-grabbing"
      >
        ⋮⋮
      </span>

      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isLast ? "bg-tone-ok text-on-tone" : "bg-primary text-on-primary"
        }`}
      >
        {index + 1}
      </span>

      <input
        value={stage.name}
        onChange={(event) => onRename(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold outline-none hover:border-line focus:border-ink focus:bg-paper"
      />

      <button
        type="button"
        title={t("Remove stage")}
        onClick={onRemove}
        className="rounded-sm px-2 py-1 text-sm text-faint transition hover:bg-tone-bad/10 hover:text-tone-bad"
      >
        ×
      </button>
    </Reorder.Item>
  );
}

function TemplatesPage({ tabs }: { tabs?: ReactNode }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ready, setReady] = useState(false);
  const [summaries, setSummaries] = useState<Record<number, TemplateSummary>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editBasePrice, setEditBasePrice] = useState("");
  const [editRevisions, setEditRevisions] = useState("");
  const [editStages, setEditStages] = useState<EditableStage[]>([]);
  const [newStageName, setNewStageName] = useState("");
  const [saving, setSaving] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { showToast } = useToast();

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;

  async function loadTemplates(selectId?: number) {
    const [data, commissions] = await Promise.all([getTemplates(), getCommissions()]);
    const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name));

    const entries = await Promise.all(
      sorted.map(async (template) => {
        const stages = await getTemplateStages(template.id);
        const used = commissions.filter((commission) => commission.template_id === template.id);
        return [template.id, { stages: stages.length, commissions: used.length }] as const;
      }),
    );

    setTemplates(sorted);
    setSummaries(Object.fromEntries(entries));

    const nextId = selectId ?? selectedTemplateId ?? sorted[0]?.id ?? null;
    await selectTemplate(sorted.find((template) => template.id === nextId) ?? sorted[0] ?? null);
    setReady(true);
  }

  async function selectTemplate(template: Template | null) {
    setSelectedTemplateId(template?.id ?? null);
    setNewStageName("");

    if (!template) {
      setEditName("");
      setEditBasePrice("");
      setEditRevisions("");
      setEditStages([]);
      return;
    }

    const stages = await getTemplateStages(template.id);
    setEditName(template.name);
    setEditBasePrice(template.base_price !== null ? String(template.base_price).replace(".", ",") : "");
    setEditRevisions(template.revisions_included !== null ? String(template.revisions_included) : "");
    setEditStages(stages.map(({ id, name }) => ({ id, name, key: String(id) })));
  }

  useEffect(() => {
    loadTemplates().catch(console.error);
  }, []);

  function handleAddStage() {
    const name = newStageName.trim();

    if (!name) {
      return;
    }

    setEditStages((current) => [...current, { id: null, name, key: crypto.randomUUID() }]);
    setNewStageName("");
  }

  async function handleSave() {
    if (!selectedTemplate) {
      return;
    }

    try {
      setSaving(true);
      await updateTemplateName(selectedTemplate.id, editName);
      await updateTemplateBasePrice(selectedTemplate.id, parsePrice(editBasePrice));
      // Empty = no revision limit
      await updateTemplateRevisions(
        selectedTemplate.id,
        editRevisions.trim() === "" ? null : Math.max(0, Math.round(Number(editRevisions)) || 0),
      );
      await saveTemplateStages(selectedTemplate.id, editStages);
      await loadTemplates(selectedTemplate.id);
      showToast("Template saved.", "success");
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : `Save error: ${error}`, "error");
    } finally {
      setSaving(false);
    }
  }

  /** The colour is saved straight away: it is what every commission of this type shows */
  async function handleColor(color: string) {
    if (!selectedTemplate) return;

    try {
      await updateTemplateColor(selectedTemplate.id, color);
      setTemplates((current) => current.map((template) => (template.id === selectedTemplate.id ? { ...template, color } : template)));
    } catch (error) {
      console.error(error);
      showToast(`Save error: ${error}`, "error");
    }
  }

  async function handleNewTemplate() {
    try {
      await createTemplate("Untitled template", []);
      // The new one has the highest id
      const data = await getTemplates();
      await loadTemplates(Math.max(...data.map((template) => template.id)));
    } catch (error) {
      console.error(error);
      showToast(`Template error: ${error}`, "error");
    }
  }

  async function handleDuplicate(templateId: number) {
    try {
      await duplicateTemplate(templateId);
      const data = await getTemplates();
      await loadTemplates(Math.max(...data.map((template) => template.id)));
    } catch (error) {
      console.error(error);
      showToast(`Duplicate error: ${error}`, "error");
    }
  }

  async function confirmDelete() {
    if (!templateToDelete) {
      return;
    }

    try {
      const trashId = await deleteTemplate(templateToDelete.id);
      setTemplateToDelete(null);
      setSelectedTemplateId(null);
      await loadTemplates(-1);
      undoToast(showToast, "Template deleted.", trashId);
    } catch (error) {
      console.error(error);
      setTemplateToDelete(null);
      setErrorMessage(error instanceof Error ? error.message : "Could not delete template.");
    }
  }

  function summaryLabel(templateId: number) {
    const summary = summaries[templateId];

    if (!summary) {
      return "";
    }

    const template = templates.find((item) => item.id === templateId);
    const stages = [
      template?.base_price != null ? formatMoney(template.base_price) : null,
      t(summary.stages === 1 ? "{n} stage" : "{n} stages", { n: summary.stages }),
    ]
      .filter(Boolean)
      .join(" · ");
    return summary.commissions > 0 ? `${stages} · ${t("{n} in use", { n: summary.commissions })}` : stages;
  }

  return (
    <>
      <PageHeader
        title={t("Catalog")}
        description={t("Each type of commission: its stages, price and colour.")}
        action={t("+ New template")}
        onAction={handleNewTemplate}
      >
        {tabs}
      </PageHeader>

      <section className="grid h-[calc(100vh-117px)] min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-5 overflow-hidden p-5 pb-6">
        <div className="min-h-0 space-y-0.5 overflow-y-auto panel rounded-3xl p-3">
          {!ready ? null : templates.length === 0 ? (
            <p className="p-4 text-center text-sm text-faint">{t("No templates yet. Create one on the right.")}</p>
          ) : (
            templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => selectTemplate(template)}
                className={`w-full rounded-md px-3 py-2 text-left transition ${
                  template.id === selectedTemplateId ? "bg-highlight" : "hover:bg-paper"
                }`}
              >
                <p className="flex items-center gap-2 truncate text-sm font-bold">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: template.color }} />
                  <span className="truncate">{template.name}</span>
                </p>
                <p className="text-xs text-faint">{summaryLabel(template.id)}</p>
              </button>
            ))
          )}
        </div>

        <div className="flex min-h-0 flex-col panel rounded-3xl p-6">
          {!ready ? null : !selectedTemplate ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-lg font-black">{t("Create your first template")}</p>
              <p className="mt-1 text-sm text-muted">
                {t("A template is the list of stages a commission moves through.")}
              </p>
              <button
                type="button"
                onClick={handleNewTemplate}
                className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary"
              >
                {t("New template")}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder={t("Template name")}
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-black outline-none hover:border-line focus:border-ink"
                />

                <button
                  type="button"
                  onClick={() => handleDuplicate(selectedTemplate.id)}
                  className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-ink"
                >
                  {t("Duplicate")}
                </button>

                <button
                  type="button"
                  onClick={() => setTemplateToDelete(selectedTemplate)}
                  className="rounded-md px-3 py-1.5 text-xs font-semibold text-tone-bad transition hover:bg-tone-bad/10"
                >
                  {t("Delete")}
                </button>
              </div>

              <label className="mt-4 flex items-center gap-3 px-2 text-sm">
                <span className="text-muted">{t("Base price")}</span>
                <input
                  value={editBasePrice}
                  onChange={(event) => setEditBasePrice(event.target.value)}
                  placeholder="160"
                  inputMode="decimal"
                  className="w-28 rounded-md border border-line-strong bg-paper px-2 py-1 text-sm font-bold outline-none focus:border-ink"
                />
                <span className="text-xs text-faint">
                  for one character · +{Math.round(appSettings().extra_character_rate * 100)}% per extra character
                </span>
              </label>

              <div className="mt-2 flex flex-wrap items-center gap-3 px-2 text-sm">
                <span className="text-muted">{t("Colour")}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      title={color}
                      aria-label={color}
                      aria-pressed={selectedTemplate.color === color}
                      onClick={() => handleColor(color)}
                      className={`h-6 w-6 rounded-sm transition hover:scale-110 ${
                        selectedTemplate.color === color ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : ""
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <label
                    title={t("Custom colour")}
                    className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm border border-dashed border-line-strong text-xs text-muted hover:text-ink"
                  >
                    +
                    <input
                      type="color"
                      value={selectedTemplate.color}
                      onChange={(event) => handleColor(event.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </label>
                </div>
                <span className="text-xs text-faint">{t("the bar and chip of every commission of this type")}</span>
              </div>

              <label className="mt-2 flex items-center gap-3 px-2 text-sm">
                <span className="text-muted">{t("Revisions included")}</span>
                <input
                  type="number"
                  min={0}
                  value={editRevisions}
                  onChange={(event) => setEditRevisions(event.target.value)}
                  placeholder="—"
                  className="w-20 rounded-md border border-line-strong bg-paper px-2 py-1 text-sm font-bold outline-none focus:border-ink"
                />
                <span className="text-xs text-faint">each client correction counts as one · empty = no limit</span>
              </label>

              <h4 className="mb-2 mt-6 text-xs font-bold text-muted">
                Stages · {editStages.length}
              </h4>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <Reorder.Group
                  axis="y"
                  values={editStages}
                  onReorder={setEditStages}
                  className="border-t border-line"
                >
                  {editStages.map((stage, index) => (
                    <StageRow
                      key={stage.key}
                      stage={stage}
                      index={index}
                      isLast={index === editStages.length - 1}
                      onRename={(name) =>
                        setEditStages((current) =>
                          current.map((item) => (item.key === stage.key ? { ...item, name } : item)),
                        )
                      }
                      onRemove={() =>
                        setEditStages((current) => current.filter((item) => item.key !== stage.key))
                      }
                    />
                  ))}
                </Reorder.Group>

                <div className="flex items-center gap-3 px-2 py-2">
                  <span className="px-1 text-faint">+</span>
                  <input
                    value={newStageName}
                    onChange={(event) => setNewStageName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleAddStage();
                    }}
                    placeholder={t("Add a stage and press Enter")}
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-line focus:border-ink focus:bg-paper"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-3">
                <p className="text-xs text-faint">{t("The last stage stays hidden until you press “Mark as finished” on the commission.")}</p>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !editName.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {templateToDelete && (
        <ConfirmModal
          eyebrow={t("Delete template")}
          title={templateToDelete.name}
          message={t("Its stages are deleted too. You can undo it right after with Ctrl+Z.")}
          confirmLabel={t("Delete")}
          onConfirm={confirmDelete}
          onCancel={() => setTemplateToDelete(null)}
        />
      )}

      {errorMessage && (
        <ConfirmModal
          eyebrow={t("Action not allowed")}
          eyebrowTone="danger"
          title={t("Can't delete template")}
          message={errorMessage}
          confirmLabel={t("Understood")}
          confirmVariant="primary"
          onConfirm={() => setErrorMessage(null)}
        />
      )}
    </>
  );
}

export default TemplatesPage;
