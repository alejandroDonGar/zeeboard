// @vitest-environment jsdom
// What happens on the page: dialogs and the keyboard, dropping and pasting images, private mode and the ambient background.
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  drop: null as null | ((event: { payload: unknown }) => void),
  stop: vi.fn(),
  ready: Promise.resolve(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (event: { payload: unknown }) => void) => {
      tauri.drop = handler;
      return tauri.ready.then(() => tauri.stop);
    },
  }),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ BaseDirectory: { AppData: 1 }, readFile: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

// jsdom lays nothing out, so nothing would count as visible: a control is visible if it is in the page
Object.defineProperty(HTMLElement.prototype, "offsetParent", { get() { return this.parentNode; } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const press = (key: string, shiftKey = false) => window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, cancelable: true }));

describe("dialogs", () => {
  async function openDialog(onClose?: () => void, buttons = ["One", "Two"]) {
    const { useDialog } = await import("../src/lib/useDialog");
    function Dialog() {
      const ref = useDialog(onClose);
      return createElement("div", { role: "dialog", ref }, ...buttons.map((label) => createElement("button", { key: label }, label)));
    }
    return render(createElement(Dialog));
  }

  test("the focus goes in, Tab stays inside both ways, and comes back where it was on closing", async () => {
    const before = document.body.appendChild(document.createElement("button"));
    before.focus();
    const view = await openDialog(() => {});
    const [one, two] = view.getByRole("dialog").querySelectorAll("button");
    expect(document.activeElement).toBe(one);

    two.focus();
    press("Tab");
    expect(document.activeElement).toBe(one);
    press("Tab", true);
    expect(document.activeElement).toBe(two);
    one.focus();
    press("Tab"); // in the middle: the browser moves on by itself
    expect(document.activeElement).toBe(one);

    view.unmount();
    expect(document.activeElement).toBe(before);
  });

  test("Esc closes only the dialog on top, and does nothing while it can't be closed", async () => {
    const below = vi.fn();
    const top = vi.fn();
    await openDialog(below);
    await openDialog(top);
    press("Escape");
    expect([below.mock.calls.length, top.mock.calls.length]).toEqual([0, 1]);

    cleanup();
    await openDialog(undefined);
    press("Escape"); // saving: no onClose
  });

  test("while the dialog element isn't on the page, the keys do nothing and closing restores nothing", async () => {
    const { bindDialog } = await import("../src/lib/useDialog");
    const close = vi.fn();
    const unbind = bindDialog(null, { current: close });
    press("Escape");
    press("Tab");
    unbind();
    expect(close).not.toHaveBeenCalled();
  });

  test("a dialog without controls takes the focus itself and keeps Tab from leaving", async () => {
    const view = await openDialog(() => {}, []);
    const dialog = view.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
  });
});

describe("dropping and pasting images", () => {
  beforeEach(() => {
    tauri.drop = null;
    tauri.stop.mockClear();
    tauri.ready = Promise.resolve();
    vi.stubGlobal("devicePixelRatio", 2);
    const zone = document.body.appendChild(document.createElement("div"));
    zone.dataset.imageDrop = "stage-10";
    // Tauri gives physical pixels: the zone is under (100, 100) in CSS pixels
    document.elementFromPoint = (x: number, y: number) => (x === 100 && y === 100 ? zone : document.body);
  });
  afterEach(() => (document.body.innerHTML = ""));

  async function useInput() {
    const { useImageInput } = await import("../src/lib/useImageInput");
    const onDrop = vi.fn();
    const onPaste = vi.fn();
    const hook = renderHook(() => useImageInput({ onDrop, onPaste }));
    await act(() => tauri.ready);
    const drag = (payload: unknown) => act(() => tauri.drop!({ payload }));
    return { hook, onDrop, onPaste, drag };
  }

  test("dragging over a zone highlights it; leaving clears it", async () => {
    const { hook, drag } = await useInput();
    drag({ type: "over", position: { x: 200, y: 200 } });
    expect(hook.result.current).toBe("stage-10");
    drag({ type: "over", position: { x: 0, y: 0 } });
    expect(hook.result.current).toBeNull();
    drag({ type: "enter", position: { x: 200, y: 200 }, paths: [] });
    drag({ type: "leave" });
    expect(hook.result.current).toBeNull();
  });

  test("dropping on a zone hands over only the images; outside a zone nothing happens", async () => {
    const { hook, onDrop, drag } = await useInput();
    drag({ type: "drop", position: { x: 200, y: 200 }, paths: ["C:\\art\\fox.PNG", "C:\\notes.txt", "C:\\README"] });
    expect(onDrop).toHaveBeenCalledWith("stage-10", ["C:\\art\\fox.PNG"]);
    expect(hook.result.current).toBeNull();

    drag({ type: "drop", position: { x: 0, y: 0 }, paths: ["C:\\art\\fox.png"] });
    drag({ type: "drop", position: { x: 200, y: 200 }, paths: ["C:\\notes.txt"] });
    expect(onDrop).toHaveBeenCalledOnce();
  });

  test("pasting an image hands it over; pasting text does nothing", async () => {
    const { onPaste } = await useInput();
    const paste = (files: File[] | null) => {
      const event = new Event("paste", { cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: files && { files } });
      window.dispatchEvent(event);
      return event;
    };
    const image = new File(["x"], "fox.png", { type: "image/png" });

    expect(paste([image, new File(["x"], "a.txt", { type: "text/plain" })]).defaultPrevented).toBe(true);
    expect(onPaste).toHaveBeenCalledWith([image]);
    expect(paste([new File(["x"], "a.txt", { type: "text/plain" })]).defaultPrevented).toBe(false);
    paste(null);
    expect(onPaste).toHaveBeenCalledOnce();
  });

  test("leaving the screen stops listening, even if Tauri answers after (StrictMode)", async () => {
    const { hook } = await useInput();
    hook.unmount();
    expect(tauri.stop).toHaveBeenCalledOnce();

    let answer = () => {};
    tauri.ready = new Promise((resolve) => (answer = resolve));
    const { useImageInput } = await import("../src/lib/useImageInput");
    const early = renderHook(() => useImageInput({ onDrop: () => {}, onPaste: () => {} }));
    early.unmount();
    await act(async () => answer());
    expect(tauri.stop).toHaveBeenCalledTimes(2);
  });
});

