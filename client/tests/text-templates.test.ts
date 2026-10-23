import assert from "node:assert/strict";

import { resolveTextTemplates } from "../rs/font/textTemplates";
import { parseOsrsMarkup } from "../widgets/components/TextRenderer";

// Strings as the 2026-10-20 cache's scripts build them (8807, 4132, 2917, 427).
assert.equal(
    resolveTextTemplates(
        "<str_quest_name_0=Pandemonium>You have not completed <col=ff981f><str_quest_name_0></col>, which is a requirement to build this facility.",
    ),
    "You have not completed <col=ff981f>Pandemonium</col>, which is a requirement to build this facility.",
);
assert.equal(resolveTextTemplates("<str_quest_name_0=Dragon Slayer II>Requires <str_quest_name_0>"), "Requires Dragon Slayer II");
assert.equal(resolveTextTemplates("<str_gauntlet_crystal_0=12> <str_gauntlet_crystal_0> Shards"), " 12 Shards");
assert.equal(
    resolveTextTemplates("<str_slayer_0=Cave horrors><u=ff981f><str_slayer_0></u><br><br>Slayer Masters will once again"),
    "<u=ff981f>Cave horrors</u><br><br>Slayer Masters will once again",
);

// Several values, a value holding tags, references before and without a definition.
assert.equal(resolveTextTemplates("<str_a=1><str_b=two><str_b> <str_a>"), "two 1");
assert.equal(resolveTextTemplates("<str_name=<col=ff0000>Red</col>>Hi <str_name>!"), "Hi <col=ff0000>Red</col>!");
assert.equal(resolveTextTemplates("<str_x> before <str_x=late>"), "late before ");
assert.equal(resolveTextTemplates("Hello <str_missing>world"), "Hello world");

// Text without templates comes back as it was; <str> is strikethrough, not a template.
const plain = "<col=ffffff>Hello</col> <str>gone</str>";
assert.equal(resolveTextTemplates(plain), plain);
assert.equal(resolveTextTemplates(""), "");

// The widget renderer resolves them before parsing, so neither tag shows as text.
const shown = parseOsrsMarkup("<str_quest_name_0=Cook's Assistant>Quest: <str_quest_name_0>", 0xffffff)
    .map((segment) => segment.text)
    .join("");
assert.equal(shown, "Quest: Cook's Assistant");

console.log("text-templates: ok");
