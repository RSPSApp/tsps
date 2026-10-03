import assert from "node:assert/strict";

import { parseOsrsMarkup } from "../widgets/components/TextRenderer";

// <gt> and <lt> are OSRS's escapes for > and <. The right-click menu draws an entry with a
// submenu (an Amulet of glory's Rub) as "Rub </col><gt>": the arrow must show as ">".
const text = (markup: string) => parseOsrsMarkup(markup, 0xffffff).map((segment) => segment.text).join("");

assert.equal(text("<col=ff9040>Rub</col> </col><gt>"), "Rub >");
assert.equal(text("a <lt>b<gt> c"), "a <b> c");
assert.equal(text("<GT>"), ">", "tags are case-insensitive");
assert.equal(text("<nope>"), "<nope>", "an unknown tag still shows as text");

console.log("text-markup-escapes: ok");
