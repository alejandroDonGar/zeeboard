import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBrush,
  IconDeviceFloppy,
  IconEyeOff,
  IconInbox,
  IconKeyboard,
  IconLanguage,
  IconMoon,
  IconPlus,
  IconSearch,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import { useToast } from "../context/ToastContext";
import { requestAction } from "../lib/actions";
import { runAutoBackup } from "../lib/backup";
import {
  getClients,
  getCommissions,
  getRequests,
  getTemplates,
  getTemplateStages,
  type Client,
  type Commission,
  type CommissionRequest,
  type TemplateStage,
} from "../lib/database";
import { getLanguage, setLanguage, t } from "../lib/i18n";
import { hide, isPrivate, setPrivate } from "../lib/privacy";
import { search } from "../lib/search";
import { applyTheme, getTheme } from "../lib/theme";

export type PageItem = { id: string; label: string; icon: Icon };

type Entry = {
  key: string;
  group: string;
  icon: Icon;
  label: string;
  hint?: string;
  fields: string[];
  run: () => void;
};

type Data = {
  commissions: Commission[];
  clients: Client[];
  requests: CommissionRequest[];
  stages: Record<number, TemplateStage[]>;
  templates: Record<number, string>;
};

const SHORTCUTS: [string, string][] = [
  ["Ctrl+K", "Search and actions"],
  ["Ctrl+1 … 9", "Go to a screen (menu order)"],
  ["Ctrl+N", "New commission"],
  ["Ctrl+Z", "Restore what you just deleted"],
  ["Ctrl+Shift+P", "Toggle private mode"],
  ["?", "Show this list"],
  ["Esc", "Close"],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[420px] glass-heavy rounded-3xl p-6" onClick={(event) => event.stopPropagation()}>
        <h3 className="font-display text-2xl font-semibold">{t("Keyboard shortcuts")}</h3>
        <div className="mt-4 divide-y divide-line">
          {SHORTCUTS.map(([keys, description]) => (
            <div key={keys} className="flex items-center justify-between py-2 text-sm">
              <span>{t(description)}</span>
              <kbd className="rounded-sm border border-line-strong bg-paper px-2 py-0.5 text-xs font-bold text-muted">{keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CommandPalette({
  pages,
  onGo,
  onClose,
  onShowShortcuts,
}: {
  pages: PageItem[];
  onGo: (page: string) => void;
  onClose: () => void;
  onShowShortcuts: () => void;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [commissions, clients, requests, templates] = await Promise.all([
        getCommissions(),
        getClients(),
        getRequests(),
        getTemplates(),
      ]);
      const stageEntries = await Promise.all(templates.map(async (template) => [template.id, await getTemplateStages(template.id)] as const));

      setData({
        commissions,
        clients,
        requests,
        stages: Object.fromEntries(stageEntries),
        templates: Object.fromEntries(templates.map((template) => [template.id, template.name])),
      });
    })().catch(console.error);
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const run = (action: () => void) => () => {
      onClose();
      action();
    };
    const go = (page: string) => run(() => onGo(page));
    const dark = getTheme() === "dark" || (getTheme() === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const list: Entry[] = [];

    for (const commission of data?.commissions ?? []) {
      const stages = commission.template_id ? data?.stages[commission.template_id] ?? [] : [];
      const stage = stages.find((item) => item.id === commission.current_stage_id);
      const finished = stages.length > 0 && stage === stages[stages.length - 1];

      list.push({
        key: `commission-${commission.id}`,
        group: "Commissions",
        icon: IconBrush,
        label: commission.title,
        hint: [commission.client_name && hide(commission.client_name), stage ? (finished ? t("Finished") : stage.name) : t("Queue")].filter(Boolean).join(" · "),
        fields: [commission.title, commission.client_name ?? "", stage?.name ?? ""],
        run: run(() => {
          localStorage.setItem("zeeboard-active-commission-id", String(commission.id));
          onGo("commissions");
        }),
      });
    }

    for (const client of data?.clients ?? []) {
      list.push({
        key: `client-${client.id}`,
        group: "Clients",
        icon: IconUsers,
        label: hide(client.name),
        hint: [client.platform, client.handle && hide(client.handle)].filter(Boolean).join(" · "),
        fields: [client.name, client.handle ?? "", client.email ?? "", client.tag_handle ?? ""],
        run: run(() => {
          sessionStorage.setItem("zeeboard-active-client-id", String(client.id));
          onGo("clients");
        }),
      });
    }

    for (const request of data?.requests ?? []) {
      list.push({
        key: `request-${request.id}`,
        group: "Requests",
        icon: IconInbox,
        label: hide(request.name),
        hint: request.template_id ? data?.templates[request.template_id] : undefined,
        fields: [request.name, request.contact ?? "", request.email ?? ""],
        run: go("requests"),
      });
    }

    pages.forEach((page, position) =>
      list.push({ key: `page-${page.id}`, group: "Go to", icon: page.icon, label: t(page.label), hint: `Ctrl+${position + 1}`, fields: [t(page.label), page.label], run: go(page.id) }),
    );

    const action = (key: string, icon: Icon, label: string, hint: string | undefined, fn: () => void) =>
      list.push({ key, group: "Actions", icon, label: t(label), hint, fields: [t(label), label], run: run(fn) });

    action("new-commission", IconPlus, "New commission", "Ctrl+N", () => {
      requestAction("new-commission");
      onGo("commissions");
    });
    action("new-client", IconPlus, "New client", undefined, () => {
      requestAction("new-client");
      onGo("clients");
    });
    action("private", IconEyeOff, "Toggle private mode", "Ctrl+Shift+P", () => setPrivate(!isPrivate()));
    action("language", IconLanguage, "Switch language", getLanguage() === "es" ? "English" : "Español", () => setLanguage(getLanguage() === "es" ? "en" : "es"));
    action("theme", IconMoon, dark ? "Switch to light theme" : "Switch to dark theme", undefined, () => applyTheme(dark ? "light" : "dark"));
    action("backup", IconDeviceFloppy, "Back up now", undefined, () => {
      runAutoBackup(true)
        .then((path) => showToast(t("Backup saved to: {path}", { path: path ?? "" }), "success"))
        .catch((error) => showToast(t("Could not back up: {error}", { error: String(error) }), "error"));
    });
    action("shortcuts", IconKeyboard, "Keyboard shortcuts", "?", onShowShortcuts);

    return list;
  }, [data, pages, onGo, onClose, onShowShortcuts, showToast]);

  const results = useMemo(() => {
    const groupLimit: Record<string, number> = { Commissions: 6, Clients: 5, Requests: 5, "Go to": 8, Actions: 8 };
    const order = ["Commissions", "Clients", "Requests", "Go to", "Actions"];
    const text = query.trim();

    return order.flatMap((group) => {
      if (!text && ["Commissions", "Clients", "Requests"].includes(group)) {
        return [];
      }

      return search(text, entries.filter((entry) => entry.group === group), (entry) => entry.fields, groupLimit[group]);
    });
  }, [entries, query]);

  const active = Math.min(index, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((current) => Math.min(Math.max(current + (event.key === "ArrowDown" ? 1 : -1), 0), results.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      results[active]?.run();
    } else if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[14vh] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden glass-heavy rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <IconSearch size={18} stroke={1.75} className="text-faint" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("Search commissions, clients, screens and actions…")}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
          <kbd className="rounded-sm border border-line-strong px-1.5 text-xs font-semibold text-faint">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && <p className="px-4 py-6 text-center text-sm text-faint">{data ? t("No results") : t("Loading…")}</p>}

          {results.map((entry, position) => (
            <div key={entry.key}>
              {(position === 0 || results[position - 1].group !== entry.group) && (
                <p className="px-4 pb-1 pt-3 text-xs font-bold text-muted">{t(entry.group)}</p>
              )}
              <button
                type="button"
                data-active={position === active}
                onMouseMove={() => setIndex(position)}
                onClick={entry.run}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${position === active ? "bg-highlight" : ""}`}
              >
                <entry.icon size={17} stroke={1.75} className="shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-semibold">{entry.label}</span>
                {entry.hint && <span className="shrink-0 truncate text-xs text-faint">{entry.hint}</span>}
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-4 border-t border-line bg-paper px-4 py-2 text-xs text-faint">
          <span>{t("↑ ↓ to move")}</span>
          <span>{t("Enter to open")}</span>
          <span>{t("Esc to close")}</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
