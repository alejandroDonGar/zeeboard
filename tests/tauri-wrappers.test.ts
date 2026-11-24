// The thin layer over Tauri and the browser: what each call asks Rust (or the page) to do, with Tauri simulated.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Each Rust command answers like the real one would
const rust: Record<string, (args: unknown) => unknown> = {};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: unknown) => rust[command]?.(args)),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
const paths = vi.hoisted(() => ({ appData: "C:\\Users\\demo\\AppData\\Roaming\\com.zeeboard.app" }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => paths.appData,
  join: async (...parts: string[]) => parts.join("\\"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { invoke } = await import("@tauri-apps/api/core");
const { open } = await import("@tauri-apps/plugin-dialog");
const images = await import("../src/lib/images");
const { fetchAvatar } = await import("../src/lib/avatars");

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  for (const key of Object.keys(rust)) delete rust[key];
});
afterEach(() => vi.unstubAllGlobals());

const PROCESSED = "images/0123456789abcdef01234567.webp";

describe("image addresses", () => {
  test("processed images use the data folder with Windows separators; the thumbnail lives in thumbs/", async () => {
    await images.initImageUrls();
    expect(images.imageUrl(PROCESSED)).toBe("asset://C:\\Users\\demo\\AppData\\Roaming\\com.zeeboard.app\\images\\0123456789abcdef01234567.webp");
    expect(images.thumbUrl(PROCESSED)).toContain("\\images\\thumbs\\0123456789abcdef01234567.webp");
  });

  test("on macOS or Linux the data folder uses forward slashes", async () => {
    paths.appData = "/Users/demo/Library/Application Support/com.zeeboard.app";
    try {
      await images.initImageUrls();
      expect(images.imageUrl(PROCESSED)).toBe("asset:///Users/demo/Library/Application Support/com.zeeboard.app/images/0123456789abcdef01234567.webp");
    } finally {
      paths.appData = "C:\\Users\\demo\\AppData\\Roaming\\com.zeeboard.app";
      await images.initImageUrls();
    }
  });

  test("old images have no separate thumbnail; empty and inline images are left as they are", () => {
    expect(images.getThumbPath("old/fox.png")).toBe("old/fox.png");
    expect(images.imageUrl("")).toBe("");
    expect(images.imageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  test("a client photo from the web stays a web address; our own file shows its thumbnail", () => {
    expect(images.avatarSrc("https://cdn.bsky.app/fox.jpg")).toBe("https://cdn.bsky.app/fox.jpg");
    expect(images.avatarSrc(PROCESSED)).toContain("thumbs");
  });
});

describe("importing and deleting images", () => {
  const stored = { path: PROCESSED, thumbPath: "", width: 1, height: 1, bytes: 1, reused: false };

  test("a path goes to Rust by path; a pasted image goes as raw bytes", async () => {
    rust.import_image_from_path = () => stored;
    rust.import_image_from_bytes = () => stored;

    expect(await images.importImage("C:\\art\\fox.png")).toEqual(stored);
    expect(invoke).toHaveBeenLastCalledWith("import_image_from_path", { path: "C:\\art\\fox.png" });

    expect(await images.importImage(new Blob([new Uint8Array([1, 2, 3])]))).toEqual(stored);
    expect(invoke).toHaveBeenLastCalledWith("import_image_from_bytes", new Uint8Array([1, 2, 3]));
  });

  test("an old image in the data folder is imported by its full path", async () => {
    rust.import_image_from_path = () => stored;
    await images.initImageUrls();
    await images.importImageFromDataDir("old/fox.png");
    expect(invoke).toHaveBeenLastCalledWith("import_image_from_path", { path: "C:\\Users\\demo\\AppData\\Roaming\\com.zeeboard.app\\old/fox.png" });
  });

  test("the picker returns the chosen paths: none, one or several", async () => {
    vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce("C:\\a.png").mockResolvedValueOnce(["C:\\a.png", "C:\\b.png"]);
    expect(await images.pickImagePaths()).toEqual([]);
    expect(await images.pickImagePaths()).toEqual(["C:\\a.png"]);
    expect(await images.pickImagePaths()).toEqual(["C:\\a.png", "C:\\b.png"]);
  });

  test("deleting removes each processed image with its thumbnail, and never touches old files", async () => {
    await images.deleteImageFiles(["old/fox.png"]);
    expect(invoke).not.toHaveBeenCalled();

    await images.deleteImageFiles([PROCESSED, "old/fox.png"]);
    expect(invoke).toHaveBeenCalledWith("delete_image_files", { paths: [PROCESSED, "images/thumbs/0123456789abcdef01234567.webp"] });
  });

  test("cleaning up keeps every used image and its thumbnail; storage stats come from Rust", async () => {
    rust.cleanup_orphan_images = () => 3;
    rust.storage_stats = () => ({ imageCount: 2, imagesBytes: 10, thumbsBytes: 2, databaseBytes: 5 });

    expect(await images.cleanUpOrphanedImages([PROCESSED])).toEqual({ deletedCount: 3 });
    expect(invoke).toHaveBeenCalledWith("cleanup_orphan_images", { usedPaths: [PROCESSED, "images/thumbs/0123456789abcdef01234567.webp"] });
    expect(await images.getStorageStats()).toMatchObject({ imageCount: 2 });
  });
});

describe("client photos", () => {
  const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
  const web: Record<string, () => ArrayBuffer | number[]> = {};
  beforeEach(() => {
    for (const key of Object.keys(web)) delete web[key];
    rust.fetch_avatar_resource = (args) => {
      const reply = web[(args as { url: string }).url];
      if (!reply) throw new Error("offline");
      return reply();
    };
    rust.import_image_from_bytes = () => ({ path: PROCESSED });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("a Bluesky profile photo is downloaded and saved once", async () => {
    web["https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=fox.bsky.social"] = () => bytes('{"avatar":"https://cdn.bsky.app/fox.jpg"}');
    web["https://cdn.bsky.app/fox.jpg"] = () => new Uint8Array([9, 9]).buffer; // the dev build answers with an ArrayBuffer

    expect(await fetchAvatar([{ platform: "Bluesky", handle: "@fox" }])).toBe(PROCESSED);
    expect(invoke).toHaveBeenLastCalledWith("import_image_from_bytes", new Uint8Array([9, 9]));
  });

  test("a public Telegram photo is found on the t.me page", async () => {
    web["https://t.me/fox_demo"] = () => bytes('<meta property="og:image" content="https://cdn4.cdn-telegram.org/file/fox.jpg">');
    web["https://cdn4.cdn-telegram.org/file/fox.jpg"] = () => [1];

    expect(await fetchAvatar([{ platform: "Telegram", handle: "fox_demo" }])).toBe(PROCESSED);
  });

  test("accounts without a handle, unsupported networks, invalid handles and profiles without a photo give nothing", async () => {
    web["https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=nophoto.bsky.social"] = () => bytes("{}");

    expect(await fetchAvatar([
      { platform: "Bluesky", handle: null },
      { platform: "X", handle: "fox" },
      { platform: "Bluesky", handle: "-bad-" },
      { platform: "Telegram", handle: "abc" },
      { platform: "Bluesky", handle: "nophoto" },
    ])).toBeNull();
  });

  test("if one account fails the next is tried; if all fail, the reasons are given", async () => {
    web["https://t.me/fox_demo"] = () => bytes('<meta property="og:image" content="https://cdn4.cdn-telegram.org/file/fox.jpg">');
    web["https://cdn4.cdn-telegram.org/file/fox.jpg"] = () => [1];

    expect(await fetchAvatar([{ platform: "Bluesky", handle: "fox" }, { platform: "Telegram", handle: "fox_demo" }])).toBe(PROCESSED);
    await expect(fetchAvatar([{ platform: "Bluesky", handle: "fox" }])).rejects.toThrow("Bluesky: Error: offline");
  });
});

describe("browser storage", () => {
  const storage = (broken = false) => {
    const data: Record<string, string> = {};
    const fail = () => {
      throw new Error("storage disabled");
    };
    const api = {
      getItem: broken ? fail : (key: string) => data[key] ?? null,
      setItem: broken ? fail : (key: string, value: string) => void (data[key] = value),
      removeItem: (key: string) => void delete data[key],
    };
    vi.stubGlobal("localStorage", api);
    vi.stubGlobal("sessionStorage", api);
    return data;
  };

  test("a pending action (from the command palette) is taken only once, and only by its screen", async () => {
    storage();
    const { requestAction, takeAction } = await import("../src/lib/actions");
    requestAction("new-client");
    expect(takeAction("new-commission")).toBe(false);
    expect(takeAction("new-client")).toBe(true);
    expect(takeAction("new-client")).toBe(false);
  });

  test("the theme is remembered, applied to the page without transitions, and system clears it", async () => {
    const saved = storage();
    const classes = new Set<string>();
    const root = { dataset: {} as Record<string, string>, classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
    vi.stubGlobal("document", { documentElement: root });
    const frames: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    const { applyTheme, getTheme } = await import("../src/lib/theme");

    expect(getTheme()).toBe("system");
    applyTheme("dark");
    expect([root.dataset.theme, saved["zeeboard-theme"], classes.has("theme-switching")]).toEqual(["dark", "dark", true]);
    while (frames.length) frames.shift()!();
    expect(classes.has("theme-switching")).toBe(false);
    expect(getTheme()).toBe("dark");

    applyTheme("system");
    expect(root.dataset.theme).toBeUndefined();
  });

  test("without storage the theme follows the system and still applies for the session", async () => {
    storage(true);
    const root = { dataset: {} as Record<string, string>, classList: { add: () => {}, remove: () => {} } };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const { applyTheme, getTheme } = await import("../src/lib/theme");

    expect(getTheme()).toBe("system");
    applyTheme("light");
    expect(root.dataset.theme).toBe("light");
  });
});
