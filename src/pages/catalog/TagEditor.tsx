import { useEffect, useState, type CSSProperties } from "react";
import { t } from "../../lib/i18n";
import type { Tag } from "../../lib/database";
import { PALETTE, TYPE_CATEGORY } from "../../lib/catalog";
import { tintStrengths } from "../../lib/ambient";
import TagChip from "../../components/TagChip";
import Swatches from "./Swatches";

export type TagDraft = { name: string; color: string; category: string };

/** Editor of a tag (an extra: rush, commercial use…) or, with `tag` null, the form for a new one. */
function TagEditor({
  tag,
  initial,
  categories,
  usage,
  onSave,
  onDelete,
  onCancel,
}: {
  tag: Tag | null;
  /** Starting values of a new tag */
  initial: TagDraft;
  categories: string[];
  usage: number;
  onSave: (draft: TagDraft) => Promise<void>;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TagDraft>(tag ? { name: tag.name, color: tag.color, category: tag.category || "General" } : initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(tag ? { name: tag.name, color: tag.color, category: tag.category || "General" } : initial);
  }, [tag?.id]);

  async function save() {
    if (!draft.name.trim() || saving) return;

    setSaving(true);

    try {
      await onSave({ ...draft, category: draft.category.trim() || "Extras" });
    } finally {
      setSaving(false);
    }
  }

  const strengths = tintStrengths(draft.color);
  const heroStyle = { "--tint": draft.color, "--ts-light": strengths.light, "--ts-dark": strengths.dark } as CSSProperties;
  const btn =
    "rounded-2xl border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition hover:bg-highlight active:scale-[0.97] disabled:opacity-50";
  const field = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-ink";

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") save();
        if (event.key === "Escape" && !tag) onCancel();
      }}
    >
      <div className="hero-tint shrink-0 px-6 pt-4 pb-4" style={heroStyle}>
        <span className="text-xs text-faint">{t("Tag")}</span>
        <input
          autoFocus={!tag}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder={t("Tag name")}
          aria-label={t("Tag name")}
          className="-ml-1 block w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-display text-3xl leading-tight font-semibold tracking-tight outline-none hover:border-line focus:border-line-strong focus:bg-paper"
        />

        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3 text-xs text-faint">
          <label className="grid gap-1">
            {t("Category")}
            {tag ? (
              <span className="py-1.5 text-sm font-semibold text-ink">{tag.category || "General"}</span>
            ) : (
              <>
                <input
                  list="catalog-categories"
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                  className={`${field} w-44`}
                />
                <datalist id="catalog-categories">
                  {categories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </>
            )}
          </label>
          <div className="grid gap-1">
            {t("Colour")}
            <Swatches colors={PALETTE} value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-5">
        <p className="mb-2 text-[13px] font-semibold">{t("Preview")}</p>
        <TagChip name={draft.name.trim() || t("Tag name")} color={draft.color} />

        <p className="mt-5 mb-1 text-[13px] font-semibold">{t("What tags are for")}</p>
        <p className="max-w-[60ch] text-muted">
          {tag?.category === TYPE_CATEGORY
            ? t("The type now comes from the commission's template, with its own colour, so these tags are no longer shown on commissions. They are kept so nothing is lost; delete them whenever you like.")
            : t("Tags mark extras (rush, commercial use, number of characters…). The commission type already gives its own colour.")}
        </p>

        {tag && (
          <p className="mt-5 text-muted">
            {usage === 0 ? t("Not used") : t(usage === 1 ? "{n} commission" : "{n} commissions", { n: usage })}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface/60 px-4 py-2.5">
        {tag ? (
          <button type="button" onClick={onDelete} className={`${btn} text-tone-bad`}>
            {t("Delete")}
          </button>
        ) : (
          <button type="button" onClick={onCancel} className={btn}>
            {t("Cancel")}
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!draft.name.trim() || saving}
          className="ml-auto rounded-2xl bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover active:scale-[0.97] disabled:opacity-50"
        >
          {saving ? t("Saving…") : tag ? t("Save changes") : t("Add tag")}
        </button>
      </div>
    </div>
  );
}

export default TagEditor;
