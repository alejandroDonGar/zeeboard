import "./App.css";
import { useCallback, useEffect, useState } from "react";
import { initializeDatabase, migrateLegacyImages, migratePaymentTags, purgeOldTrash, restoreLastTrash } from "./lib/database";
import { initImageUrls } from "./lib/images";
import CommissionsPage from "./pages/CommissionsPage";
import ClientsPage from "./pages/ClientsPage";
import CatalogPage from "./pages/CatalogPage";
import FinishedPage from "./pages/FinishedPage";
import SettingsPage from "./pages/SettingsPage";
import StatisticsPage from "./pages/StatisticsPage";
import DashboardPage from "./pages/DashboardPage";
import RequestsPage from "./pages/RequestsPage";
import { ToastProvider, useToast } from "./context/ToastContext";
import { runAutoBackup } from "./lib/backup";
import { setPrivate, usePrivacy } from "./lib/privacy";
import { loadAttention, notifyNew } from "./lib/reminders";
import { REQUESTS_CHANGED, syncFormResponses } from "./lib/formSync";
import { getRequests } from "./lib/database";
import { announceRestored, DATA_RESTORED } from "./lib/undo";
import { t } from "./lib/i18n";
import { ipadSettings, listenIpadImages, pushSnapshot, saveIpadImage, startIpad } from "./lib/ipad";
import Logo from "./components/Logo";
import AmbientBackground from "./components/AmbientBackground";
import { setAmbientPage } from "./lib/ambient";
import CommandPalette, { ShortcutsHelp } from "./components/CommandPalette";
import { requestAction } from "./lib/actions";
import {
  IconBrush,
  IconCircleCheck,
  IconEye,
  IconEyeOff,
  IconInbox,
  IconLayoutDashboard,
  IconChartBar,
  IconSettings,
  IconTags,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";

type Page = "dashboard" | "commissions" | "requests" | "clients" | "finished" | "catalog" | "statistics" | "settings";

const navigationItems: { id: Page; label: string; icon: Icon }[] = [
  { id: "dashboard", label: "Dashboard", icon: IconLayoutDashboard },
  { id: "commissions", label: "Commissions", icon: IconBrush },
  { id: "requests", label: "Requests", icon: IconInbox },
  { id: "clients", label: "Clients", icon: IconUsers },
  { id: "finished", label: "Finished", icon: IconCircleCheck },
  { id: "catalog", label: "Catalog", icon: IconTags },
  { id: "statistics", label: "Statistics", icon: IconChartBar },
  { id: "settings", label: "Settings", icon: IconSettings },
];

type Progress = { done: number; total: number };

// Subscribes on mount to show migration progress
let reportProgress: (progress: Progress) => void = () => {};

// Outside the component so it runs once (StrictMode mounts effects twice)
const startup = initImageUrls()
  .then(initializeDatabase)
  .then(migratePaymentTags)
  .then(() => purgeOldTrash().catch(console.error))
  .then(() => migrateLegacyImages((done, total) => reportProgress({ done, total })));

/** Delivery and stalled-commission alerts: on open and every 30 minutes while the app is open. */
function Reminders() {
  useEffect(() => {
    const check = () => loadAttention().then(notifyNew).catch(console.error);

    check();
    const timer = setInterval(check, 30 * 60 * 1000);

    return () => clearInterval(timer);
  }, []);

  return null;
}

/** New form responses: on open and every 30 minutes, if a responses file is chosen. */
function FormSync() {
  useEffect(() => {
    // A missing file (Drive unmounted, offline…) is silent; retried later
    const check = () => syncFormResponses().catch(console.error);

    check();
    const timer = setInterval(check, 30 * 60 * 1000);

    return () => clearInterval(timer);
  }, []);

  return null;
}

/** Ctrl+Z outside text fields: restores the last deleted item and repaints the screen. */
function UndoShortcut() {
  const { showToast } = useToast();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;

      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== "z" || typing) {
        return;
      }

      event.preventDefault();
      restoreLastTrash()
        .then((label) => {
          if (label === null) {
            showToast("Nothing to undo.", "error");
            return;
          }
          showToast(t("Restored “{name}”.", { name: label }), "success");
          announceRestored();
        })
        .catch((error) => {
          console.error(error);
          showToast("Could not undo.", "error");
        });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showToast]);

  return null;
}

