// The colour tokens in App.css, checked with the WCAG formula: text that can be read, fields that can be seen.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { contrastRatio } from "../src/lib/ambient";

const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

/** Every #rrggbb custom property set in the blocks that start with this selector (later blocks win). */
function tokens(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (let start = css.indexOf(`${selector} {`); start !== -1; start = css.indexOf(`${selector} {`, start + 1)) {
    const block = css.slice(start, css.indexOf("}", start));
    for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) found[name] = value.toLowerCase();
  }
  return found;
}

const themes = {
  light: tokens(":root"),
  dark: tokens(':root[data-theme="dark"]'),
};

test("dark by Windows setting and dark chosen in Settings use the same colours", () => {
  expect(tokens(':root:not([data-theme="light"])')).toEqual(themes.dark);
});

describe.each(Object.entries(themes))("%s theme", (_, theme) => {
  test("every text colour reads at 4.5:1 or more on every background it sits on (WCAG 1.4.3)", () => {
    for (const text of ["ink", "muted", "faint"]) {
      for (const background of ["surface", "canvas", "highlight", "paper"]) {
        expect(contrastRatio(theme[text], theme[background]), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("secondary and tertiary text are two greys you can tell apart (1.5:1 between them)", () => {
    expect(contrastRatio(theme.muted, theme.faint)).toBeGreaterThanOrEqual(1.5);
  });

  test("field borders show where a field is: 3:1 on the backgrounds fields sit on (WCAG 1.4.11)", () => {
    for (const background of ["surface", "paper"]) {
      expect(contrastRatio(theme["field-border"], theme[background]), background).toBeGreaterThanOrEqual(3);
    }
  });
});
