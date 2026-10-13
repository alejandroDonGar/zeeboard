import { useState } from "react";
import { t } from "../../lib/i18n";
import { hide, isPrivate } from "../../lib/privacy";
import { autoTagIds } from "../../lib/formImport";
import { TYPE_CATEGORY } from "../../lib/catalog";
import { calculateCommissionPrice, effectiveCharacterCount, formatMoney, parsePrice } from "../../lib/commissionHelpers";
import {
  appSettings,
  createCommission,
  replaceCommissionCharacters,
  replaceCommissionTags,
  updateCommission,
  type Client,
  type ClientCharacter,
  type Commission,
  type Tag,
  type Template,
} from "../../lib/database";
import TagChip from "../../components/TagChip";
import DialogBehavior from "../../components/DialogBehavior";
import { useToast } from "../../context/ToastContext";

/** A single form to create and edit a commission. It holds its own fields; the page reloads after `onSaved`. */
function CommissionForm({
  mode,
  commission,
  initialTagIds,
  linkedCharacterIds,
  templates,
  clients,
  charactersByClientId,
  allTags,
  onClose,
  onSaved,
}: {
  mode: "new" | "edit";
  /** The commission being edited (null when creating) */
  commission: Commission | null;
  initialTagIds: number[];
  linkedCharacterIds: number[];
  templates: Template[];
  clients: Client[];
  charactersByClientId: Record<number, ClientCharacter[]>;
  allTags: Tag[];
  onClose: () => void;
  onSaved: (commissionId: number) => Promise<void>;
}) {
  const editing = mode === "edit" ? commission : null;
  const [characterSearch, setCharacterSearch] = useState("");
  const [commissionTitle, setCommissionTitle] = useState(editing?.title ?? "");
  const [commissionPrice, setCommissionPrice] = useState(editing?.price != null ? String(editing.price).replace(".", ",") : "");
  const [commissionDeadline, setCommissionDeadline] = useState(editing?.deadline || "");
  const [commissionNotes, setCommissionNotes] = useState(editing?.notes || "");
  const [clientName, setClientName] = useState(editing?.client_name || "");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(editing?.client_id ?? null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>(editing ? linkedCharacterIds : []);
  // What the price is for. Follows the linked characters until set by hand or loaded from a saved commission.
  const [characterCount, setCharacterCount] = useState(
    editing ? effectiveCharacterCount(editing.character_count ?? 1, linkedCharacterIds.length) : 1,
  );
  const [countIsFixed, setCountIsFixed] = useState(editing !== null);
  const [platform, setPlatform] = useState(editing?.platform || "Discord");
  const [currency, setCurrency] = useState(editing ? editing.currency || "EUR" : appSettings().default_currency);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(editing?.template_id ?? null);
  const [savingCommission, setSavingCommission] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(initialTagIds);
  const { showToast } = useToast();

  /** Automatic price: called by template and character changes, never when opening a form */
  function applyAutoPrice(templateId: number | null, characterCount: number) {
    const basePrice = templates.find((template) => template.id === templateId)?.base_price;

    if (basePrice != null) {
      setCommissionPrice(
        String(calculateCommissionPrice(basePrice, characterCount, appSettings().extra_character_rate)).replace(".", ","),
      );
    }
  }

  /** On create: sets the character tag automatically and drops old type tags (the template is the type now; others are kept) */
  function applyAutoTags(characterCount: number) {
    if (mode !== "new") {
      return;
    }

    const auto = autoTagIds(characterCount, allTags);
    const own = (id: number) => [TYPE_CATEGORY, "Characters"].includes(allTags.find((tag) => tag.id === id)?.category ?? "");

    setSelectedTagIds((current) => [...current.filter((id) => !own(id)), ...auto]);
  }

  /** Linking or unlinking characters: the count only goes up once it is fixed, else it follows them */
  function changeLinkedCharacters(nextIds: number[]) {
    const count = effectiveCharacterCount(countIsFixed ? characterCount : 0, nextIds.length);

    setSelectedCharacterIds(nextIds);
    setCharacterCount(count);
    applyAutoPrice(selectedTemplateId, count);
    applyAutoTags(count);
  }

  function changeCharacterCount(value: number) {
    const count = effectiveCharacterCount(value, selectedCharacterIds.length);

    setCharacterCount(count);
    setCountIsFixed(true);
    applyAutoPrice(selectedTemplateId, count);
    applyAutoTags(count);
  }

  const formTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const extraCharacters = characterCount - 1;
  // Chips: the chosen client's characters, plus those of other clients already chosen
  const formCharacterOptions = Object.values(charactersByClientId)
    .flat()
    .filter((character) => character.client_id === selectedClientId || selectedCharacterIds.includes(character.id));
  const allCharacterOptions = Object.values(charactersByClientId)
    .flat()
    .map((character) => ({
      id: character.id,
      label: `${character.name} (${hide(clients.find((client) => client.id === character.client_id)?.name ?? "?")})`,
    }));
  const formLabel = "mb-1.5 block text-xs font-bold text-muted";
  const formField =
    "rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-ink";

  /** Saves the form: creates or updates, and in both cases saves tags and characters */
  async function handleSaveCommissionForm() {
    try {
      setSavingCommission(true);

      const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
      const fields = [
        commissionTitle,
        selectedClientId,
        selectedClient?.name || clientName,
        selectedClient?.platform || platform,
      ] as const;
      const price = parsePrice(commissionPrice);
      const deadline = commissionDeadline || null;

      let commissionId: number;

      if (mode === "edit" && commission) {
        commissionId = commission.id;
        await updateCommission(commissionId, ...fields, price, currency, deadline, commissionNotes, characterCount);
      } else {
        commissionId = await createCommission(
          ...fields,
          selectedTemplateId,
          price,
          currency,
          deadline,
          commissionNotes,
          characterCount,
        );
      }

      await replaceCommissionTags(commissionId, selectedTagIds);
      await replaceCommissionCharacters(commissionId, selectedCharacterIds);

      showToast(mode === "edit" ? "Commission saved." : "Commission created.", "success");
      await onSaved(commissionId);
    } catch (error) {
      console.error(error);
      showToast(error instanceof Error ? error.message : t("Commission error: {error}", { error: String(error) }), "error");
    } finally {
      setSavingCommission(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={mode === "new" ? t("New commission") : t("Edit commission")} className="grid max-h-[90vh] w-[900px] max-w-[94vw] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] overflow-hidden modal-card rounded-3xl">
        <DialogBehavior onClose={() => onClose()} />
        {/* Left: pick */}
        <div className="min-h-0 space-y-5 overflow-y-auto p-6">
          <input
            autoFocus
            value={commissionTitle}
            onChange={(event) => setCommissionTitle(event.target.value)}
            placeholder={t("Commission title")}
            className="w-full rounded-md border border-transparent bg-transparent px-1 font-display text-2xl font-semibold tracking-tight outline-none hover:border-line focus:border-ink"
          />

          <div>
            <p className={formLabel}>{t("Client")}</p>
            <div className="flex gap-2">
              <input
                list={isPrivate() ? undefined : "client-options"}
                data-private
                value={clientName}
                onChange={(event) => {
                  const name = event.target.value;
                  const match = clients.find((client) => client.name === name);
                  setClientName(name);
                  setSelectedClientId(match?.id ?? null);
                  if (match?.platform) setPlatform(match.platform);
                }}
                placeholder={t("Search or type a name")}
                className={`${formField} flex-1`}
              />
              <datalist id="client-options">
                {clients.map((client) => (
                  <option key={client.id} value={client.name}>
                    {client.handle ?? client.platform ?? ""}
                  </option>
                ))}
              </datalist>

              {/* The platform comes from the client; pick it by hand only for someone not saved */}
              {!selectedClientId && (
                <select value={platform} onChange={(event) => setPlatform(event.target.value)} className={formField}>
                  <option>Discord</option>
                  <option>Twitter / X</option>
                  <option>Bluesky</option>
                  <option>Telegram</option>
                  <option>Email</option>
                  <option>Other</option>
                </select>
              )}
            </div>
          </div>

          <div>
            <p className={formLabel}>
              {t("Characters")}
              <input
                type="number"
                min={1}
                value={characterCount}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (value >= 1) changeCharacterCount(value);
                }}
                title={t("How many characters the commission has; the price depends on it")}
                className="ml-3 w-14 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-center text-sm normal-case tracking-normal text-ink outline-none focus:border-ink"
              />
              <span className="ml-2 normal-case tracking-normal text-faint">
                {t("the price depends on this number")}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {formCharacterOptions.map((character) => {
                const selected = selectedCharacterIds.includes(character.id);

                return (
                  <button
                    key={character.id}
                    type="button"
                    onClick={() => {
                      changeLinkedCharacters(
                        selected
                          ? selectedCharacterIds.filter((id) => id !== character.id)
                          : [...selectedCharacterIds, character.id],
                      );
                    }}
                    className={
                      selected
                        ? "rounded-sm bg-primary px-2.5 py-1 text-sm font-bold text-on-primary"
                        : "rounded-sm border border-line-strong px-2.5 py-1 text-sm text-muted hover:border-ink hover:text-ink"
                    }
                  >
                    {character.name}
                    {character.client_id !== selectedClientId && (
                      <span className="ml-1 text-xs opacity-70">
                        · {hide(clients.find((client) => client.id === character.client_id)?.name ?? "")}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Characters from any client: collaborations, friends' characters… */}
              <input
                list={isPrivate() ? undefined : "character-options"}
                value={characterSearch}
                onChange={(event) => {
                  const option = allCharacterOptions.find((item) => item.label === event.target.value);

                  if (option) {
                    changeLinkedCharacters(
                      selectedCharacterIds.includes(option.id) ? selectedCharacterIds : [...selectedCharacterIds, option.id],
                    );
                    setCharacterSearch("");
                  } else {
                    setCharacterSearch(event.target.value);
                  }
                }}
                placeholder={t("+ from another client")}
                className="w-52 rounded-sm border border-dashed border-line-strong bg-transparent px-2 py-1 text-sm outline-none focus:border-ink"
              />
              <datalist id="character-options">
                {allCharacterOptions.map((option) => (
                  <option key={option.id} value={option.label} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <p className={formLabel}>
              Type
              {mode === "edit" && (
                <span className="ml-2 normal-case tracking-normal text-faint">
                  {t("· can't change after creating (stages and images depend on it)")}
                </span>
              )}
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
              {templates.map((template) => {
                const selected = template.id === selectedTemplateId;

                return (
                  <button
                    key={template.id}
                    type="button"
                    disabled={mode === "edit"}
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      applyAutoPrice(template.id, characterCount);
                      applyAutoTags(characterCount);
                    }}
                    className={`rounded-md border px-3 py-2 text-left transition disabled:cursor-default ${
                      selected
                        ? "border-ink bg-paper ring-1 ring-ink"
                        : "border-line hover:border-line-strong disabled:opacity-40"
                    }`}
                  >
                    <span className="block truncate text-sm font-bold">{template.name}</span>
                    <span className="text-xs text-faint">
                      {template.base_price != null ? formatMoney(template.base_price) : t("No base price")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={formLabel}>{t("Tags")}</p>
            <div className="flex flex-wrap gap-1.5">
              {allTags.filter((tag) => tag.category !== TYPE_CATEGORY).map((tag) => {
                const selected = selectedTagIds.includes(tag.id);

                return (
                  <TagChip
                    key={tag.id}
                    name={tag.name}
                    color={tag.color}
                    selected={selected}
                    onClick={() =>
                      setSelectedTagIds((current) => {
                        if (selected) {
                          return current.filter((id) => id !== tag.id);
                        }

                        // Only one "Characters" tag at a time
                        const sameCategory =
                          tag.category === "Characters"
                            ? allTags.filter((other) => other.category === tag.category).map((other) => other.id)
                            : [];

                        return [...current.filter((id) => !sameCategory.includes(id)), tag.id];
                      })
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: live summary, price, delivery and notes */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-line bg-paper p-6">
          <div>
            <p className={formLabel}>{t("Summary")}</p>
            <p className="truncate font-display text-lg font-semibold">{commissionTitle.trim() || "Untitled commission"}</p>
            <p className="text-sm text-muted">
              {[clientName.trim() || t("No client"), platform, formTemplate?.name].filter(Boolean).join(" · ")}
            </p>
          </div>

          <div className="space-y-1 border-y border-line py-3 text-sm">
            {formTemplate?.base_price != null && (
              <>
                <p className="flex justify-between">
                  <span>{formTemplate.name}</span>
                  <span>{formatMoney(formTemplate.base_price, currency)}</span>
                </p>
                {extraCharacters > 0 && (
                  <p className="flex justify-between text-muted">
                    <span>
                      + {extraCharacters} extra character{extraCharacters === 1 ? "" : "s"} ({Math.round(appSettings().extra_character_rate * 100)}% each)
                    </span>
                    <span>
                      {formatMoney(
                        calculateCommissionPrice(
                          formTemplate.base_price,
                          characterCount,
                          appSettings().extra_character_rate,
                        ) -
                          formTemplate.base_price,
                        currency,
                      )}
                    </span>
                  </p>
                )}
              </>
            )}

            <div className="flex items-center justify-between gap-2 pt-1 font-semibold">
              <span>{t("Price")}</span>
              <span className="flex items-center gap-1">
                <input
                  value={commissionPrice}
                  onChange={(event) => setCommissionPrice(event.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  data-private
                  title={t("Calculated from the type and characters; you can change it")}
                  className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1 text-right font-semibold outline-none focus:border-ink"
                />
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="rounded-md border border-line-strong bg-surface px-1 py-1 text-sm font-semibold"
                >
                  <option>EUR</option>
                  <option>USD</option>
                  <option>GBP</option>
                </select>
              </span>
            </div>
          </div>

          <label className="block">
            <span className={formLabel}>{t("Deadline · optional")}</span>
            <input
              type="date"
              value={commissionDeadline}
              onChange={(event) => setCommissionDeadline(event.target.value)}
              className={`${formField} w-full`}
            />
          </label>

          <label className="flex min-h-24 flex-1 flex-col">
            <span className={formLabel}>{t("Notes")}</span>
            <textarea
              value={commissionNotes}
              onChange={(event) => setCommissionNotes(event.target.value)}
              placeholder={t("Background, pose, details to remember…")}
              className={`${formField} w-full flex-1 resize-none`}
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose()}
              className="rounded-md px-4 py-2 text-sm font-semibold text-muted hover:text-ink"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={handleSaveCommissionForm}
              disabled={savingCommission || !commissionTitle.trim()}
              className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
            >
              {savingCommission ? t("Saving…") : mode === "new" ? t("Create commission") : t("Save changes")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CommissionForm;
