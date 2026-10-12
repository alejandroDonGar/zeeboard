import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";

// Heavy processing (decode, downscale, compress to WebP) runs in Rust: src-tauri/src/images.rs

export type StoredImage = {
  /** Path relative to the data folder, e.g. `images/ab12….webp` */
  path: string;
  thumbPath: string;
  width: number;
  height: number;
  bytes: number;
  reused: boolean;
};

export type StorageStats = {
  imageCount: number;
  imagesBytes: number;
  thumbsBytes: number;
  databaseBytes: number;
};

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"];

// Filled once at startup (initImageUrls) so URLs can be built without await
let dataDir = "";

export async function initImageUrls(): Promise<void> {
  dataDir = await appDataDir();
}

/** New images keep their thumbnail in `images/thumbs/` with the same name. */
export function getThumbPath(path: string): string {
  return isProcessedImage(path) ? path.replace("images/", "images/thumbs/") : path;
}

/** `true` if the image already went through the new processing (WebP named by content). */
export function isProcessedImage(path: string): boolean {
  return /^images\/[0-9a-f]{24}\.webp$/.test(path);
}

function toAssetUrl(path: string): string {
  if (!path || path.startsWith("data:")) {
    return path;
  }

  const separator = dataDir.includes("\\") ? "\\" : "/";
  return convertFileSrc(`${dataDir}${separator}${path.replace(/\//g, separator)}`);
}

/** Large version for viewing (zoom, main carousel). */
export function imageUrl(path: string): string {
  return toAssetUrl(path);
}

/** Thumbnail for cards, lists and grids. */
export function thumbUrl(path: string): string {
  return toAssetUrl(getThumbPath(path));
}

/** A client's photo: our own file → its thumbnail; an old address (Bluesky) → as is. */
export function avatarSrc(avatar: string): string {
  return isProcessedImage(avatar) ? thumbUrl(avatar) : avatar;
}

async function importImageFromPath(path: string): Promise<StoredImage> {
  return await invoke<StoredImage>("import_image_from_path", { path });
}

/** Disk path (picker, drag) or in-memory file (Ctrl+V). */
export async function importImage(source: string | Blob): Promise<StoredImage> {
  return typeof source === "string"
    ? await importImageFromPath(source)
    : await importImageFromFile(source);
}

/** For images pasted with Ctrl+V: bytes travel as binary, no base64. */
export async function importImageFromFile(file: Blob): Promise<StoredImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return await invoke<StoredImage>("import_image_from_bytes", bytes);
}

export async function importImageFromDataDir(relativePath: string): Promise<StoredImage> {
  return await importImageFromPath(await join(dataDir, relativePath));
}

/** Opens the system file picker; returns the chosen paths. */
export async function pickImagePaths(): Promise<string[]> {
  const selection = await open({
    multiple: true,
    title: "Choose images",
    filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  });

  if (!selection) {
    return [];
  }

  return Array.isArray(selection) ? selection : [selection];
}

export async function deleteImageFiles(paths: string[]): Promise<void> {
  const processed = paths.filter(isProcessedImage);

  if (processed.length > 0) {
    await invoke("delete_image_files", {
      paths: processed.flatMap((path) => [path, getThumbPath(path)]),
    });
  }
}

/** Deletes everything in `images/` and `images/thumbs/` that isn't in `usedPaths`. */
export async function cleanUpOrphanedImages(usedPaths: string[]): Promise<{ deletedCount: number }> {
  const keep = usedPaths.flatMap((path) => [path, getThumbPath(path)]);
  const deletedCount = await invoke<number>("cleanup_orphan_images", { usedPaths: keep });

  return { deletedCount };
}

export async function getStorageStats(): Promise<StorageStats> {
  return await invoke<StorageStats>("storage_stats");
}
