import { useEffect, useState } from "react";
import { IconCheck, IconDots, IconDownload } from "@tabler/icons-react";
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
import TopBar from "../components/TopBar";
import GlassPanel from "../components/GlassPanel";
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formMenuOpen, setFormMenuOpen] = useState(false);
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

  const btn =
    "rounded-2xl border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition hover:bg-highlight active:scale-[0.97] disabled:opacity-50";
  const primaryBtn =
    "inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover active:scale-[0.97] disabled:opacity-50";
  const field = "w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm outline-none focus:border-ink";

  // The open request; if it left the list, the next one waiting
  const current = requests.find((request) => request.id === selectedId) ?? waiting[0] ?? waitlist[0] ?? null;
  const currentTemplate = current ? templates.find((item) => item.id === current.template_id) : undefined;
  const estimate =
    current && currentTemplate?.base_price != null
      ? formatMoney(calculateCommissionPrice(currentTemplate.base_price, current.characters, settings.extra_character_rate), settings.default_currency)
      : null;
  const live = current?.status === "new" || current?.status === "waitlist";
  const dot = { new: "bg-tone-info", waitlist: "bg-tone-warn", accepted: "bg-tone-ok", declined: "bg-faint" } as const;
  const statusLabel = { new: "New", waitlist: "Waitlist", accepted: "Accepted", declined: "Declined" } as const;

  function row(request: CommissionRequest) {
    const template = templates.find((item) => item.id === request.template_id);

    return (
      <button
        key={request.id}
        type="button"
        onClick={() => setSelectedId(request.id)}
        aria-current={request.id === current?.id ? "true" : undefined}
        className={`grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${
          request.id === current?.id ? "bg-highlight" : "hover:bg-highlight/60"
        }`}
      >
        <i className={`h-[7px] w-[7px] rounded-full ${dot[request.status]}`} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{hide(request.name)}</span>
          <span className="block truncate text-xs text-faint">
            {template ? (
              `${template.name} · ${t(request.characters === 1 ? "{n} character" : "{n} characters", { n: request.characters })}`
            ) : (
              <span className="font-semibold text-tone-warn">{t("Choose the type…")}</span>
            )}
          </span>
        </span>
        <span className="text-xs text-faint tabular-nums">{dateFormatter.format(new Date(request.created_at))}</span>
      </button>
    );
  }

  const group = (label: string) => <p className="px-2 pt-3 pb-1 text-xs font-semibold text-muted">{label}</p>;
  const prop = (label: string, value: React.ReactNode, empty: string) => (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value || <span className="text-faint">{empty}</span>}</dd>
    </div>
  );

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
        <TopBar title="Requests" action="New request" onAction={() => setDraft({ ...emptyDraft })} end={
          <label className={`${btn} inline-flex cursor-pointer items-center gap-2 ${busy ? "pointer-events-none opacity-50" : ""}`}>
            <IconDownload size={16} stroke={1.75} aria-hidden="true" />
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
        }>
          <Segmented
            options={[
              { value: "closed", label: "Closed" },
              { value: "open", label: "Open" },
            ]}
            value={settings.slots_open ? "open" : "closed"}
            onChange={(value) => saveSlots({ slots_open: value === "open" }).catch(console.error)}
          />

          <div className="flex items-center gap-2.5 whitespace-nowrap text-[13px] text-muted">
            <span aria-hidden="true" className="flex gap-[3px]">
              {Array.from({ length: Math.max(settings.slots_total, taken) }, (_, index) => (
                <i
                  key={index}
                  className={`h-3.5 w-2.5 rounded-sm border ${
                    index >= settings.slots_total ? "border-tone-bad bg-tone-bad" : index < taken ? "border-ink bg-ink" : "border-line-strong"
                  }`}
                />
              ))}
            </span>
            <span className="tabular-nums" title={t("Every commission that isn't finished takes a slot, including the ones in the queue.")}>
              <span className="hidden min-[1500px]:inline">{t("{taken} of {total} slots taken", { taken, total: settings.slots_total })} · </span>
              <span className={free < 0 ? "font-semibold text-tone-bad" : ""}>
                {free > 0 ? t("{n} free", { n: free }) : free === 0 ? t("full") : t("{n} over", { n: -free })}
              </span>
            </span>
            <input
              type="number"
              min={1}
              value={settings.slots_total}
              aria-label={t("slots")}
              onChange={(event) => saveSlots({ slots_total: Math.max(1, Math.round(Number(event.target.value)) || 1) }).catch(console.error)}
              className="w-14 rounded-md border border-line-strong bg-surface px-1.5 py-1 text-right text-sm font-semibold text-ink tabular-nums outline-none focus:border-ink"
            />
          </div>
        </TopBar>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(240px,320px)_minmax(0,1fr)] gap-3">
          <GlassPanel as="nav" className="min-h-0" contentClassName="grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
            <div className="overflow-y-auto p-2">
              {group(t("New · {n}", { n: waiting.length }))}
              {!ready ? null : waiting.length === 0 ? (
                <p className="px-2 py-1 text-xs text-faint">{t("No new requests. Add one with \"+ New request\".")}</p>
              ) : (
                waiting.map(row)
              )}

              {waitlist.length > 0 && (
                <>
                  {group(t("Waitlist · {n}", { n: waitlist.length }))}
                  {free > 0 && (
                    <p className="mx-2 mb-1.5 rounded-md bg-tone-ok/12 px-2.5 py-2 text-xs">
                      {t(free === 1 ? "You have {n} free slot: time to take someone from the waitlist." : "You have {n} free slots: time to take someone from the waitlist.", { n: free })}
                    </p>
                  )}
                  {waitlist.map(row)}
                </>
              )}

              {archive.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={showArchive}
                    onClick={() => setShowArchive((open) => !open)}
                    className="px-2 pt-3 pb-1 text-xs font-semibold text-muted transition hover:text-ink"
                  >
                    {t("Archive · {n}", { n: archive.length })} {showArchive ? "▴" : "▾"}
                  </button>
                  {showArchive && archive.map(row)}
                </>
              )}
            </div>

            {/* The form the responses come from */}
            <div className="flex items-center gap-2 border-t border-line px-3 py-2.5 text-[13px] text-muted">
              <i className={`h-[7px] w-[7px] shrink-0 rounded-full ${settings.responses_file ? "bg-tone-ok" : "bg-faint"}`} />
              <span className="min-w-0 flex-1">
                {settings.responses_file ? t("Form connected") : t("Form not connected")}
                <small className="block truncate text-xs text-faint" title={settings.responses_file ?? undefined}>
                  {settings.responses_file
                    ? settings.last_form_sync
                      ? t("Checked {date} · again every 30 minutes", { date: new Date(settings.last_form_sync).toLocaleString() })
                      : t("Not checked yet")
                    : t("Pick the CSV your Google script keeps up to date.")}
                </small>
              </span>
              <div className="relative">
                <button
                  type="button"
                  title={t("Form options")}
                  aria-label={t("Form options")}
                  aria-haspopup="true"
                  aria-expanded={formMenuOpen}
                  onClick={() => setFormMenuOpen((open) => !open)}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-2xl border border-line-strong bg-surface text-ink transition hover:bg-highlight"
                >
                  <IconDots size={16} stroke={1.75} aria-hidden="true" />
                </button>

                {formMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setFormMenuOpen(false)} />
                    <div role="menu" className="absolute right-0 bottom-full z-40 mb-1.5 w-48 rounded-3xl border border-line-strong bg-surface p-1.5 shadow-lg">
                      {settings.responses_file && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => {
                            setFormMenuOpen(false);
                            checkNow();
                          }}
                          className="block w-full rounded-sm px-2.5 py-2 text-left text-sm text-ink hover:bg-highlight"
                        >
                          {t("Check now")}
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => {
                          setFormMenuOpen(false);
                          chooseResponsesFile();
                        }}
                        className="block w-full rounded-sm px-2.5 py-2 text-left text-sm text-ink hover:bg-highlight"
                      >
                        {settings.responses_file ? t("Change…") : t("Choose file…")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </GlassPanel>

          <div className="glass relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl @container">
            {!ready ? null : !current ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <p className="font-display text-xl font-semibold">{t("Pick a request")}</p>
                <p className="mt-1 text-sm text-muted">{t("What they asked for shows up here.")}</p>
              </div>
            ) : (
              <>
                <div className="shrink-0 px-6 pt-5 pb-4">
                  <h2 className="font-display text-3xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">{hide(current.name)}</h2>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <i className={`h-[7px] w-[7px] rounded-full ${dot[current.status]}`} />
                      {t(statusLabel[current.status])}
                    </span>
                    <span>{t("Received on {date}", { date: dateFormatter.format(new Date(current.created_at)) })}</span>
                  </p>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto border-t border-line @min-[700px]:grid-cols-[minmax(0,1fr)_clamp(250px,32%,320px)] @min-[700px]:overflow-hidden">
                  <div className="min-w-0 p-5 @min-[700px]:overflow-y-auto">
                    <p className="mb-2 text-[13px] font-semibold">{t("What they ask for")}</p>
                    {current.details ? (
                      <p className="max-w-[68ch] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                        <Linkified text={current.details} />
                      </p>
                    ) : (
                      <p className="text-faint">{t("No details.")}</p>
                    )}
                  </div>

                  <dl className="grid min-w-0 content-start gap-y-2.5 border-t border-line p-4 @min-[700px]:overflow-y-auto @min-[700px]:border-t-0 @min-[700px]:border-l">
                    <div className="min-w-0">
                      <dt className="text-xs text-faint">{t("Type")}</dt>
                      <dd>
                        {currentTemplate ? (
                          currentTemplate.name
                        ) : (
                          <select
                            value=""
                            onChange={(event) => run(() => setRequestTemplate(current.id, Number(event.target.value)), "Could not set the type")}
                            className="w-full rounded-md border border-tone-warn bg-tone-warn/15 px-2 py-1 text-sm font-semibold text-ink"
                          >
                            <option value="">{t("Choose the type…")}</option>
                            {templates.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </dd>
                    </div>
                    {prop(t("Characters"), current.characters, "")}
                    {prop(t("Estimate"), estimate && `≈ ${estimate}`, t("When you pick the type"))}
                    {prop(
                      t("Contact"),
                      current.contact && [current.platform, hide(current.contact)].filter(Boolean).join(" "),
                      t("No contact"),
                    )}
                    {prop(
                      t("Social account"),
                      current.tag_handle &&
                        `${current.tag_platform && current.tag_platform !== "Other" ? `${current.tag_platform} ` : ""}${hide(current.tag_handle)}`,
                      t("They didn't say"),
                    )}
                    {prop(t("Email"), current.email && hide(current.email), t("No email"))}
                  </dl>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface/60 px-4 py-2.5">
                  {live && (
                    <>
                      <button
                        type="button"
                        onClick={() => startAccept(current)}
                        disabled={busy || current.template_id === null}
                        className={primaryBtn}
                      >
                        <IconCheck size={16} stroke={2} aria-hidden="true" />
                        {t("Accept")}
                      </button>
                      {current.status === "new" && (
                        <button type="button" onClick={() => run(() => setRequestStatus(current.id, "waitlist"), "Could not move it")} disabled={busy} className={btn}>
                          {t("Waitlist")}
                        </button>
                      )}
                      <button type="button" onClick={() => run(() => setRequestStatus(current.id, "declined"), "Could not decline")} disabled={busy} className={btn}>
                        {t("Decline")}
                      </button>
                      {current.template_id === null && <span className="text-xs text-faint">{t("Choose the type first")}</span>}
                    </>
                  )}

                  {current.status === "accepted" && current.commission_id !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.setItem("zeeboard-active-commission-id", String(current.commission_id));
                        onOpenCommissionsPage();
                      }}
                      className={btn}
                    >
                      {t("Open commission")}
                    </button>
                  )}

                  {current.status === "declined" && (
                    <button type="button" onClick={() => run(() => setRequestStatus(current.id, "new"), "Could not restore")} disabled={busy} className={btn}>
                      {t("Restore")}
                    </button>
                  )}

                  {!live && (
                    <button
                      type="button"
                      onClick={() => run(async () => undoToast(showToast, "Removed from the list.", await deleteRequest(current.id)), "Could not remove it")}
                      disabled={busy}
                      className={btn}
                    >
                      {t("Remove from the list")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {draft && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" aria-label={t("New request")} className="w-[520px] max-w-[94vw] modal-card rounded-3xl p-6">
            <DialogBehavior onClose={() => setDraft(null)} />
            <h3 className="font-display text-2xl font-semibold tracking-tight">{t("New request")}</h3>

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
                className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-50"
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
