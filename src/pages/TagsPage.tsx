import { t } from "../lib/i18n";
import { useEffect, useState } from "react";
import {
  createTag,
  deleteTag,
  getTags,
  getTagUsageCounts,
  updateTag,
  type Tag,
} from "../lib/database";
import TagChip from "../components/TagChip";
import PageHeader from "../components/PageHeader";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../context/ToastContext";
import { undoToast } from "../lib/undo";

// Colors that read well under white text and match the app
const PALETTE = [
  "#7c3aed",
  "#4f46e5",
  "#2563eb",
  "#0891b2",
  "#0d9488",
  "#16a34a",
  "#d97706",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#92400e",
  "#475569",
];

type Draft = { name: string; color: string };

/** Row in edit mode: name, palette and save/cancel. Enter saves, Esc cancels. */
function TagEditor({
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: Draft;
  saveLabel: string;
  onSave: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draft.name.trim() || saving) {
      return;
    }

    setSaving(true);

    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-md border border-line-strong bg-paper p-3"
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="flex items-center gap-3">
        <TagChip name={draft.name.trim() || "Preview"} color={draft.color} />

        <input
          autoFocus
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder={t("Tag name")}
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink disabled:opacity-60"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            onClick={() => setDraft({ ...draft, color })}
            className={`h-6 w-6 rounded-sm transition hover:scale-110 ${
              draft.color === color ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : ""
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
            value={draft.color}
            onChange={(event) => setDraft({ ...draft, color: event.target.value })}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink"
          >
            {t("Cancel")}
          </button>

          <button
            type="button"
            onClick={save}
            disabled={!draft.name.trim() || saving}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [ready, setReady] = useState(false);
  const [usageByTagId, setUsageByTagId] = useState<Record<number, number>>({});
  // Newly created categories that have no tags yet
  const [newCategories, setNewCategories] = useState<string[]>([]);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const { showToast } = useToast();

  async function loadTags() {
    const [data, usage] = await Promise.all([getTags(), getTagUsageCounts()]);
    setTags(data);
    setUsageByTagId(usage);
    setReady(true);
  }

  useEffect(() => {
    loadTags().catch(console.error);
  }, []);

  const tagsByCategory = tags.reduce<Record<string, Tag[]>>((groups, tag) => {
    (groups[tag.category || "General"] ??= []).push(tag);
    return groups;
  }, {});

  for (const category of newCategories) {
    tagsByCategory[category] ??= [];
  }

  const categories = Object.keys(tagsByCategory).sort((a, b) => a.localeCompare(b));

  function nextColor(categoryTags: Tag[]) {
    return PALETTE[categoryTags.length % PALETTE.length];
  }

  function handleCreateCategory() {
    const name = categoryName.trim();

    if (!name) {
      return;
    }

    const existing = categories.find((category) => category.toLowerCase() === name.toLowerCase());

    if (!existing) {
      setNewCategories((current) => [...current, name]);
    }

    setAddingToCategory(existing ?? name);
    setCreatingCategory(false);
    setCategoryName("");
  }

  async function handleCreateTag(category: string, draft: Draft) {
    try {
      await createTag(draft.name, draft.color, category);
      await loadTags();
      setNewCategories((current) => current.filter((name) => name !== category));
      setAddingToCategory(null);
    } catch (error) {
      console.error(error);
      showToast("Could not create tag.", "error");
    }
  }

  async function handleUpdateTag(tagId: number, draft: Draft) {
    try {
      await updateTag(tagId, draft.name, draft.color);
      await loadTags();
      setEditingTagId(null);
    } catch (error) {
      console.error(error);
      showToast("Could not save tag.", "error");
    }
  }

  async function handleDeleteTag(tagId: number) {
    try {
      const trashId = await deleteTag(tagId);
      await loadTags();
      undoToast(showToast, "Tag deleted.", trashId);
    } catch (error) {
      console.error(error);
      showToast("Could not delete tag.", "error");
    }
  }

  function usageLabel(tagId: number) {
    const count = usageByTagId[tagId] ?? 0;

    if (count === 0) {
      return t("Not used");
    }

    return t(count === 1 ? "{n} commission" : "{n} commissions", { n: count });
  }

  return (
    <>
      <PageHeader
        label={t("Label library")}
        title={t("Tags")}
        description={t("Classify commissions by type, payment or anything you need.")}
        action={t("+ New category")}
        onAction={() => setCreatingCategory(true)}
      />

      <section className="h-[calc(100vh-117px)] min-h-0 p-5 pb-6">
        <div className="h-full overflow-y-auto panel rounded-3xl p-6">
          {creatingCategory && (
            <div className="mb-6 flex items-center gap-2 rounded-md border border-line-strong bg-paper p-3">
              <input
                autoFocus
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleCreateCategory();
                  if (event.key === "Escape") setCreatingCategory(false);
                }}
                placeholder={t("Category name, e.g. Extras")}
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink"
              />

              <button
                type="button"
                onClick={() => setCreatingCategory(false)}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink"
              >
                {t("Cancel")}
              </button>

              <button
                type="button"
                onClick={handleCreateCategory}
                disabled={!categoryName.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
              >
                {t("Create")}
              </button>
            </div>
          )}

          {ready && categories.length === 0 && !creatingCategory && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-lg font-black">{t("Start your first category")}</p>
              <p className="mt-1 text-sm text-muted">
                {t("Group tags like commission types, extras or payment status.")}
              </p>
              <button
                type="button"
                onClick={() => setCreatingCategory(true)}
                className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary"
              >
                {t("New category")}
              </button>
            </div>
          )}

          <div className="space-y-8">
            {categories.map((category) => {
              const categoryTags = [...tagsByCategory[category]].sort((a, b) =>
                a.name.localeCompare(b.name),
              );
              return (
                <section key={category}>
                  <h3 className="mb-2 text-xs font-bold text-muted">
                    {category} · {categoryTags.length}
                  </h3>

                  <div className="divide-y divide-line border-y border-line">
                    {categoryTags.map((tag) =>
                      editingTagId === tag.id ? (
                        <div key={tag.id} className="py-2">
                          <TagEditor
                            initial={{ name: tag.name, color: tag.color }}
                            saveLabel="Save"
                            onSave={(draft) => handleUpdateTag(tag.id, draft)}
                            onCancel={() => setEditingTagId(null)}
                          />
                        </div>
                      ) : (
                        <div
                          key={tag.id}
                          className="group grid grid-cols-[16px_minmax(0,1fr)_auto_auto] items-center gap-4 px-2 py-2.5 transition hover:bg-paper"
                        >
                          <span className="h-4 w-4 rounded-sm" style={{ backgroundColor: tag.color }} />

                          <span className="truncate text-sm font-semibold">{tag.name}</span>

                          <span className="text-xs text-faint">{usageLabel(tag.id)}</span>

                          <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => {
                                setAddingToCategory(null);
                                setEditingTagId(tag.id);
                              }}
                              className="rounded-sm px-2 py-1 text-xs font-semibold text-muted hover:bg-highlight hover:text-ink"
                            >
                              {t("Edit")}
                            </button>

                            <button
                              type="button"
                              onClick={() => setTagToDelete(tag)}
                              className="rounded-sm px-2 py-1 text-xs font-semibold text-tone-bad hover:bg-tone-bad/10"
                            >
                              {t("Delete")}
                            </button>
                          </div>
                        </div>
                      ),
                    )}

                    {addingToCategory === category && (
                      <div className="py-2">
                        <TagEditor
                          initial={{ name: "", color: nextColor(categoryTags) }}
                          saveLabel="Add tag"
                          onSave={(draft) => handleCreateTag(category, draft)}
                          onCancel={() => setAddingToCategory(null)}
                        />
                      </div>
                    )}
                  </div>

                  {addingToCategory !== category && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTagId(null);
                        setAddingToCategory(category);
                      }}
                      className="mt-1 rounded-sm px-2 py-1.5 text-xs font-semibold text-muted transition hover:bg-paper hover:text-ink"
                    >
                      {t("+ Add tag")}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </section>

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
          onConfirm={async () => {
            await handleDeleteTag(tagToDelete.id);
            setTagToDelete(null);
          }}
          onCancel={() => setTagToDelete(null)}
        />
      )}
    </>
  );
}

export default TagsPage;
