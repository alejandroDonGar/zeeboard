// Quick check of the form import: npx tsx scripts/check-form-import.ts
// All users and emails here are made up.
import assert from "node:assert";
import { splitLinks } from "../src/lib/links";
import { parseTagAccount } from "../src/lib/formImport";
import { autoTagIds, matchTemplate, newResponses, normalizeHandle, parseContact, parseCsv, parseResponses, parseTimestamp } from "../src/lib/formImport";

// Google CSV: quotes, escaped quotes and line breaks inside a cell
assert.deepStrictEqual(parseCsv('"a","b ""x"" c","line\n2"\n"d","e","f"\n'), [
  ["a", 'b "x" c', "line\n2"],
  ["d", "e", "f"],
]);
assert.deepStrictEqual(parseCsv("﻿a;b\r\nc;d"), [["a", "b"], ["c", "d"]]); // Spanish Excel: ; and BOM

// Dates: Google's Spanish one (year first and "p. m."), day first, ISO
const local = (iso: string | null) => (iso ? new Date(iso).getHours() * 100 + new Date(iso).getMinutes() : null);
assert.strictEqual(local(parseTimestamp("2026/10/04 4:59:22 p. m. CET")), 1659);
assert.strictEqual(local(parseTimestamp("2026/10/04 12:05:00 a. m. CET")), 5); // 12 a. m. = 00:05
assert.strictEqual(local(parseTimestamp("2026/10/04 12:05:00 p. m. CET")), 1205);
assert.strictEqual(local(parseTimestamp("04/10/2026 16:59:22")), 1659);
assert.strictEqual(new Date(parseTimestamp("04/10/2026 16:59:22")!).getMonth(), 9); // 4 October, not 10 April
assert.strictEqual(local(parseTimestamp("2026-10-04 16:59")), 1659);
assert.strictEqual(parseTimestamp("ayer"), null);

// Contacts as people write them
const cases: [string, { platform: string; handle: string }][] = [
  ["Telegram @fox_demo", { platform: "Telegram", handle: "@fox_demo" }],
  ["bsky -> @demo.bsky.social", { platform: "Bluesky", handle: "@demo.bsky.social" }],
  ["twitter -> demohandle", { platform: "Twitter / X", handle: "@demohandle" }],
  ["Twitter - @demo_two", { platform: "Twitter / X", handle: "@demo_two" }],
  ["x: demo3", { platform: "Twitter / X", handle: "@demo3" }],
  ["discord: demo#1234", { platform: "Discord", handle: "demo#1234" }],
  ["mail me at demo@example.com", { platform: "Email", handle: "demo@example.com" }],
  ["@onlyhandle", { platform: "Other", handle: "@onlyhandle" }],
  ["tg_fan", { platform: "Other", handle: "tg_fan" }], // "tg_fan" isn't the word "tg"
  ["???", { platform: "Other", handle: "???" }],
];
for (const [text, expected] of cases) {
  assert.deepStrictEqual(parseContact(text), expected, text);
}
assert.strictEqual(normalizeHandle("@Fox_Demo"), normalizeHandle("fox_demo"));

// Types: "Render" matches "Rendered", and case doesn't matter
const templates = [
  { id: 1, name: "Rendered Full Body + Simple Background" },
  { id: 2, name: "Reference Sheet" },
  { id: 3, name: "Full Colour" },
];
assert.strictEqual(matchTemplate("Render Full Body + Simple Background", templates)?.id, 1);
assert.strictEqual(matchTemplate("Reference sheet", templates)?.id, 2);
assert.strictEqual(matchTemplate("Something new", templates), null);

// A full CSV in the form's real format (email column optional)
const header =
  '"Marca temporal","Which type of commission are you interested in?","Type your preferred method of communication and your handle on that site (Twitter - Telegram)"';
const withoutEmail = parseResponses(`${header}\n"2026/10/04 4:59:22 p. m. CET","Render Full Body + Simple Background","Telegram @fox_demo"\n`, templates);
assert.strictEqual(withoutEmail.error, null);
assert.strictEqual(withoutEmail.requests.length, 1);
assert.deepStrictEqual(
  [withoutEmail.requests[0].name, withoutEmail.requests[0].platform, withoutEmail.requests[0].contact, withoutEmail.requests[0].template_id, withoutEmail.requests[0].email],
  ["fox_demo", "Telegram", "@fox_demo", 1, null],
);

const withEmail = parseResponses(
  `${header},"Email for the PayPal invoice"\n"2026/10/05 9:00:00 a. m. CET","Something new","twitter -> demohandle","demo@example.com"\n"2026/10/05 9:10:00 a. m. CET","Full Colour","",""\n`,
  templates,
);
assert.strictEqual(withEmail.requests.length, 1, "una fila sin contacto no es una solicitud");
assert.deepStrictEqual(
  [withEmail.requests[0].email, withEmail.requests[0].template_id, withEmail.requests[0].details],
  ["demo@example.com", null, "Type in the form: Something new"],
);
assert.notStrictEqual(withEmail.requests[0].externalId, withoutEmail.requests[0].externalId);

// The real title of the email question, and emails that don't look like one
const realEmailTitle = "Type the paypal email you want to use for the invoice.";
const real = parseResponses(
  `${header},"${realEmailTitle}"
"2026/10/06 10:00:00 a. m. CET","Full Colour","bsky -> @demo","Demo.Person@Example.com"
"2026/10/06 10:05:00 a. m. CET","Full Colour","tg demo2","no tengo"
`,
  templates,
);
assert.strictEqual(real.error, null);
assert.deepStrictEqual(
  real.requests.map((request) => [request.contact, request.email, request.details]),
  [["@demo", "demo.person@example.com", null], ["@demo2", null, "Email in the form: no tengo"]],
);

