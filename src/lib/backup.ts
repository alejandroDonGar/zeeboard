import { open } from "@tauri-apps/plugin-dialog";
import { appDataDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { appSettings, closeDatabase, getDatabase, updateSettings } from "./database";

const DB_FILE_NAME = "zeeboard.db";

function getTimestampFolderName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return `zeeboard-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Backs up the database and images into a dated folder inside `root`.
 * With `keep`, only the `keep` most recent backups in `root` remain.
 * The database is copied with VACUUM INTO (consistent while the app writes);
 * images and rotation happen in Rust, which doesn't depend on folder-picker permissions.
 */
async function createBackup(root: string, keep?: number): Promise<string> {
  const backupPath = await join(root, getTimestampFolderName());

  await invoke("prepare_backup", { dir: backupPath });

  try {
    const database = await getDatabase();
    await database.execute("VACUUM INTO ?;", [await join(backupPath, DB_FILE_NAME)]);
  } catch (error) {
    // finish_backup deletes the half-made folder when the database is missing
    await invoke("finish_backup", { dir: backupPath, keep: null }).catch(() => {});
    throw error;
  }

  await invoke("finish_backup", { dir: backupPath, keep: keep ?? null });

  return backupPath;
}

export async function exportBackup(): Promise<string | null> {
  const destinationRoot = await pickFolder("Choose a folder to save the backup");

  return destinationRoot ? await createBackup(destinationRoot) : null;
}

/** Automatic backup: the first app open each day, if enabled and a folder is set. */
export async function runAutoBackup(force = false): Promise<string | null> {
  const settings = appSettings();

  if (!settings.auto_backup_folder) {
    if (force) throw new Error("Choose a folder for automatic backups first");
    return null;
  }

  const doneToday =
    settings.last_auto_backup !== null &&
    new Date(settings.last_auto_backup).toDateString() === new Date().toDateString();

  if (!force && (!settings.auto_backup_enabled || doneToday)) {
    return null;
  }

  const path = await createBackup(settings.auto_backup_folder, settings.auto_backup_keep);
  await updateSettings({ last_auto_backup: new Date().toISOString() });

  return path;
}

/** Before deleting unused images: full backup into the app folder (last 2 kept). */
export async function backupBeforeCleanup(): Promise<void> {
  await createBackup(await join(await appDataDir(), "before-cleanup"), 2);
}

export async function pickFolder(title: string): Promise<string | null> {
  const folder = await open({ directory: true, title });
  return !folder || Array.isArray(folder) ? null : folder;
}

/** Asks for the folder of a backup made with "Export backup". */
export function pickBackupFolder(): Promise<string | null> {
  return pickFolder("Choose the backup folder to restore");
}

/**
 * Replaces current data with the backup's and reloads the app.
 * First saves a copy of the current data (in the app folder, "before-restore").
 */
export async function restoreBackup(folder: string): Promise<void> {
  await closeDatabase();

  // If it fails (e.g. the folder isn't a backup) nothing was touched:
  // the error propagates and the database reopens itself on next use
  await invoke<string>("restore_backup", {
    backupDir: folder,
    stamp: getTimestampFolderName().replace("zeeboard-backup-", ""),
  });

  // The app restarts with the restored data (migrations bring it up to date)
  window.location.reload();
}
