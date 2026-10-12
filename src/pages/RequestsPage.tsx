import { useEffect, useState } from "react";
import { locale, t } from "../lib/i18n";
import DialogBehavior from "../components/DialogBehavior";
import {
  addRequest,
  appSettings,
  createClient,
  createCommission,
  deleteRequest,
  getClients,
  getTags,
  replaceCommissionTags,
  getRequests,
  getTemplates,
  importRequests,
  setClientEmail,
  updateClientAvatar,
  setClientTag,
  setRequestStatus,
  setRequestTemplate,
  updateSettings,
  type CommissionRequest,
  type Template,
} from "../lib/database";
import { calculateCommissionPrice, formatMoney, loadOpenCommissions } from "../lib/commissionHelpers";
import { autoTagIds, normalizeHandle, parseResponses } from "../lib/formImport";
import { REQUESTS_CHANGED, syncFormResponses } from "../lib/formSync";
import { fetchAvatar } from "../lib/avatars";
import { hide } from "../lib/privacy";
import { open } from "@tauri-apps/plugin-dialog";
import { Segmented } from "../components/BoardFilters";
import ConfirmModal from "../components/ConfirmModal";
import Linkified from "../components/Linkified";
import PageHeader from "../components/PageHeader";
import { useToast } from "../context/ToastContext";
import { undoToast } from "../lib/undo";

const PLATFORMS = ["Twitter / X", "Bluesky", "Discord", "Telegram", "Email", "Other"];

type Draft = { name: string; platform: string; contact: string; template_id: number | null; characters: number; details: string };
const emptyDraft: Draft = { name: "", platform: "Twitter / X", contact: "", template_id: null, characters: 1, details: "" };

const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