// With the characters question: "3 Characters" -> 3; without it, 1
const charactersTitle = "How many characters is your commission going to have?";
const withCharacters = parseResponses(
  `${header},"${charactersTitle}"
"2026/10/06 10:00:00 a. m. CET","Full Colour","bsky -> @demo","3 Characters"
"2026/10/06 10:05:00 a. m. CET","Full Colour","tg demo2","1 Character"
`,
  templates,
);
assert.deepStrictEqual(withCharacters.requests.map((request) => request.characters), [3, 1]);
assert.strictEqual(withoutEmail.requests[0].characters, 1);

// References (links and descriptions) go to the details; their real title contains "Reference"
const referencesTitle = "Reference links and a name the character/s";
const withReferences = parseResponses(
  `${header},"${referencesTitle}"\n"2026/10/06 10:00:00 a. m. CET","Full Colour","bsky -> @demo","https://drive.example.com/folder/abc\nthe blue fox has no name"\n"2026/10/06 10:05:00 a. m. CET","Full Colour","tg demo2",""\n`,
  templates,
);
assert.deepStrictEqual(withReferences.requests.map((request) => request.details), [
  "References: https://drive.example.com/folder/abc\nthe blue fox has no name",
  null,
]);

// Links in references: with or without https://, without swallowing the final period and with no false positives
const links = (text: string) => splitLinks(text).filter((part) => part.href).map((part) => part.href);
assert.deepStrictEqual(links("see https://drive.google.com/x/y. thanks"), ["https://drive.google.com/x/y"]);
assert.deepStrictEqual(links("toyhou.se/123 and Dropbox.com/s/abc?dl=0, ok"), ["https://toyhou.se/123", "https://Dropbox.com/s/abc?dl=0"]);
assert.deepStrictEqual(links("www.example.com/a and (https://imgur.com/z)"), ["https://www.example.com/a", "https://imgur.com/z"]);
assert.deepStrictEqual(links("x.com/someone"), ["https://x.com/someone"]);
assert.deepStrictEqual(links("notdropbox.com/x, e.g. foto.png, name@x.com/y, box.com/z"), []);
assert.strictEqual(splitLinks("a toyhou.se/1 b").map((part) => part.text).join(""), "a toyhou.se/1 b"); // the text isn't lost

// Account to tag when posting
const telegram = { platform: "Telegram", handle: "@contact_demo" };
assert.deepStrictEqual(parseTagAccount("Twitter @name_demo", telegram), { platform: "Twitter / X", handle: "@name_demo" });
assert.deepStrictEqual(parseTagAccount("bsky -> demo.bsky.social", telegram), { platform: "Bluesky", handle: "@demo.bsky.social" });
assert.deepStrictEqual(parseTagAccount("same", telegram), telegram);
assert.strictEqual(parseTagAccount("same", { platform: "Other", handle: "x" }), null); // no network to copy from
for (const text of ["none", "None", "no", "don't tag me", "N/A", "", "-"]) {
  assert.strictEqual(parseTagAccount(text, telegram), null, text);
}
assert.strictEqual(parseTagAccount("demo@example.com", telegram), null); // an email isn't tagged

const tagTitle = "Which account should I tag when I post your commission?";
const withTag = parseResponses(
  `${header},"${tagTitle}"
"2026/10/06 10:00:00 a. m. CET","Full Colour","tg @contact_demo","Bluesky @name_demo"
"2026/10/06 10:05:00 a. m. CET","Full Colour","tg @other_demo","none"
"2026/10/06 10:10:00 a. m. CET","Full Colour","tg @third_demo","same"
`,
  templates,
);
assert.deepStrictEqual(
  withTag.requests.map((request) => [request.contact, request.tag_platform, request.tag_handle]),
  [["@contact_demo", "Bluesky", "@name_demo"], ["@other_demo", null, null], ["@third_demo", "Telegram", "@third_demo"]],
);
// The contact's title, which also mentions "handle", isn't confused with the tag's
assert.strictEqual(withoutEmail.requests[0].tag_handle, null);

// A file that isn't the form
assert.ok(parseResponses('"a","b"\n"1","2"', templates).error);
assert.ok(parseResponses("", templates).error);

// Automatic tags with the user's real ones
const tag = (id: number, name: string, category: string) => ({ id, name, category });
const tags = [
  tag(29, "Render + Complex Background", "Commission Type"), tag(30, "Render + Simple Background | Full Body", "Commission Type"),
  tag(31, "Render + Simple Background | Half Body", "Commission Type"), tag(32, "Full Colour", "Commission Type"),
  tag(34, "Sketch + Background", "Commission Type"), tag(35, "Sketch", "Commission Type"),
  tag(40, "3 Characters", "Characters"), tag(41, "2 Characters", "Characters"), tag(43, "1 Characters", "Characters"),
  tag(50, "Sketch Characters", "General"),
];
// Only the character tag: the type is the template now (lib/catalog.ts)
assert.deepStrictEqual(autoTagIds(3, tags), [40]);
assert.deepStrictEqual(autoTagIds(1, tags), [43]);
assert.deepStrictEqual(autoTagIds(9, tags), []); // no tag for 9: nothing

console.log("form import ok");

// Responses to save: new ones only. One removed from the list earlier (its id is still "known") must not come back,
// and a response repeated inside the file is saved once.
const responses = [{ externalId: "a" }, { externalId: "b" }, { externalId: "c" }, { externalId: "c" }];
assert.deepStrictEqual(newResponses(responses, new Set(["a"])), [{ externalId: "b" }, { externalId: "c" }]);
assert.deepStrictEqual(newResponses(responses, new Set(["a", "b", "c", null])), []);
assert.deepStrictEqual(newResponses([], new Set()), []);
console.log("responses to save ok");
