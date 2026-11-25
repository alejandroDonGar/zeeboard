import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { appSettings, getTemplates, importRequests, updateSettings } from "./database";
import { parseResponses } from "./formImport";

/** Fired when requests change, so the sidebar recounts the new ones. */
export const REQUESTS_CHANGED = "zeeboard-requests-changed";

/**
 * Reads the responses CSV the Google script leaves in your Drive and saves new requests.
 * Returns null if no file is chosen yet. Already imported ones aren't repeated.
 */
export async function syncFormResponses(): Promise<{ added: number; skipped: number } | null> {
  if (!appSettings().responses_file) {
    return null;
  }

  // Only the file chosen in Rust's dialog is read: the path in the settings is shown, never handed over
  const text = await invoke<string | null>("read_remembered_csv");

  if (text === null) {
    // Chosen with a version that didn't remember it in Rust: shown as not connected, to choose it once more
    await updateSettings({ responses_file: null });
    window.dispatchEvent(new Event(REQUESTS_CHANGED));
    return null;
  }
  const { requests, error } = parseResponses(text, await getTemplates());

  if (error) {
    throw new Error(error);
  }

  const result = await importRequests(requests);
  await updateSettings({ last_form_sync: new Date().toISOString() });

  if (result.added > 0) {
    sendNotification({
      title: "ZeeBoard",
      body: `${result.added} new commission ${result.added === 1 ? "request" : "requests"}`,
    });
  }

  // Always: even with nothing new, the "last checked" date changed
  window.dispatchEvent(new Event(REQUESTS_CHANGED));

  return result;
}