test("private mode repaints whoever is listening, until they stop", async () => {
  const privacy = await import("../src/lib/privacy");
  const hook = renderHook(() => privacy.usePrivacy());
  expect(hook.result.current).toBe(false);
  act(() => privacy.setPrivate(true));
  expect(hook.result.current).toBe(true);
  hook.unmount();
  privacy.setPrivate(false);
});

describe("ambient background", () => {
  // Pixels the "image" has, in RGBA
  const pixels = (...colors: number[][]) => new Uint8ClampedArray(colors.flatMap((color) => [...color, 255]));
  const RED = [220, 40, 40];
  const BLUE = [40, 60, 220];
  const GREEN = [40, 200, 60];

  function fakeCanvas(data: Uint8ClampedArray, context = true) {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", async () => ({ width: data.length / 4, height: 1, close }));
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() {
        return context ? { drawImage: () => {}, getImageData: () => ({ data }) } : null;
      }
    });
    return close;
  }

  async function load() {
    const ambient = await import("../src/lib/ambient");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([1]));
    return { ambient, readFile: vi.mocked(readFile) };
  }

  test("each screen moves the blobs, the same way every time; with reduced motion they stay", async () => {
    const { ambient } = await load();
    const hook = renderHook(() => ambient.useAmbient());
    act(() => ambient.setAmbientPage("Clients"));
    const clients = hook.result.current.layout;
    act(() => ambient.setAmbientPage("Statistics"));
    expect(hook.result.current.layout).not.toEqual(clients);
    act(() => ambient.setAmbientPage("Clients"));
    expect(hook.result.current.layout).toEqual(clients);

    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(ambient.layoutFor("Clients", "images/a.webp")).toEqual([68, 35, 82, 78, 34, 82]);
  });

  test("the background takes the colours of the image on screen, remembers them, and goes neutral on leaving", async () => {
    const { ambient, readFile } = await load();
    const close = fakeCanvas(pixels(RED, RED, BLUE, BLUE, GREEN, GREEN));
    const background = renderHook(() => ambient.useAmbient());
    const screen = renderHook(({ path }) => ambient.useAmbientImage(path), { initialProps: { path: "images/0123456789abcdef01234567.webp" as string | null } });

    await vi.waitFor(() => expect(background.result.current.colors).toHaveLength(3));
    expect(readFile).toHaveBeenCalledWith("images/thumbs/0123456789abcdef01234567.webp", { baseDir: 1 });
    expect(close).toHaveBeenCalled();

    screen.rerender({ path: null });
    await vi.waitFor(() => expect(background.result.current.colors).toBeNull());
    screen.rerender({ path: "images/0123456789abcdef01234567.webp" });
    await vi.waitFor(() => expect(background.result.current.colors).toHaveLength(3));
    expect(readFile).toHaveBeenCalledOnce(); // from memory the second time

    screen.unmount();
    await vi.waitFor(() => expect(background.result.current.colors).toBeNull());
  });

  test("if another image is chosen meanwhile, the slow one doesn't win; unreadable images leave it neutral", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ambient, readFile } = await load();
    fakeCanvas(pixels(RED, RED, RED, RED));
    const background = renderHook(() => ambient.useAmbient());
    let slow = (_bytes: Uint8Array) => {};
    readFile.mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)));

    const screen = renderHook(({ path }) => ambient.useAmbientImage(path), { initialProps: { path: "images/slow.webp" } });
    screen.rerender({ path: "images/fast.webp" });
    await vi.waitFor(() => expect(background.result.current.colors).toHaveLength(3));
    const fast = background.result.current.colors;
    await act(async () => slow(new Uint8Array([1])));
    expect(background.result.current.colors).toEqual(fast);

    readFile.mockRejectedValueOnce(new Error("gone"));
    readFile.mockRejectedValueOnce(new Error("gone"));
    screen.rerender({ path: "images/broken.webp" });
    screen.rerender({ path: "images/broken-too.webp" });
    await vi.waitFor(() => expect(background.result.current.colors).toBeNull());
  });

  test("without a 2D canvas the background stays neutral", async () => {
    const { ambient } = await load();
    fakeCanvas(pixels(RED), false);
    const background = renderHook(() => ambient.useAmbient());
    renderHook(() => ambient.useAmbientImage("images/a.webp"));
    await vi.waitFor(() => expect(background.result.current.colors).toBeNull());
  });

  test("colour picking: greys and see-through pixels don't count; each hue family is found", async () => {
    const { dominantColors, tintStrengths } = await import("../src/lib/ambient");
    const transparent = new Uint8ClampedArray([220, 40, 40, 0]);
    expect(dominantColors(new Uint8ClampedArray([...pixels([128, 128, 128]), ...transparent]))).toBeNull();
    expect(dominantColors(pixels(GREEN, GREEN, GREEN, BLUE, BLUE, BLUE))).toHaveLength(3);
    expect(dominantColors(pixels(...Array(12).fill(null).map((_, i) => [[220, 40, 40], [40, 200, 60], [40, 60, 220], [220, 200, 40]][i % 4])))).toHaveLength(3);
    expect(tintStrengths("#000000").dark).toBeGreaterThanOrEqual(0);
  });
});
