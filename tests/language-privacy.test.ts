// Language and private mode are read once at startup from localStorage: each test loads the module fresh.
import { afterEach, describe, expect, test, vi } from "vitest";

function storage(saved: Record<string, string> = {}, broken = false) {
  const data = { ...saved };
  const fail = () => {
    throw new Error("storage disabled");
  };
  vi.stubGlobal("localStorage", {
    getItem: broken ? fail : (key: string) => data[key] ?? null,
    setItem: broken ? fail : (key: string, value: string) => void (data[key] = value),
  });
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("language", () => {
  test("Spanish when it was chosen; English otherwise or without storage", async () => {
    storage({ "zeeboard-language": "es" });
    expect((await import("../src/lib/i18n")).t("Save")).toBe("Guardar");

    vi.resetModules();
    storage({}, true);
    const english = await import("../src/lib/i18n");
    expect(english.getLanguage()).toBe("en");
    expect(english.t("Save")).toBe("Save");
  });

  test("a missing placeholder is left as written", async () => {
    storage();
    expect((await import("../src/lib/i18n")).t("{n} days left", {})).toBe("{n} days left");
  });

  test("changing it is saved and the app reloads; without storage nothing happens", async () => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    const saved = storage();
    (await import("../src/lib/i18n")).setLanguage("es");
    expect(saved["zeeboard-language"]).toBe("es");
    expect(reload).toHaveBeenCalledOnce();

    vi.resetModules();
    storage({}, true);
    (await import("../src/lib/i18n")).setLanguage("es");
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("private mode", () => {
  test("it is remembered, marked on the page for the CSS blur, and hides money", async () => {
    const page = { documentElement: { dataset: {} as Record<string, string> } };
    vi.stubGlobal("document", page);
    const saved = storage({ "zeeboard-private-mode": "1" });

    const privacy = await import("../src/lib/privacy");
    const { formatMoney } = await import("../src/lib/commissionHelpers");
    expect(privacy.isPrivate()).toBe(true);
    expect(page.documentElement.dataset.private).toBe("on");
    expect(formatMoney(200, "EUR")).toBe("•••");

    privacy.setPrivate(false);
    expect(saved["zeeboard-private-mode"]).toBe("0");
    expect(page.documentElement.dataset.private).toBe("off");
  });

  test("without storage it starts off and still works for the session", async () => {
    storage({}, true);
    const privacy = await import("../src/lib/privacy");
    expect(privacy.isPrivate()).toBe(false);
    privacy.setPrivate(true);
    expect(privacy.isPrivate()).toBe(true);
  });
});
