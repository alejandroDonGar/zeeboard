import { useRef, useState } from "react";
import { clientMessage, DEFAULT_MESSAGES, formatMoney, type MessageKind } from "../lib/commissionHelpers";
import { appSettings, updateSettings, type AppSettings } from "../lib/database";
import { t } from "../lib/i18n";

const panel = "divide-y divide-line rounded-control border border-line bg-surface";
const row = "flex items-center gap-4 px-5 py-4";
const field = "w-48 rounded-control border border-field-border bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-ink";

/** Where each template is used, and the details it can fill in (besides your name and terms link) */
const TEMPLATES: { kind: MessageKind; title: string; where: string; fields: string[] }[] = [
  { kind: "stage", title: "Stage ready", where: "Commission menu ··· → Message: stage ready", fields: ["client", "title", "stage"] },
  { kind: "payment", title: "Payment reminder", where: "Dashboard → Copy reminder, and the commission menu ···", fields: ["client", "title", "remaining"] },
  { kind: "delivery", title: "Delivery", where: "Mark as finished → Copy delivery message, and the commission menu ···", fields: ["client", "title"] },
  { kind: "decline", title: "Decline a request", where: "Requests → Decline (D) copies it", fields: ["client"] },
];

const FIELD_NAMES: Record<string, string> = { client: "Client", title: "Commission", stage: "Stage", remaining: "Amount left", artist: "Your name", tos: "Terms link" };

/** Settings → Messages: your name, your terms link and the text of each message you copy for clients */
function MessageSettings() {
  const [values, setValues] = useState(appSettings());
  const [open, setOpen] = useState<MessageKind | null>(null);
  const boxes = useRef<Partial<Record<MessageKind, HTMLTextAreaElement | null>>>({});

  const keyOf = (kind: MessageKind) => `msg_${kind}` as const;
  const textOf = (kind: MessageKind) => values[keyOf(kind)] ?? t(DEFAULT_MESSAGES[kind]);
  const edit = (changes: Partial<AppSettings>) => setValues((current) => ({ ...current, ...changes }));
  const save = (changes: Partial<AppSettings>) => updateSettings(changes).catch(console.error);
  // Empty goes back to the default; text equal to the default is not kept either (so it follows the app's language)
  const saveText = (kind: MessageKind, text: string) => {
    const own = text.trim() === "" || text === t(DEFAULT_MESSAGES[kind]) ? null : text;
    edit({ [keyOf(kind)]: own });
    save({ [keyOf(kind)]: own });
  };

  // Puts {field} where the cursor is, and leaves the cursor after it
  function insert(kind: MessageKind, name: string) {
    const box = boxes.current[kind];
    const text = textOf(kind);
    const start = box?.selectionStart ?? text.length;
    const token = `{${name}}`;
    saveText(kind, text.slice(0, start) + token + text.slice(box?.selectionEnd ?? start));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const sample = {
    client: "Ana",
    title: "Fox in a scarf",
    stage: "Lineart",
    remaining: formatMoney(45, values.default_currency),
    artist: values.artist_name ?? "",
    tos: values.tos_url ?? "",
  };

  return (
    <>
      <p className="mb-4 text-sm text-muted">{t("Texts to copy and paste to your clients. The words in braces fill themselves in.")}</p>

      <div className={panel}>
        {(
          [
            ["artist_name", "Artist name", "Your signature in the messages: {artist}", "Zee"],
            ["tos_url", "Terms of service", "A link you can include: {tos}", "https://…"],
          ] as const
        ).map(([key, label, hint, placeholder]) => (
          <label key={key} className={row}>
            <span className="flex-1">
              <span className="block font-semibold">{t(label)}</span>
              <span className="block text-sm text-muted">{t(hint)}</span>
            </span>
            <input
              value={values[key] ?? ""}
              placeholder={placeholder}
              onChange={(event) => edit({ [key]: event.target.value })}
              onBlur={(event) => save({ [key]: event.target.value.trim() || null })}
              className={field}
            />
          </label>
        ))}
      </div>

      <h3 className="mt-5 mb-2 text-sm font-semibold text-muted">{t("Templates")}</h3>
      <div className={panel}>
        {TEMPLATES.map(({ kind, title, where, fields }) => (
          <div key={kind}>
            <button
              type="button"
              aria-expanded={open === kind}
              onClick={() => setOpen(open === kind ? null : kind)}
              className="flex w-full items-center gap-4 px-5 py-3.5 text-left"
            >
              <span className="flex-1">
                <span className="block font-semibold">{t(title)}</span>
                <span className="block text-sm text-muted">{t(where)}</span>
              </span>
              {values[keyOf(kind)] !== null && <span className="text-xs text-faint">{t("Edited")}</span>}
              <span aria-hidden="true" className="text-faint">{open === kind ? "▴" : "▾"}</span>
            </button>

            {open === kind && (
              <div className="px-5 pb-4">
                <textarea
                  ref={(box) => {
                    boxes.current[kind] = box;
                  }}
                  aria-label={t(title)}
                  rows={4}
                  value={textOf(kind)}
                  onChange={(event) => edit({ [keyOf(kind)]: event.target.value })}
                  onBlur={(event) => saveText(kind, event.target.value)}
                  className="w-full rounded-control border border-field-border bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted">{t("Insert:")}</span>
                  {[...fields, "artist", "tos"].map((name) => (
                    <button
                      key={name}
                      type="button"
                      // Keeps the cursor in the text, so the field goes where it was
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insert(kind, name)}
                      className="rounded-chip border border-line-strong px-2 py-0.5 hover:border-ink"
                    >
                      {t(FIELD_NAMES[name])}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">{t("Preview")}</p>
                <p className="mt-1 border-l-2 border-line-strong pl-3 text-sm whitespace-pre-wrap">{clientMessage(kind, sample, textOf(kind))}</p>
                {values[keyOf(kind)] !== null && (
                  <button type="button" onClick={() => saveText(kind, "")} className="mt-3 text-xs text-muted underline hover:text-ink">
                    {t("Back to the original text")}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default MessageSettings;