function RequestsPage({ onOpenCommissionsPage }: { onOpenCommissionsPage: () => void }) {
  const [requests, setRequests] = useState<CommissionRequest[]>([]);
  const [ready, setReady] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [taken, setTaken] = useState(0);
  const [settings, setSettings] = useState(appSettings());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState<CommissionRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function load() {
    const [requestList, templateList, open] = await Promise.all([getRequests(), getTemplates(), loadOpenCommissions()]);
    setRequests(requestList);
    setTemplates(templateList);
    setTaken(open.length);
    setReady(true);
    window.dispatchEvent(new Event(REQUESTS_CHANGED));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function saveSlots(changes: Parameters<typeof updateSettings>[0]) {
    await updateSettings(changes);
    setSettings({ ...appSettings() });
  }

  async function chooseResponsesFile() {
    const file = await open({ title: t("Choose the responses CSV"), filters: [{ name: "CSV", extensions: ["csv"] }] });

    if (typeof file === "string") {
      await saveSlots({ responses_file: file });
      await checkNow();
    }
  }

  async function checkNow() {
    try {
      setBusy(true);
      const result = await syncFormResponses();
      setSettings({ ...appSettings() });
      await load();

      if (result) {
        showToast(
          result.added > 0
            ? t(result.added === 1 ? "{n} new request from the form." : "{n} new requests from the form.", { n: result.added })
            : t("Nothing new in the form."),
          "success",
        );
      }
    } catch (error) {
      console.error(error);
      showToast(t("Could not read the responses file: {error}", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>, errorPrefix: string) {
    try {
      setBusy(true);
      await action();
      await load();
    } catch (error) {
      console.error(error);
      showToast(`${t(errorPrefix)}: ${error instanceof Error ? error.message : error}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function startAccept(request: CommissionRequest) {
    // With slots full, confirmation is asked: over-accepting is a decision, not an oversight
    if (settings.slots_total > 0 && taken >= settings.slots_total) {
      setConfirmAccept(request);
    } else {
      accept(request);
    }
  }

  /** Creates the client (or reuses the one with that name) and the commission, and opens it. */
  async function accept(request: CommissionRequest) {
    setConfirmAccept(null);

    try {
      setBusy(true);

      const clients = await getClients();
      const handle = normalizeHandle(request.contact);
      // An existing client: by handle (most reliable) or else by name
      const existing =
        clients.find((client) => handle !== "" && normalizeHandle(client.handle) === handle) ??
        clients.find((client) => client.name.trim().toLowerCase() === request.name.trim().toLowerCase());
      const platform = existing?.platform || request.platform || "Other";
      const clientId = existing?.id ?? (await createClient(request.name, platform, request.contact ?? "", ""));

      if (request.email) {
        await setClientEmail(clientId, request.email);
      }

      // No photo yet: fetched in the background (Bluesky or Telegram) and doesn't delay the commission
      if (!existing?.avatar_url) {
        fetchAvatar([
          { platform: request.tag_platform, handle: request.tag_handle },
          { platform, handle: request.contact },
        ])
          .then(async (path) => {
            if (path) {
              await updateClientAvatar(clientId, path);
            }
          })
          .catch(console.error);
      }

      // The client's latest word wins: replaces the previous tag account
      if (request.tag_handle) {
        await setClientTag(clientId, request.tag_platform, request.tag_handle);
      }

      const template = templates.find((item) => item.id === request.template_id);
      const price =
        template?.base_price != null
          ? calculateCommissionPrice(template.base_price, request.characters, settings.extra_character_rate)
          : null;

      // The title is the type, without the client's name, so it doesn't leak on a stream in private mode
      const commissionId = await createCommission(
        template?.name ?? "New commission",
        clientId,
        request.name,
        platform,
        request.template_id,
        price,
        settings.default_currency,
        null,
        request.details ?? "",
        request.characters,
      );

      // Character-count tag, without touching it by hand (the template is the type)
      await replaceCommissionTags(commissionId, autoTagIds(request.characters, await getTags()));

      await setRequestStatus(request.id, "accepted", commissionId);
      localStorage.setItem("zeeboard-active-commission-id", String(commissionId));
      showToast("Commission created. Edit it to rename it and link the characters.", "success");
      onOpenCommissionsPage();
    } catch (error) {
      console.error(error);
      showToast(t("Could not accept: {error}", { error: error instanceof Error ? error.message : String(error) }), "error");
      setBusy(false);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      setBusy(true);
      const { requests: parsed, error } = parseResponses(await file.text(), templates);

      if (error) {
        showToast(error, "error");
        return;
      }

      const { added, skipped } = await importRequests(parsed);
      await load();
      showToast(
        added === 0
          ? t("No new responses: everything in that file was already imported.")
          : t(added === 1 ? "Imported {n} new request." : "Imported {n} new requests.", { n: added }) +
            (skipped > 0 ? ` ${t("({n} already there)", { n: skipped })}` : ""),
        "success",
      );
    } catch (error) {
      console.error(error);
      showToast(t("Could not import: {error}", { error: error instanceof Error ? error.message : String(error) }), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (!draft) {
      return;
    }

    if (!draft.name.trim() || draft.template_id === null) {
      showToast("A request needs a name and a type.", "error");
      return;
    }

    await run(async () => {
      await addRequest({ ...draft, contact: draft.contact, platform: draft.platform });
      setDraft(null);
    }, "Could not add the request");
  }

  const waiting = requests.filter((request) => request.status === "new");
  const waitlist = requests.filter((request) => request.status === "waitlist");
  const archive = requests.filter((request) => request.status === "accepted" || request.status === "declined").reverse();
  const free = settings.slots_total - taken;

  const panel = "panel divide-y divide-line rounded-3xl";
  const heading = "mb-2 text-xs font-bold text-muted";
  const ghost =
    "rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-ink disabled:opacity-50";
  const field = "w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm outline-none focus:border-ink";

  function renderRequest(request: CommissionRequest) {
    const template = templates.find((item) => item.id === request.template_id);
    const estimate =
      template?.base_price != null
        ? formatMoney(calculateCommissionPrice(template.base_price, request.characters, settings.extra_character_rate), settings.default_currency)
        : null;
    const archived = request.status === "accepted" || request.status === "declined";

    return (
      <div key={request.id} className="flex items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-bold">{hide(request.name)}</span>
            <span className="text-sm text-muted">
              {[request.platform, request.contact && hide(request.contact)].filter(Boolean).join(" · ")}
            </span>
            <span className="text-xs text-faint">{dateFormatter.format(new Date(request.created_at))}</span>
          </p>

          <p className="mt-0.5 text-sm">
            {template ? (
              template.name
            ) : (
              <select
                value=""
                onChange={(event) =>
                  run(() => setRequestTemplate(request.id, Number(event.target.value)), "Could not set the type")
                }
                className="rounded-md border border-tone-warn bg-tone-warn/15 px-2 py-0.5 text-sm font-semibold text-ink"
              >
                <option value="">{t("Choose the type…")}</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}{" "}
            · {t(request.characters === 1 ? "{n} character" : "{n} characters", { n: request.characters })}
            {estimate && <span className="text-muted"> · ≈ {estimate}</span>}
            {request.email && <span className="text-muted"> · {hide(request.email)}</span>}
          </p>

          {request.tag_handle && (
            <p className="mt-0.5 text-xs text-muted">
              {t("Tag when posting:")} {request.tag_platform && request.tag_platform !== "Other" ? `${request.tag_platform} ` : ""}
              {hide(request.tag_handle)}
            </p>
          )}

          {request.details && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
              <Linkified text={request.details} />
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {request.status === "accepted" && (
            <span className="chip chip-ok">{t("Accepted")}</span>
          )}
          {request.status === "declined" && (
            <span className="rounded-sm bg-highlight px-2 py-0.5 text-xs font-bold text-muted">{t("Declined")}</span>
          )}

          {(request.status === "new" || request.status === "waitlist") && (
            <>
              <button
                type="button"
                onClick={() => startAccept(request)}
                disabled={busy || request.template_id === null}
                title={request.template_id === null ? t("Choose the type first") : undefined}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
              >
                {t("Accept")}
              </button>
              {request.status === "new" && (
                <button type="button" onClick={() => run(() => setRequestStatus(request.id, "waitlist"), "Could not move it")} disabled={busy} className={ghost}>
                  {t("Waitlist")}
                </button>
              )}
              <button type="button" onClick={() => run(() => setRequestStatus(request.id, "declined"), "Could not decline")} disabled={busy} className={ghost}>
                {t("Decline")}
              </button>
            </>
          )}

          {request.status === "declined" && (
            <button type="button" onClick={() => run(() => setRequestStatus(request.id, "new"), "Could not restore")} disabled={busy} className={ghost}>
              {t("Restore")}
            </button>
          )}

          {request.status === "accepted" && request.commission_id !== null && (
            <button
              type="button"
              onClick={() => {
                localStorage.setItem("zeeboard-active-commission-id", String(request.commission_id));
                onOpenCommissionsPage();
              }}
              className={ghost}
            >
              {t("Open")}
            </button>
          )}

          {archived && (
            <button
              type="button"
              title={t("Remove from the list")}
              onClick={() => run(async () => undoToast(showToast, "Removed from the list.", await deleteRequest(request.id)), "Could not remove it")}
              className="px-1 text-faint transition hover:text-tone-bad"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Requests")}
        description={t("People who want a commission: accept them, keep them waiting, or decline.")}
        action={t("+ New request")}
        onAction={() => setDraft({ ...emptyDraft })}
      />

      <section className="h-[calc(100vh-117px)] overflow-y-auto p-5 pb-10">
        <div className="mx-auto max-w-3xl space-y-8">
          <div className={panel}>
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="flex-1">
                <p className="font-semibold">{t("Open for commissions")}</p>
                <p className="text-sm text-muted">Opening or closing your form is still up to you; this keeps count.</p>
              </div>
              <Segmented
                options={[
                  { value: "closed", label: "Closed" },
                  { value: "open", label: "Open" },
                ]}
                value={settings.slots_open ? "open" : "closed"}
                onChange={(value) => saveSlots({ slots_open: value === "open" }).catch(console.error)}
              />
            </div>

            <div className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t("Form responses")}</p>
                <p className="truncate text-sm text-muted" title={settings.responses_file ?? undefined}>
                  {settings.responses_file ?? t("Not connected: pick the CSV your Google script keeps up to date.")}
                </p>
                {settings.responses_file && (
                  <p className="text-xs text-faint">
                    {settings.last_form_sync
                      ? t("Checked {date} · again every 30 minutes", { date: new Date(settings.last_form_sync).toLocaleString() })
                      : t("Not checked yet")}
                  </p>
                )}
              </div>
              <button type="button" onClick={chooseResponsesFile} disabled={busy} className={ghost}>
                {settings.responses_file ? t("Change…") : t("Choose file…")}
              </button>
              {settings.responses_file && (
                <button type="button" onClick={checkNow} disabled={busy} className={ghost}>
                  {t("Check now")}
                </button>
              )}
            </div>

            <div className="flex items-center gap-4 px-5 py-4">
              <div className="flex-1">
                <p className="font-semibold">
                  {t("{taken} of {total} slots taken", { taken, total: settings.slots_total })}
                  <span className={`ml-2 text-sm font-normal ${free < 0 ? "text-tone-bad" : "text-muted"}`}>
                    {free > 0 ? t("{n} free", { n: free }) : free === 0 ? t("full") : t("{n} over", { n: -free })}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Array.from({ length: Math.max(settings.slots_total, taken) }, (_, index) => (
                    <span
                      key={index}
                      className={`h-3 w-5 rounded-sm ${
                        index >= settings.slots_total ? "bg-tone-bad" : index < taken ? "bg-primary" : "border border-line-strong"
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-faint">{t("Every commission that isn't finished takes a slot, including the ones in the queue.")}</p>
              </div>
              <label className="flex items-center gap-1.5 text-sm font-semibold">
                <input
                  type="number"
                  min={1}
                  value={settings.slots_total}
                  onChange={(event) => saveSlots({ slots_total: Math.max(1, Math.round(Number(event.target.value)) || 1) }).catch(console.error)}
                  className="w-16 rounded-md border border-line-strong bg-paper px-2 py-1.5 text-right font-bold outline-none focus:border-ink"
                />
                {t("slots")}
              </label>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold text-muted">{t("New · {n}", { n: waiting.length })}</h3>

              <label className={`${ghost} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
                {t("Import responses…")}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    handleImport(event.target.files?.[0]);
                    // Lets the same file be chosen again
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {!ready ? null : waiting.length === 0 ? (
              <p className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-center text-sm text-faint">
                {t("No new requests. Add one with \"+ New request\".")}
              </p>
            ) : (
              <div className={panel}>{waiting.map(renderRequest)}</div>
            )}
          </div>

          {waitlist.length > 0 && (
            <div>
              <h3 className={heading}>{t("Waitlist · {n}", { n: waitlist.length })}</h3>
              <div className={panel}>{waitlist.map(renderRequest)}</div>
              {free > 0 && (
                <p className="mt-2 text-sm text-muted">
                  {t(free === 1 ? "You have {n} free slot: time to take someone from the waitlist." : "You have {n} free slots: time to take someone from the waitlist.", { n: free })}
                </p>
              )}
            </div>
          )}

          {archive.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowArchive((open) => !open)}
                className={`${heading} transition hover:text-ink`}
              >
                {t("Archive · {n}", { n: archive.length })} {showArchive ? "▴" : "▾"}
              </button>
              {showArchive && <div className={panel}>{archive.map(renderRequest)}</div>}
            </div>
          )}
        </div>
      </section>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label={t("New request")} className="w-[520px] max-w-[94vw] glass-heavy rounded-3xl p-6">
            <DialogBehavior onClose={() => setDraft(null)} />
            <h3 className="text-xl font-black">{t("New request")}</h3>

            <div className="mt-5 space-y-3">
              <input
                autoFocus
                data-private
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={t("Name")}
                className={field}
              />

              <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3">
                <select value={draft.platform} onChange={(event) => setDraft({ ...draft, platform: event.target.value })} className={field}>
                  {PLATFORMS.map((platform) => (
                    <option key={platform}>{platform}</option>
                  ))}
                </select>
                <input
                  data-private
                  value={draft.contact}
                  onChange={(event) => setDraft({ ...draft, contact: event.target.value })}
                  placeholder={t("@username or email")}
                  className={field}
                />
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                <select
                  value={draft.template_id ?? ""}
                  onChange={(event) => setDraft({ ...draft, template_id: event.target.value ? Number(event.target.value) : null })}
                  className={field}
                >
                  <option value="">{t("Type of commission")}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={draft.characters}
                  onChange={(event) => setDraft({ ...draft, characters: Math.max(1, Math.round(Number(event.target.value)) || 1) })}
                  title={t("Number of characters")}
                  className={field}
                />
              </div>

              <textarea
                value={draft.details}
                onChange={(event) => setDraft({ ...draft, details: event.target.value })}
                placeholder={t("What they asked for: idea, references, links…")}
                rows={4}
                className={field}
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className="rounded-md px-4 py-2 text-sm font-semibold text-muted hover:text-ink">
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy || !draft.name.trim() || draft.template_id === null}
                className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
              >
                {t("Add request")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAccept && (
        <ConfirmModal
          eyebrow={t("Slots are full")}
          title={t("Accept {name} anyway?", { name: hide(confirmAccept.name) })}
          message={t("You have {taken} of {total} slots taken. Accepting adds one more. You can also send them to the waitlist instead.", { taken, total: settings.slots_total })}
          confirmLabel={t("Accept anyway")}
          confirmVariant="primary"
          onConfirm={() => accept(confirmAccept)}
          onCancel={() => setConfirmAccept(null)}
        />
      )}
    </>
  );
}

export default RequestsPage;
