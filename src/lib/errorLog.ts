// The last errors, kept on this computer so that "it didn't save" leaves a trace to copy and send.
// Collects console.error (every catch in the app ends there), uncaught errors and rejected promises.

const KEY = "zeeboard-error-log";
const KEEP = 50;

type Entry = { at: string; message: string };

function read(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function add(parts: unknown[]) {
  const message = parts
    // An Error's stack already starts with its message (and the app's engine always fills it)
    .map((part) => (part instanceof Error ? String(part.stack) : typeof part === "string" ? part : JSON.stringify(part)))
    .join(" ")
    .slice(0, 1000);

  try {
    localStorage.setItem(KEY, JSON.stringify([...read(), { at: new Date().toISOString(), message }].slice(-KEEP)));
  } catch {
    // Without storage there is no log: the app keeps working
  }
}

/** Starts collecting. Called once at start-up. */
export function installErrorLog(): void {
  const original = console.error.bind(console);
  console.error = (...parts: unknown[]) => {
    add(parts);
    original(...parts);
  };
  window.addEventListener("error", (event) => add([event.error ?? event.message]));
  window.addEventListener("unhandledrejection", (event) => add(["Unhandled:", event.reason]));
}

/** Plain text to paste in a message: newest last. Empty when nothing went wrong. */
export function errorReport(): string {
  return read().map((entry) => `[${entry.at}] ${entry.message}`).join("\n\n");
}

export function clearErrorLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear without storage
  }
}
