import PageHeader from "../components/PageHeader";
import { Segmented } from "../components/BoardFilters";
import { useEffect, useState } from "react";
import { backupBeforeCleanup, exportBackup, pickBackupFolder, pickFolder, restoreBackup, runAutoBackup } from "../lib/backup";
import { applyTheme, getTheme, type ThemeChoice } from "../lib/theme";
import {
  appSettings,
  emptyTrash,
  getAllUsedImagePaths,
  getLastImportedPaymentDate,
  getPaymentPlatforms,
  getTrash,
  purgeTrashEntry,
  restoreTrash,
  savePaymentPlatforms,
  updateSettings,
  type PaymentPlatform,
  type TrashEntry,
} from "../lib/database";
import { KINDS, TRASH_DAYS, type TrashKind } from "../lib/trash";
import { useToast } from "../context/ToastContext";
import { formatMoney, isoDay, receivedAfterFees } from "../lib/commissionHelpers";
import { exportCsv, type ExportKind } from "../lib/export";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { appDataDir, join } from "@tauri-apps/api/path";
import { cleanUpOrphanedImages, getStorageStats, type StorageStats } from "../lib/images";
import ConfirmModal from "../components/ConfirmModal";
import { getLanguage, setLanguage, t, type Language } from "../lib/i18n";
import PaypalImport, { pickPaypalFile, type PaypalPreview } from "../components/PaypalImport";
import IpadSettings from "../components/IpadSettings";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SettingsPage() {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);
  const [currency, setCurrency] = useState(appSettings().default_currency);
  const [ratePercent, setRatePercent] = useState(String(Math.round(appSettings().extra_character_rate * 100)));
  const [platforms, setPlatforms] = useState<Omit<PaymentPlatform, "id">[]>([]);
  const [exportingKind, setExportingKind] = useState<ExportKind | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [auto, setAuto] = useState(appSettings());
  const [paypal, setPaypal] = useState<PaypalPreview | null>(null);
  const [lastImport, setLastImport] = useState<string | null>(null);

  useEffect(() => {
    getLastImportedPaymentDate().then(setLastImport).catch(console.error);
  }, []);

  // Download from 2 days before the last payment: repeats are skipped and none slips through the edge
  const downloadFrom = lastImport ? isoDay(new Date(new Date(`${lastImport}T12:00:00`).getTime() - 2 * 86400000)) : null;

  async function handleImportPaypal() {
    try {
      setExportMessage(null);
      setPaypal(await pickPaypalFile());
    } catch (error) {
      console.error(error);
      setExportMessage(`${error}`);
    }
  }

  async function handleExport(kind: ExportKind) {
    try {
      setExportingKind(kind);
      setExportMessage(null);
      const path = await exportCsv(kind);

      if (path) {
        setExportMessage(t("Saved to: {path}", { path }));
      }
    } catch (error) {
      console.error(error);
      setExportMessage(t("Could not export: {error}", { error: String(error) }));
    } finally {
      setExportingKind(null);
    }
  }
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  // Saves any setting and refreshes `auto`, a copy of all of them
  async function saveAuto(changes: Parameters<typeof updateSettings>[0]) {
    await updateSettings(changes);
    setAuto({ ...appSettings() });
  }

  async function handleToggleAuto(enabled: boolean) {
    // Without a folder there's nowhere to copy: asked on enabling
    const folder = auto.auto_backup_folder ?? (enabled ? await pickFolder(t("Choose a folder for automatic backups")) : null);

    if (enabled && !folder) {
      return;
    }

    await saveAuto({ auto_backup_enabled: enabled, auto_backup_folder: folder });
  }

  async function handleBackUpNow() {
    try {
      setAutoRunning(true);
      setAutoMessage(null);
      const path = await runAutoBackup(true);
      setAutoMessage(t("Backup saved to: {path}", { path: path ?? "" }));
      setAuto({ ...appSettings() });
    } catch (error) {
      console.error(error);
      setAutoMessage(t("Could not back up: {error}", { error: String(error) }));
    } finally {
      setAutoRunning(false);
    }
  }

  useEffect(() => {
    getPaymentPlatforms().then(setPlatforms).catch(console.error);
  }, []);

  function updatePlatform(index: number, changes: Partial<Omit<PaymentPlatform, "id">>) {
    setPlatforms((current) => current.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  }

  function savePlatforms() {
    // Saved on leaving each field; rows without a name aren't saved
    savePaymentPlatforms(platforms).catch(console.error);
  }
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [imagesInUse, setImagesInUse] = useState(0);

  async function loadStorage() {
    const [stats, usedPaths] = await Promise.all([getStorageStats(), getAllUsedImagePaths()]);

    setStorage(stats);
    // Several rows can share the same file
    setImagesInUse(new Set(usedPaths).size);
  }

  useEffect(() => {
    loadStorage().catch(console.error);
  }, []);

  const { showToast } = useToast();
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  // What the confirm modal is about: one entry, or null for the whole trash
  const [purging, setPurging] = useState<{ entry: TrashEntry | null } | null>(null);

  const loadTrash = () => getTrash().then(setTrash).catch(console.error);

  useEffect(() => {
    loadTrash();
  }, []);

  async function handleRestore(entry: TrashEntry) {
    try {
      const label = await restoreTrash(entry.id);
      showToast(label === null ? "Nothing to undo." : t("Restored “{name}”.", { name: label }), label === null ? "error" : "success");
    } catch (error) {
      console.error(error);
      showToast("Could not undo.", "error");
    }
    loadTrash();
  }

  async function handlePurge(entry: TrashEntry | null) {
    try {
      await (entry ? purgeTrashEntry(entry.id) : emptyTrash());
      showToast(entry ? "Deleted for good." : "Trash emptied.", "success");
    } catch (error) {
      console.error(error);
      showToast("Could not delete.", "error");
    }
    loadTrash();
    loadStorage().catch(console.error);
  }

  const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

  const [exporting, setExporting] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [showCleanUpConfirmModal, setShowCleanUpConfirmModal] = useState(false);
  const [restoreFolder, setRestoreFolder] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  async function handleExportBackup() {
    try {
      setExporting(true);
      setBackupMessage(null);

      const backupPath = await exportBackup();

      if (backupPath) {
        setBackupMessage(t("Backup saved to: {path}", { path: backupPath }));
      }
    } catch (error) {
      console.error(error);
      setBackupMessage(t("Could not create backup. Please try again."));
    } finally {
      setExporting(false);
    }
  }

  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanUpMessage, setCleanUpMessage] = useState<string | null>(null);

  async function handleCleanUpOrphanedImages() {
    try {
      setCleaningUp(true);
      setCleanUpMessage(null);

      // If the prior backup fails nothing is deleted
      try {
        await backupBeforeCleanup();
      } catch (error) {
        console.error(error);
        setCleanUpMessage(t("Could not back up first, so nothing was deleted: {error}", { error: String(error) }));
        return;
      }

      const before = await getStorageStats();
      const usedPaths = await getAllUsedImagePaths();
      const { deletedCount } = await cleanUpOrphanedImages(usedPaths);
      const after = await getStorageStats();
      const freedBytes =
        before.imagesBytes + before.thumbsBytes - after.imagesBytes - after.thumbsBytes;

      setCleanUpMessage(
        deletedCount === 0
          ? t("No unused images found.")
          : t(deletedCount === 1 ? "Deleted {n} unused file · freed {size}." : "Deleted {n} unused files · freed {size}.", { n: deletedCount, size: formatBytes(freedBytes) }),
      );
    } catch (error) {
      console.error(error);
      setCleanUpMessage(t("Could not clean up images. Please try again."));
    } finally {
      setCleaningUp(false);
      loadStorage().catch(console.error);
    }
  }

  const totalBytes = storage ? storage.imagesBytes + storage.thumbsBytes + storage.databaseBytes : 0;
  const share = (bytes: number) => `${totalBytes > 0 ? (bytes / totalBytes) * 100 : 0}%`;

  const positive = (text: string) => Math.max(1, Math.round(Number(text)) || 1);
  const numberField =
    "w-16 rounded-md border border-line-strong bg-paper px-2 py-1.5 text-right font-bold outline-none focus:border-ink";

  const section = "mb-2 mt-8 text-xs font-bold text-muted first:mt-0";
  const panel = "panel divide-y divide-line rounded-3xl";
  const row = "flex items-center gap-4 px-5 py-4";
  const ghostButton =
    "rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <>
      <PageHeader label="Preferences" title="Settings" description="Appearance, pricing, backups and storage." />

      <section className="h-[calc(100vh-117px)] overflow-y-auto p-5 pb-10">
        <div className="mx-auto max-w-2xl">
          <h3 className={section}>{t("Appearance")}</h3>
          <div className={panel}>
            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Theme")}</p>
                <p className="text-sm text-muted">{t("Light, dark, or follow your Windows setting.")}</p>
              </div>
              <Segmented<ThemeChoice>
                options={[
                  { value: "light", label: t("Light") },
                  { value: "dark", label: t("Dark") },
                  { value: "system", label: t("System") },
                ]}
                value={theme}
                onChange={(option) => {
                  applyTheme(option);
                  setTheme(option);
                }}
              />
            </div>

            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Language")}</p>
                <p className="text-sm text-muted">{t("The app reloads when you change it.")}</p>
              </div>
              <Segmented<Language>
                options={[
                  { value: "en", label: "English" },
                  { value: "es", label: "Español" },
                ]}
                value={getLanguage()}
                onChange={setLanguage}
              />
            </div>
          </div>

          <h3 className={section}>{t("Pricing")}</h3>
          <div className={panel}>
            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Default currency")}</p>
                <p className="text-sm text-muted">{t("New commissions start with this one.")}</p>
              </div>
              <Segmented
                options={["EUR", "USD", "GBP"].map((code) => ({ value: code, label: code }))}
                value={currency}
                onChange={(code) => {
                  setCurrency(code);
                  updateSettings({ default_currency: code }).catch(console.error);
                }}
              />
            </div>

            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Extra character")}</p>
                <p className="text-sm text-muted">
                  {t("Added to the base price for each character after the first. Commissions you already created keep their price.")}
                </p>
              </div>
              <label className="flex items-center gap-1 text-sm font-semibold">
                <input
                  type="number"
                  min={0}
                  value={ratePercent}
                  onChange={(event) => setRatePercent(event.target.value)}
                  onBlur={() => {
                    const value = Math.max(0, Number(ratePercent) || 0);
                    setRatePercent(String(value));
                    updateSettings({ extra_character_rate: value / 100 }).catch(console.error);
                  }}
                  className="w-20 rounded-md border border-line-strong bg-paper px-2 py-1.5 text-right font-bold outline-none focus:border-ink"
                />
                %
              </label>
            </div>

            <div className="px-5 py-4">
              <p className="font-semibold">{t("Payment platforms")}</p>
              <p className="text-sm text-muted">
                {t("Their fees, so \"received\" fills itself when you log a payment. Use your real rates.")}
              </p>

              {platforms.length > 0 && (
                <div className="mt-3 space-y-2">
                  {platforms.map((platform, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <input
                        value={platform.name}
                        onChange={(event) => updatePlatform(index, { name: event.target.value })}
                        onBlur={savePlatforms}
                        placeholder="PayPal"
                        className="min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-2 py-1.5 outline-none focus:border-ink"
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={platform.percent}
                        onChange={(event) => updatePlatform(index, { percent: Number(event.target.value) || 0 })}
                        onBlur={savePlatforms}
                        className="w-20 rounded-md border border-line-strong bg-paper px-2 py-1.5 text-right outline-none focus:border-ink"
                      />
                      <span className="text-muted">% +</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={platform.fixed}
                        onChange={(event) => updatePlatform(index, { fixed: Number(event.target.value) || 0 })}
                        onBlur={savePlatforms}
                        className="w-20 rounded-md border border-line-strong bg-paper px-2 py-1.5 text-right outline-none focus:border-ink"
                      />
                      <span className="w-24 text-xs text-faint">
                        200 → {formatMoney(receivedAfterFees(200, platform), currency)}
                      </span>
                      <button
                        type="button"
                        title={t("Remove platform")}
                        onClick={() => {
                          const next = platforms.filter((_, i) => i !== index);
                          setPlatforms(next);
                          savePaymentPlatforms(next).catch(console.error);
                        }}
                        className="px-1 text-faint transition hover:text-tone-bad"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setPlatforms([...platforms, { name: "", percent: 0, fixed: 0 }])}
                className="mt-3 text-sm font-semibold text-muted transition hover:text-ink"
              >
                {t("+ Add platform")}
              </button>
            </div>
          </div>

          <h3 className={section}>{t("Delivery")}</h3>
          <div className={panel}>
            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Promised delivery time")}</p>
                <p className="text-sm text-muted">
                  {t("The longest you tell clients it can take. A commission without a deadline counts from the day you accept it.")}
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-sm font-semibold">
                <input
                  type="number"
                  min={1}
                  value={auto.promise_max_days}
                  onChange={(event) => saveAuto({ promise_max_days: positive(event.target.value) }).catch(console.error)}
                  className={numberField}
                />
                {t("days")}
              </label>
            </div>

            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Delivery reminders")}</p>
                <p className="text-sm text-muted">
                  {t("A Windows notification {days} days before and on the day, while ZeeBoard is open.", { days: auto.reminder_days_before })}
                </p>
              </div>
              {auto.reminders_enabled && (
                <label className="flex items-center gap-1.5 text-sm font-semibold">
                  <input
                    type="number"
                    min={1}
                    value={auto.reminder_days_before}
                    onChange={(event) =>
                      saveAuto({ reminder_days_before: positive(event.target.value) }).catch(console.error)
                    }
                    className={numberField}
                  />
                  {t("days before")}
                </label>
              )}
              <Segmented
                options={[
                  { value: "off", label: t("Off") },
                  { value: "on", label: t("On") },
                ]}
                value={auto.reminders_enabled ? "on" : "off"}
                onChange={(value) => saveAuto({ reminders_enabled: value === "on" }).catch(console.error)}
              />
            </div>

            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Stalled commissions")}</p>
                <p className="text-sm text-muted">
                  {t("Warns you when a commission has had no new image, correction, payment or stage change for a while.")}
                </p>
              </div>
              {auto.stalled_enabled && (
                <label className="flex items-center gap-1.5 text-sm font-semibold">
                  <input
                    type="number"
                    min={1}
                    value={auto.stalled_days}
                    onChange={(event) => saveAuto({ stalled_days: positive(event.target.value) }).catch(console.error)}
                    className={numberField}
                  />
                  {t("days")}
                </label>
              )}
              <Segmented
                options={[
                  { value: "off", label: t("Off") },
                  { value: "on", label: t("On") },
                ]}
                value={auto.stalled_enabled ? "on" : "off"}
                onChange={(value) => saveAuto({ stalled_enabled: value === "on" }).catch(console.error)}
              />
            </div>
          </div>

          <h3 className={section}>{t("Backups")}</h3>
          <div className={panel}>
            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Back up your data")}</p>
                <p className="text-sm text-muted">
                  {t("Database and images, to any folder. Restoring saves a copy of your current data first.")}
                </p>
                {backupMessage && <p className="mt-1 text-xs text-muted">{backupMessage}</p>}
              </div>
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={exporting}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
              >
                {exporting ? t("Exporting…") : t("Export")}
              </button>
              <button
                type="button"
                onClick={async () => setRestoreFolder(await pickBackupFolder())}
                disabled={restoring}
                className={ghostButton}
              >
                {restoring ? t("Restoring…") : t("Restore…")}
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="font-semibold">{t("Automatic backups")}</p>
                  <p className="text-sm text-muted">
                    {t("A copy the first time you open ZeeBoard each day. Older copies are removed automatically.")}
                  </p>
                </div>
                <Segmented
                  options={[
                    { value: "off", label: t("Off") },
                    { value: "on", label: t("On") },
                  ]}
                  value={auto.auto_backup_enabled ? "on" : "off"}
                  onChange={(value) => handleToggleAuto(value === "on").catch(console.error)}
                />
              </div>

              {auto.auto_backup_folder && (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{t("Folder")}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold" title={auto.auto_backup_folder}>
                      {auto.auto_backup_folder}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const folder = await pickFolder(t("Choose a folder for automatic backups"));
                        if (folder) await saveAuto({ auto_backup_folder: folder });
                      }}
                      className={ghostButton}
                    >
                      {t("Change…")}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-muted">{t("Keep the last")}</span>
                    <input
                      type="number"
                      min={1}
                      value={auto.auto_backup_keep}
                      onChange={(event) =>
                        saveAuto({ auto_backup_keep: Math.max(1, Math.round(Number(event.target.value)) || 1) }).catch(
                          console.error,
                        )
                      }
                      className="w-16 rounded-md border border-line-strong bg-paper px-2 py-1 text-right font-bold outline-none focus:border-ink"
                    />
                    <span className="text-muted">{t("copies")}</span>

                    <span className="ml-auto text-xs text-faint">
                      {auto.last_auto_backup
                        ? t("Last backup: {date}", { date: new Date(auto.last_auto_backup).toLocaleString() })
                        : t("No automatic backup yet")}
                    </span>
                    <button type="button" onClick={handleBackUpNow} disabled={autoRunning} className={ghostButton}>
                      {autoRunning ? t("Backing up…") : t("Back up now")}
                    </button>
                  </div>

                  {autoMessage && <p className="text-xs text-muted">{autoMessage}</p>}
                </div>
              )}
            </div>
          </div>

          <h3 className={section}>{t("Import payments")}</h3>
          <div className={panel}>
            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("PayPal activity (CSV)")}</p>
                <p className="text-sm text-muted">
                  {t("Matches each payment with a client by their email and adds it to their commission, with what you actually received. Payments already imported are skipped.")}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {lastImport ? t("Last imported payment: {last}. Download from {from}.", { last: lastImport, from: downloadFrom ?? "" }) : t("Nothing imported yet.")}
                </p>
              </div>
              <button type="button" onClick={handleImportPaypal} className={ghostButton}>
                {t("Choose CSV")}
              </button>
            </div>
          </div>

          <h3 className={section}>{t("Export data")}</h3>
          <div className={panel}>
            {(
              [
                ["commissions", "Commissions", "One row per commission: client, type, stage, price and what has been paid."],
                ["payments", "Payments", "One row per payment: date, what the client paid, what you received and the platform fee."],
                [
                  "quarterly",
                  "Quarterly summary",
                  "Payments grouped by quarter and currency, by the day you received them. Currencies are never added together.",
                ],
              ] as const
            ).map(([kind, title, description]) => (
              <div key={kind} className={row}>
                <div className="flex-1">
                  <p className="font-semibold">{t(title)}</p>
                  <p className="text-sm text-muted">{t(description)}</p>
                </div>
                <button type="button" onClick={() => handleExport(kind)} disabled={exportingKind !== null} className={ghostButton}>
                  {exportingKind === kind ? t("Exporting…") : t("Export CSV")}
                </button>
              </div>
            ))}

            <p className="px-5 py-3 text-xs text-muted">
              {t("Opens in Excel and Google Sheets (semicolon-separated, decimal comma). Exports always contain the real names and prices, even in private mode.")}
              {exportMessage && <span className="mt-1 block">{exportMessage}</span>}
            </p>
          </div>

          <h3 className={section}>{t("iPad")}</h3>
          <IpadSettings />

          <h3 className={section}>{t("Trash")}</h3>
          <div className={panel}>
            {trash.length === 0 ? (
              <p className={`${row} text-sm text-muted`}>
                {t("The trash is empty. Deleted items stay here for {days} days.", { days: TRASH_DAYS })}
              </p>
            ) : (
              <>
                {trash.map((entry) => {
                  const days = daysAgo(entry.deleted_at);

                  return (
                    <div key={entry.id} className={row}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{entry.label}</p>
                        <p className="text-xs text-muted">
                          {t(KINDS[entry.kind as TrashKind]?.label ?? entry.kind)} ·{" "}
                          {days === 0 ? t("today") : t(days === 1 ? "{n} day ago" : "{n} days ago", { n: days })}
                        </p>
                      </div>
                      <button type="button" onClick={() => handleRestore(entry)} className={ghostButton}>
                        {t("Restore")}
                      </button>
                      <button type="button" onClick={() => setPurging({ entry })} className={ghostButton}>
                        {t("Delete forever")}
                      </button>
                    </div>
                  );
                })}
                <div className={row}>
                  <p className="flex-1 text-sm text-muted">
                    {t("Items are removed for good after {days} days.", { days: TRASH_DAYS })}
                  </p>
                  <button type="button" onClick={() => setPurging({ entry: null })} className={ghostButton}>
                    {t("Empty trash")}
                  </button>
                </div>
              </>
            )}
          </div>

          <h3 className={section}>{t("Storage")}</h3>
          <div className={panel}>
            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{storage ? t("{size} used", { size: formatBytes(totalBytes) }) : t("Storage")}</p>
                {storage && (
                  <>
                    <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-sm bg-paper">
                      <span className="bg-primary" style={{ width: share(storage.imagesBytes) }} />
                      <span className="bg-faint" style={{ width: share(storage.thumbsBytes) }} />
                      <span className="bg-line-strong" style={{ width: share(storage.databaseBytes) }} />
                    </div>
                    <p className="mt-1.5 text-xs text-muted">
                      {t("Images {images} ({used} in use · {count} files) · Thumbnails {thumbs} · Database {database}", {
                        images: formatBytes(storage.imagesBytes),
                        used: imagesInUse,
                        count: storage.imageCount,
                        thumbs: formatBytes(storage.thumbsBytes),
                        database: formatBytes(storage.databaseBytes),
                      })}
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={async () => revealItemInDir(await join(await appDataDir(), "zeeboard.db"))}
                className={ghostButton}
              >
                {t("Open folder")}
              </button>
            </div>

            <div className={row}>
              <div className="flex-1">
                <p className="font-semibold">{t("Unused images")}</p>
                <p className="text-sm text-muted">{t("Files that no commission or character uses anymore.")}</p>
                {cleanUpMessage && <p className="mt-1 text-xs text-muted">{cleanUpMessage}</p>}
              </div>
              <button
                type="button"
                onClick={() => setShowCleanUpConfirmModal(true)}
                disabled={cleaningUp}
                className={ghostButton}
              >
                {cleaningUp ? t("Cleaning up…") : t("Clean up")}
              </button>
            </div>
          </div>
        </div>
      </section>

      {paypal && <PaypalImport preview={paypal} onClose={() => setPaypal(null)} />}

      {restoreFolder && (
        <ConfirmModal
          eyebrow="Replace your data"
          eyebrowTone="danger"
          title="Restore this backup?"
          message={t(
            "Your current commissions, clients and settings will be replaced by the ones in:\n{folder}\n\nA copy of your current data is saved first (in the app folder, \"before-restore\"), and no images are deleted. The app reloads when it's done.",
            { folder: restoreFolder },
          )}
          confirmLabel="Restore backup"
          onConfirm={async () => {
            setRestoring(true);
            try {
              await restoreBackup(restoreFolder);
            } catch (error) {
              console.error(error);
              setBackupMessage(t("Could not restore: {error}", { error: String(error) }));
              setRestoreFolder(null);
              setRestoring(false);
            }
          }}
          onCancel={() => setRestoreFolder(null)}
        />
      )}

      {purging && (
        <ConfirmModal
          eyebrow="Permanent action"
          eyebrowTone="danger"
          title={purging.entry ? purging.entry.label : "Empty the trash"}
          message="This permanently deletes it, including its image files. It can't be undone."
          confirmLabel={purging.entry ? "Delete forever" : "Empty trash"}
          onConfirm={() => {
            const { entry } = purging;
            setPurging(null);
            handlePurge(entry);
          }}
          onCancel={() => setPurging(null)}
        />
      )}

      {showCleanUpConfirmModal && (
        <ConfirmModal
          eyebrow="Permanent action"
          eyebrowTone="danger"
          title="Clean up unused images"
          message="This permanently deletes image files that are no longer linked to any commission or character. A full backup is saved first (in the app folder, 'before-cleanup', keeping the last 2), so you can restore from it if something was needed."
          confirmLabel="Delete unused images"
          onConfirm={() => {
            setShowCleanUpConfirmModal(false);
            handleCleanUpOrphanedImages();
          }}
          onCancel={() => setShowCleanUpConfirmModal(false)}
        />
      )}
    </>
  );
}

export default SettingsPage;