import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import {
  createTag,
  createTemplate,
  deleteTag,
  deleteTemplate,
  duplicateTemplate,
  getAllPayments,
  getCommissions,
  getTagUsageCounts,
  getTags,
  getTemplateStages,
  getTemplates,
  updateTag,
  updateTemplateColor,
  type Commission,
  type CommissionPayment,
  type Tag,
  type Template,
  type TemplateStage,
} from "../lib/database";
import {
  formatMoney,
  isCommissionCompleted,
  netIncome,
  paymentSummary,
  ratePerHour,
} from "../lib/commissionHelpers";
import { PALETTE, TYPE_CATEGORY } from "../lib/catalog";
import { useToast } from "../context/ToastContext";
import { undoToast } from "../lib/undo";
import ConfirmModal from "../components/ConfirmModal";
import GlassPanel from "../components/GlassPanel";
import TopBar from "../components/TopBar";
import TagEditor, { type TagDraft } from "./catalog/TagEditor";
import TypeEditor, { type TypeFigures } from "./catalog/TypeEditor";

type Selection = { kind: "type" | "tag"; id: number } | { kind: "new-tag"; category: string };

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Commission types (templates, with their colour) and tags (extras) in one screen: list on the left, editor on the right. */
function CatalogPage({ onOpenCommissionsPage }: { onOpenCommissionsPage: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [usageByTagId, setUsageByTagId] = useState<Record<number, number>>({});
  const [stagesByTemplateId, setStagesByTemplateId] = useState<Record<number, TemplateStage[]>>({});
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { showToast } = useToast();

  /** Reloads everything; `select` picks what to show afterwards (default: keep, or the first type). */
  async function load(select?: Selection | null) {
    const [templateData, tagData, usage, commissionData, paymentData] = await Promise.all([
      getTemplates(),
      getTags(),
      getTagUsageCounts(),
      getCommissions(),
      getAllPayments(),
    ]);
    const sorted = [...templateData].sort((a, b) => a.name.localeCompare(b.name));
    const stageEntries = await Promise.all(sorted.map(async (template) => [template.id, await getTemplateStages(template.id)] as const));

    setTemplates(sorted);
    setTags(tagData);
    setUsageByTagId(usage);
    setStagesByTemplateId(Object.fromEntries(stageEntries));
    setCommissions(commissionData);
    setPayments(paymentData);
    setSelection((current) => {
      const wanted = select === undefined ? current : select;
      const exists =
        wanted?.kind === "new-tag" ||
        (wanted?.kind === "type" && sorted.some((template) => template.id === wanted.id)) ||
        (wanted?.kind === "tag" && tagData.some((tag) => tag.id === wanted.id));

      return exists ? wanted : sorted[0] ? { kind: "type", id: sorted[0].id } : null;
    });
    setReady(true);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const completed = (commission: Commission) => isCommissionCompleted(commission, stagesByTemplateId);
  const selectedTemplate = selection?.kind === "type" ? templates.find((template) => template.id === selection.id) ?? null : null;
  const selectedTag = selection?.kind === "tag" ? tags.find((tag) => tag.id === selection.id) ?? null : null;

  // What the selected type brings: what's in progress and the figures of what's been delivered
  const own = selectedTemplate ? commissions.filter((commission) => commission.template_id === selectedTemplate.id) : [];
  const inProgress = own.filter((commission) => !completed(commission));
  const delivered = own.filter(completed);
  const withPrice = delivered.filter((commission) => commission.price !== null);
  const withHours = delivered.filter((commission) => commission.hours !== null && commission.hours > 0);
  const figures: TypeFigures = {
    n: delivered.length,
    avgPrice: withPrice.length ? withPrice.reduce((sum, commission) => sum + (commission.price ?? 0), 0) / withPrice.length : null,
    avgHours: withHours.length ? round1(withHours.reduce((sum, commission) => sum + (commission.hours ?? 0), 0) / withHours.length) : null,
    rate: ratePerHour(
      delivered.map((commission) => ({
        net: netIncome(paymentSummary(commission.price, payments.filter((payment) => payment.commission_id === commission.id))),
        hours: commission.hours,
      })),
    ),
  };

  const newestTemplateId = async () => Math.max(...(await getTemplates()).map((template) => template.id));

  async function handleNewTemplate() {
    try {
      await createTemplate("Untitled template", []);
      await load({ kind: "type", id: await newestTemplateId() });
    } catch (error) {
      console.error(error);
      showToast(`Template error: ${error}`, "error");
    }
  }

  async function handleDuplicate(templateId: number) {
    try {
      await duplicateTemplate(templateId);
      await load({ kind: "type", id: await newestTemplateId() });
    } catch (error) {
      console.error(error);
      showToast(`Duplicate error: ${error}`, "error");
    }
  }

  async function confirmDeleteTemplate() {
    if (!templateToDelete) return;

    try {
      const trashId = await deleteTemplate(templateToDelete.id);
      setTemplateToDelete(null);
      await load(null);
      undoToast(showToast, "Template deleted.", trashId);
    } catch (error) {
      console.error(error);
      setTemplateToDelete(null);
      setErrorMessage(error instanceof Error ? error.message : "Could not delete template.");
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

  async function handleSaveTag(draft: TagDraft) {
    try {
      if (selectedTag) {
        await updateTag(selectedTag.id, draft.name, draft.color);
        await load();
      } else {
        await createTag(draft.name, draft.color, draft.category);
        // The new one has the highest id
        const data = await getTags();
        await load({ kind: "tag", id: Math.max(...data.map((tag) => tag.id)) });
      }
    } catch (error) {
      console.error(error);
      showToast(selectedTag ? "Could not save tag." : "Could not create tag.", "error");
    }
  }

  async function confirmDeleteTag() {
    if (!tagToDelete) return;

    try {
      const trashId = await deleteTag(tagToDelete.id);
      setTagToDelete(null);
      await load(null);
      undoToast(showToast, "Tag deleted.", trashId);
    } catch (error) {
      console.error(error);
      setTagToDelete(null);
      showToast("Could not delete tag.", "error");
    }
  }

  function usageLabel(tagId: number) {
    const count = usageByTagId[tagId] ?? 0;

    return count === 0 ? t("Not used") : t(count === 1 ? "{n} commission" : "{n} commissions", { n: count });
  }

  function openCommission(commission: Commission) {
    localStorage.setItem("zeeboard-active-commission-id", String(commission.id));
    onOpenCommissionsPage();
  }

  const tagCategories = Object.entries(
    [...tags].sort((a, b) => a.name.localeCompare(b.name)).reduce<Record<string, Tag[]>>((groups, tag) => {
      (groups[tag.category || "General"] ??= []).push(tag);
      return groups;
    }, {}),
  ).sort(([a], [b]) => a.localeCompare(b));
  const categoryNames = tagCategories.map(([category]) => category);

  const group = (label: string, count: number) => (
    <p className="flex items-baseline gap-2 px-2 pt-3 pb-1 text-xs font-semibold text-muted">
      {label}
      <span className="font-medium text-faint tabular-nums">{count}</span>
    </p>
  );
  const row = (active: boolean, onClick: () => void, color: string, round: boolean, name: string, sub: string, right: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
        active ? "bg-highlight" : "hover:bg-highlight/60"
      }`}
    >
      <i className={`h-3 w-3 ${round ? "rounded-full" : "rounded-sm"}`} style={{ backgroundColor: color }} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-faint">{sub}</span>
      </span>
      <span className="text-xs text-faint tabular-nums">{right}</span>
    </button>
  );

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
        <TopBar title="Catalog" action="New type" onAction={handleNewTemplate}
          end={
            <button
              type="button"
              onClick={() => setSelection({ kind: "new-tag", category: selectedTag?.category || categoryNames.find((name) => name !== TYPE_CATEGORY) || "Extras" })}
              className="rounded-2xl border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition hover:bg-highlight active:scale-[0.97]"
            >
              + {t("New tag")}
            </button>
          }
        />

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(230px,310px)_minmax(0,1fr)] gap-3">
          <GlassPanel as="nav" className="min-h-0" contentClassName="overflow-y-auto p-2">
            {!ready ? null : (
              <>
                {group(t("Commission types"), templates.length)}
                {templates.length === 0 && <p className="px-2 py-1 text-xs text-faint">{t("No templates yet. Create one on the right.")}</p>}
                {templates.map((template) => {
                  const active = commissions.filter((commission) => commission.template_id === template.id && !completed(commission)).length;
                  const stages = stagesByTemplateId[template.id]?.length ?? 0;

                  return row(
                    selection?.kind === "type" && selection.id === template.id,
                    () => setSelection({ kind: "type", id: template.id }),
                    template.color,
                    false,
                    template.name || t("Untitled"),
                    [t(stages === 1 ? "{n} stage" : "{n} stages", { n: stages }), template.base_price != null ? formatMoney(template.base_price) : t("no price")].join(" · "),
                    active > 0 ? t("{n} in progress", { n: active }) : "",
                  );
                })}

                {tagCategories.map(([category, categoryTags]) => (
                  <div key={category}>
                    {group(category, categoryTags.length)}
                    {categoryTags.map((tag) =>
                      row(
                        selection?.kind === "tag" && selection.id === tag.id,
                        () => setSelection({ kind: "tag", id: tag.id }),
                        tag.color,
                        true,
                        tag.name,
                        t("Tag"),
                        usageLabel(tag.id),
                      ),
                    )}
                  </div>
                ))}
              </>
            )}
          </GlassPanel>

          <div className="glass relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl @container">
            {!ready ? null : selectedTemplate ? (
              <TypeEditor
                template={selectedTemplate}
                inProgress={inProgress}
                figures={figures}
                onSaved={() => load()}
                onColor={handleColor}
                onDuplicate={() => handleDuplicate(selectedTemplate.id)}
                onDelete={() => setTemplateToDelete(selectedTemplate)}
                onOpenCommission={openCommission}
              />
            ) : selection?.kind === "tag" && selectedTag ? (
              <TagEditor
                tag={selectedTag}
                initial={{ name: "", color: PALETTE[0], category: "Extras" }}
                categories={categoryNames}
                usage={usageByTagId[selectedTag.id] ?? 0}
                onSave={handleSaveTag}
                onDelete={() => setTagToDelete(selectedTag)}
                onCancel={() => undefined}
              />
            ) : selection?.kind === "new-tag" ? (
              <TagEditor
                key={selection.category}
                tag={null}
                initial={{ name: "", color: PALETTE[tags.length % PALETTE.length], category: selection.category }}
                categories={categoryNames}
                usage={0}
                onSave={handleSaveTag}
                onDelete={() => undefined}
                onCancel={() => load(null)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <p className="font-display text-xl font-semibold">{t("Create your first template")}</p>
                <p className="mt-1 text-sm text-muted">{t("A template is the list of stages a commission moves through.")}</p>
                <button type="button" onClick={handleNewTemplate} className="mt-4 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary">
                  {t("New template")}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {templateToDelete && (
        <ConfirmModal
          eyebrow={t("Delete template")}
          title={templateToDelete.name}
          message={t("Its stages are deleted too. You can undo it right after with Ctrl+Z.")}
          confirmLabel={t("Delete")}
          onConfirm={confirmDeleteTemplate}
          onCancel={() => setTemplateToDelete(null)}
        />
      )}

      {tagToDelete && (
        <ConfirmModal
          eyebrow={t("Delete tag")}
          title={tagToDelete.name}
          message={
            usageByTagId[tagToDelete.id]
              ? t("It will be removed from {usage}. You can undo it right after with Ctrl+Z.", { usage: usageLabel(tagToDelete.id).toLowerCase() })
              : t("You can undo it right after with Ctrl+Z.")
          }
          confirmLabel={t("Delete")}
          onConfirm={confirmDeleteTag}
          onCancel={() => setTagToDelete(null)}
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

export default CatalogPage;