let ipadStarted = false;

/** Receives the images sent from the iPad (Settings > iPad) and keeps the list the iPad page shows up to date. */
function IpadReceiver() {
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listenIpadImages((image) => {
      saveIpadImage(image)
        .then((asRequested) => {
          showToast(asRequested ? "Image received from the iPad." : "That alternative no longer exists: the image was added as a new one.", "success");
          pushSnapshot().catch(console.error);
        })
        .catch((error) => {
          console.error(error);
          showToast(t("Could not save the image from the iPad: {error}", { error: String(error) }), "error");
        });
    }).then((stop) => (cancelled ? stop() : (unlisten = stop)));

    // Left on in the last session: back on with the app
    if (!ipadStarted && ipadSettings().enabled) {
      ipadStarted = true;
      startIpad().catch((error) => showToast(t("Could not start the iPad receiver: {error}", { error: String(error) }), "error"));
    }

    // New commissions or stage changes reach the iPad page within seconds
    const timer = setInterval(() => {
      if (ipadSettings().enabled) pushSnapshot().catch(console.error);
    }, 20000);

    return () => {
      cancelled = true;
      unlisten?.();
      clearInterval(timer);
    };
  }, [showToast]);

  return null;
}

let autoBackupStarted = false;

/** Once per launch, after the app is visible: runs the automatic backup in the background if due. */
function AutoBackup() {
  const { showToast } = useToast();

  useEffect(() => {
    if (autoBackupStarted) {
      return;
    }

    autoBackupStarted = true;

    runAutoBackup().catch((error) => {
      console.error(error);
      showToast(`Automatic backup failed: ${error}. It will try again next time you open ZeeBoard.`, "error");
    });
  }, [showToast]);

  return null;
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    const saved = sessionStorage.getItem("zeeboard-page");
    return navigationItems.some((item) => item.id === saved) ? (saved as Page) : "dashboard";
  });

  useEffect(() => {
    sessionStorage.setItem("zeeboard-page", currentPage);
    // Las manchas del fondo se desplazan despacio a su sitio de esta pantalla
    setAmbientPage(currentPage);
  }, [currentPage]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navKey, setNavKey] = useState(0);

  // Remounts the screen so it re-reads what the search stored for it (commission, client, pending action)
  const go = useCallback((page: string) => {
    setCurrentPage(page as Page);
    setNavKey((key) => key + 1);
  }, []);
  useEffect(() => {
    const repaint = () => setNavKey((key) => key + 1);

    window.addEventListener(DATA_RESTORED, repaint);
    return () => window.removeEventListener(DATA_RESTORED, repaint);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const showShortcuts = useCallback(() => setHelpOpen(true), []);
  // On change the whole app repaints with data hidden or visible
  const privateMode = usePrivacy();
  const [newRequests, setNewRequests] = useState(0);

  useEffect(() => {
    const count = () =>
      getRequests()
        .then((requests) => setNewRequests(requests.filter((request) => request.status === "new").length))
        .catch(console.error);

    count();
    window.addEventListener(REQUESTS_CHANGED, count);
    return () => window.removeEventListener(REQUESTS_CHANGED, count);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;

      if (mod && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPrivate(!privateMode);
      } else if (mod && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (mod && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        go(navigationItems[Number(event.key) - 1].id);
      } else if (mod && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        requestAction("new-commission");
        go("commissions");
      } else if (!mod && !typing && event.key === "?") {
        setHelpOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [privateMode, go]);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    reportProgress = setProgress;

    startup
      .then(({ migrated, failed }) => {
        if (migrated > 0 || failed > 0) {
          console.log(`Images migrated: ${migrated}, failed: ${failed}`);
        }
      })
      .catch(console.error)
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-ink">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1f2933] ring-1 ring-white/10">
            <Logo className="h-9 w-9 bg-[#f6f3ee]" />
          </div>
          <p className="mt-3 text-sm font-bold text-muted">
            {progress
              ? progress.done < progress.total
                ? `Optimizing images ${progress.done + 1} / ${progress.total}…`
                : "Compacting the database…"
              : "Loading ZeeBoard…"}
          </p>

          {progress && (
            <div className="mx-auto mt-4 h-2 w-64 overflow-hidden rounded-sm bg-line">
              <div
                className="h-full rounded-sm bg-primary transition-all duration-500"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}

          {progress && progress.done < progress.total && (
            <p className="mt-3 text-xs text-faint">
              Only needed once. Large canvases take a few seconds each.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AutoBackup />
      <Reminders />
      <FormSync />
      <UndoShortcut />
      <IpadReceiver />
      {paletteOpen && <CommandPalette pages={navigationItems} onGo={go} onClose={closePalette} onShowShortcuts={showShortcuts} />}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      <div className="relative h-screen overflow-clip bg-canvas text-ink">
      <AmbientBackground />
      <div className="relative flex h-full gap-3 p-3">
        <aside className="glass-heavy flex w-60 shrink-0 flex-col rounded-3xl px-3 py-4">
          <div className="mb-6 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1f2933] ring-1 ring-white/10">
              <Logo className="h-5 w-5 bg-[#f6f3ee]" />
            </div>
            <h1 className="text-xl tracking-tight">
              <b className="font-extrabold">Zee</b>
              <span className="font-medium">Board</span>
            </h1>
          </div>

          <nav className="space-y-0.5">
            {navigationItems.map((item) => {
              const isActive = currentPage === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentPage(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "flex w-full items-center gap-3 rounded-xl bg-highlight px-3 py-2 text-left text-sm font-semibold text-ink"
                      : "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted transition hover:bg-highlight/60 hover:text-ink"
                  }
                >
                  <item.icon size={18} stroke={1.5} aria-hidden="true" />
                  {t(item.label)}
                  {item.id === "requests" && newRequests > 0 && (
                    <span className="ml-auto text-xs font-medium text-faint tabular-nums">
                      {newRequests}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => setPrivate(!privateMode)}
            title={t("Hide client names and prices while streaming (Ctrl+Shift+P)")}
            className={`mt-auto flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
              privateMode ? "bg-tone-warn/15 text-ink" : "text-muted hover:bg-highlight hover:text-ink"
            }`}
          >
            {privateMode ? <IconEyeOff size={18} stroke={1.5} aria-hidden="true" /> : <IconEye size={18} stroke={1.5} aria-hidden="true" />}
            {privateMode ? t("Private mode on") : t("Private mode")}
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-muted transition hover:bg-highlight hover:text-ink"
          >
            {t("Shortcuts")}
            <kbd className="rounded-sm border border-line-strong px-1.5 text-xs font-medium">?</kbd>
          </button>
        </aside>

        <main key={navKey} className="relative min-w-0 flex-1">
          {/* Cada pantalla dibuja sus propios paneles de cristal sobre el fondo de colores */}
          <div className="relative h-full overflow-hidden rounded-3xl">
          {currentPage === "dashboard" && (
            <DashboardPage
              onOpenCommissionsPage={() => setCurrentPage("commissions")}
              onNewCommission={() => {
                requestAction("new-commission");
                go("commissions");
              }}
            />
          )}
          {currentPage === "commissions" && <CommissionsPage />}
          {currentPage === "clients" && (
            <ClientsPage onOpenCommissionsPage={() => setCurrentPage("commissions")} />
          )}
          {currentPage === "catalog" && <CatalogPage />}
          {currentPage === "finished" && (
            <FinishedPage onOpenCommissionsPage={() => setCurrentPage("commissions")} />
          )}
          {currentPage === "requests" && (
            <RequestsPage onOpenCommissionsPage={() => setCurrentPage("commissions")} />
          )}
          {currentPage === "statistics" && <StatisticsPage />}
          {currentPage === "settings" && <SettingsPage />}
          </div>
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}

export default App;