import assert from "node:assert/strict";

import { tips } from "../../server/plugins/interface/data/login-tips.json";
import { hasOsrsMarkup, parseOsrsMarkup } from "../widgets/components/TextRenderer";

// <gt> and <lt> are OSRS's escapes for > and <. The right-click menu draws an entry with a
// submenu (an Amulet of glory's Rub) as "Rub </col><gt>": the arrow must show as ">".
const text = (markup: string) => parseOsrsMarkup(markup, 0xffffff).map((segment) => segment.text).join("");

assert.equal(text("<col=ff9040>Rub</col> </col><gt>"), "Rub >");
assert.equal(text("a <lt>b<gt> c"), "a <b> c");
assert.equal(text("<GT>"), ">", "tags are case-insensitive");
assert.equal(text("<nope>"), "<nope>", "an unknown tag still shows as text");

// A "<" that is never closed hides everything after it, as the OSRS client does. Live's sailing
// navigator login tip ends in a cut-off "</col" (issue 6808), so the chat line ends at "them.".
assert.equal(text("abc <col"), "abc ");
assert.equal(text("<col=ff0000>abc</col"), "abc");
const navigatorTip = tips.find((tip) => tip.endsWith("</col"));
assert.ok(navigatorTip, "the cut-off navigator tip is still in the login tips");
assert.equal(text(navigatorTip), navigatorTip.slice(0, -"</col".length));
assert.ok(text(navigatorTip).endsWith("your Captain's log on them."));
// The chatbox wraps the line in its colour, so the cut-off tag sits before a real "</col>": a tag
// starts at the last "<" before its ">", and the earlier one hides what follows it.
assert.equal(text(`<col=0000ff>${navigatorTip}</col>`), text(navigatorTip));
assert.equal(text("a<b<col=ff0000>c</col>"), "ac");
// The tip has no other tag, so drawing must still send it through the parser.
assert.ok(hasOsrsMarkup(navigatorTip));
assert.ok(!hasOsrsMarkup("plain text"));

console.log("text-markup-escapes: ok");
