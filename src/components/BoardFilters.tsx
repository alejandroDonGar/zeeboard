import { useState, type ReactNode } from "react";
import { IconFilter, IconSearch, IconX } from "@tabler/icons-react";
import type { Tag } from "../lib/database";
import { t } from "../lib/i18n";
import TagChip from "./TagChip";
import { TYPE_CATEGORY } from "../lib/catalog";

export type StatusFilter = "all" | "active" | "overdue";
export type PaymentFilter = "all" | "unpaid" | "partial" | "paid";

// Characters are filtered from Clients, not here
// Old type tags: the type is the template now, offered as its own group (see CommissionsPage)
const HIDDEN_CATEGORIES = ["Characters", TYPE_CATEGORY];

/** Grupo de botones para elegir una opción. Con `icon`, el botón muestra solo el icono (y `label` es su nombre accesible). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" className="inline-flex shrink-0 rounded-md border border-line bg-paper p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          aria-label={option.icon ? t(option.label) : undefined}
          title={option.icon ? t(option.label) : undefined}
          className={
            option.value === value
              ? "rounded-sm bg-highlight px-3 py-1.5 text-xs font-bold text-ink"
              : "rounded-sm px-3 py-1.5 text-xs font-semibold text-muted transition hover:text-ink"
          }
        >
          {option.icon ?? t(option.label)}
        </button>
      ))}
    </div>
  );
}

const PAYMENTS: { value: Exclude<PaymentFilter, "all">; label: string }[] = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partial" },
  { value: "paid", label: "Paid" },
];
const STATUSES: { value: Exclude<StatusFilter, "all">; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "overdue", label: "Overdue" },
];

/**
 * Para la barra superior: búsqueda y un solo botón «Filtro» con todo dentro (pago, estado, tipo y etiquetas).
 * Lo elegido sale al lado como chips que se quitan con ✕.
 */
function BoardFilters({
  tags,
  searchQuery,
  onSearchQueryChange,
  filterTagIds,
  onFilterTagIdsChange,
  filterStatus,
  onFilterStatusChange,
  filterPayment,
  onFilterPaymentChange,
}: {
  tags: Tag[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  filterTagIds: number[];
  onFilterTagIdsChange: (tagIds: number[]) => void;
  filterStatus: StatusFilter;
  onFilterStatusChange: (status: StatusFilter) => void;
  filterPayment: PaymentFilter;
  onFilterPaymentChange: (payment: PaymentFilter) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const menuTags = tags.filter((tag) => !HIDDEN_CATEGORIES.includes(tag.category || "General"));
  const menuCategories = Object.entries(
    menuTags.reduce<Record<string, Tag[]>>((groups, tag) => {
      const category = tag.category || "General";
      (groups[category] ??= []).push(tag);
      return groups;
    }, {}),
  );

  const selectedTags = tags.filter((tag) => filterTagIds.includes(tag.id));
  const activeCount = selectedTags.length + (filterPayment !== "all" ? 1 : 0) + (filterStatus !== "all" ? 1 : 0);
  const hasFilters = searchQuery.trim() !== "" || activeCount > 0;

  function toggleTag(tagId: number) {
    onFilterTagIdsChange(filterTagIds.includes(tagId) ? filterTagIds.filter((id) => id !== tagId) : [...filterTagIds, tagId]);
  }

  const option = "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink hover:bg-highlight";
  const tick = (on: boolean) => (
    <span
      aria-hidden="true"
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none ${
        on ? "border-ink bg-primary text-on-primary" : "border-line-strong"
      }`}
    >
      {on ? "✓" : ""}
    </span>
  );
  const group = (label: string) => <p className="px-2 pt-2 pb-1 text-xs font-semibold text-faint">{t(label)}</p>;
  const chip = (label: string, onRemove: () => void) => (
    <button key={label} type="button" onClick={onRemove} title={t("Remove filter")} className="chip transition hover:opacity-80">
      {label}
      <IconX size={12} stroke={2} aria-hidden="true" />
    </button>
  );

  return (
    <>
      <label className="flex max-w-[280px] min-w-36 flex-[1_1_160px] items-center gap-2 rounded-2xl border border-line bg-surface/60 px-2.5 py-1.5 text-faint focus-within:border-ink">
        <IconSearch size={16} stroke={1.75} aria-hidden="true" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={t("Search title or client…")}
          aria-label={t("Search title or client…")}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
      </label>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="true"
          aria-expanded={menuOpen}
          className={`inline-flex items-center gap-1.5 rounded-2xl border bg-surface px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition hover:bg-highlight ${
            activeCount > 0 ? "border-ink text-ink" : "border-line-strong text-ink"
          }`}
        >
          <IconFilter size={16} stroke={1.75} aria-hidden="true" />
          {t("Filter")}
          {activeCount > 0 && <span className="rounded-sm bg-primary px-1.5 text-xs font-bold text-on-primary">{activeCount}</span>}
        </button>

        {menuOpen && (
          <>
            {/* Invisible layer: a click outside closes the menu */}
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />

            <div role="menu" className="absolute top-full left-0 z-40 mt-1.5 max-h-[70vh] w-64 overflow-y-auto rounded-3xl border border-line-strong bg-surface p-1.5 shadow-lg">
              {group("Payment")}
              {PAYMENTS.map(({ value, label }) => (
                <button key={value} type="button" role="menuitemradio" aria-checked={filterPayment === value} onClick={() => onFilterPaymentChange(filterPayment === value ? "all" : value)} className={option}>
                  {tick(filterPayment === value)}
                  {t(label)}
                </button>
              ))}

              {group("Status")}
              {STATUSES.map(({ value, label }) => (
                <button key={value} type="button" role="menuitemradio" aria-checked={filterStatus === value} onClick={() => onFilterStatusChange(filterStatus === value ? "all" : value)} className={option}>
                  {tick(filterStatus === value)}
                  {t(label)}
                </button>
              ))}

              {menuCategories.map(([category, categoryTags]) => (
                <div key={category}>
                  {group(category)}
                  {categoryTags.map((tag) => (
                    <button key={tag.id} type="button" role="menuitemcheckbox" aria-checked={filterTagIds.includes(tag.id)} onClick={() => toggleTag(tag.id)} className={option}>
                      {tick(filterTagIds.includes(tag.id))}
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: tag.color }} />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {filterPayment !== "all" && chip(`${t("Payment")}: ${t(PAYMENTS.find((item) => item.value === filterPayment)?.label ?? "")}`, () => onFilterPaymentChange("all"))}
      {filterStatus !== "all" && chip(`${t("Status")}: ${t(STATUSES.find((item) => item.value === filterStatus)?.label ?? "")}`, () => onFilterStatusChange("all"))}
      {selectedTags.map((tag) => (
        <TagChip key={tag.id} name={tag.name} color={tag.color} suffix=" ×" onClick={() => toggleTag(tag.id)} title={t("Remove filter")} />
      ))}

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            onSearchQueryChange("");
            onFilterTagIdsChange([]);
            onFilterStatusChange("all");
            onFilterPaymentChange("all");
          }}
          className="px-1 text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {t("Clear filters")}
        </button>
      )}
    </>
  );
}

export default BoardFilters;
