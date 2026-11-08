#!/usr/bin/env node
// Regenerates plugins/interface/data/level-up-messages.json from the OSRS Wiki.
//
//   node scripts/dump-level-up-messages.cjs           # write the data file
//   node scripts/dump-level-up-messages.cjs --check   # fail if the committed file is stale
//
// The level-up box's text is server-side, so it isn't in the cache: the only source is
// the "Level up messages" section of each `Transcript:<Skill>` page, read as raw wikitext.
// Requires network access; the output carries no timestamp, so the same page content
// produces byte-identical output and --check can compare against the committed file.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SKILLS = ["Attack", "Strength", "Defence", "Ranged", "Prayer", "Magic", "Runecrafting",
  "Hitpoints", "Crafting", "Mining", "Smithing", "Fishing", "Cooking", "Firemaking", "Woodcutting",
  "Agility", "Herblore", "Thieving", "Fletching", "Slayer", "Farming", "Construction", "Hunter", "Sailing"];
const DEST = path.join(__dirname, "..", "plugins", "interface", "data", "level-up-messages.json");
const SOURCE_NOTE = "OSRS Wiki, the 'Level up messages' section of each Transcript:<Skill> page, read "
  + "as raw wikitext by scripts/dump-level-up-messages.cjs. Each level maps to the message(s) the "
  + "game sends on reaching it, in wiki order; a nested entry carries a 'when' condition built from "
  + "the transcript's own qualifier, because those levels show a different message per player state. "
  + "Magic merges its four spellbook sections, Sailing's beta section is commented out on the wiki "
  + "and is skipped, and a level the wiki marks only with {{tmissing}} has no message. "
  + "Messages are verbatim, including their 'Members ...' clause, which OSRS words inline rather "
  + "than splitting by world type.";
const SKILL_NAMES = { attack: "Attack", strength: "Strength", defence: "Defence", defense: "Defence",
  ranged: "Ranged", prayer: "Prayer", magic: "Magic", runecraft: "Runecrafting",
  runecrafting: "Runecrafting", hitpoints: "Hitpoints", crafting: "Crafting", mining: "Mining",
  smithing: "Smithing", fishing: "Fishing", cooking: "Cooking", firemaking: "Firemaking",
  woodcutting: "Woodcutting", agility: "Agility", herblore: "Herblore", thieving: "Thieving",
  fletching: "Fletching", slayer: "Slayer", farming: "Farming", construction: "Construction",
  hunter: "Hunter", sailing: "Sailing" };

/** Split on `|` at template depth 0. */
function splitTop(text) {
  const out = [];
  let buf = "", depth = 0, i = 0;
  while (i < text.length) {
    if (text.slice(i, i + 2) === "{{") { depth++; buf += "{{"; i += 2; continue; }
    if (text.slice(i, i + 2) === "}}") { depth--; buf += "}}"; i += 2; continue; }
    if (text[i] === "|" && depth === 0) { out.push(buf); buf = ""; i++; continue; }
    buf += text[i]; i++;
  }
  out.push(buf);
  return out;
}

/** Every `{{name|...}}` body in `text`, matched case-insensitively and brace-aware. */
function templates(text, names) {
  const wanted = names.map((name) => "{{" + name + "|");
  const found = [];
  let i = 0;
  while (i < text.length) {
    if (text.slice(i, i + 2) !== "{{") { i++; continue; }
    const open = text.slice(i, i + 64).toLowerCase();
    const name = wanted.find((candidate) => open.startsWith(candidate.toLowerCase()));
    if (!name) { i++; continue; }
    let depth = 1, k = i + 2;
    while (k < text.length && depth > 0) {
      if (text.slice(k, k + 2) === "{{") { depth++; k += 2; continue; }
      if (text.slice(k, k + 2) === "}}") { depth--; k += 2; continue; }
      k++;
    }
    const body = text.slice(i + 2 + name.length - 2, k - 2);
    found.push({ body, start: i, end: k });
    i = k;
  }
  return found;
}

/** Strip the wiki's own annotations and colour spans until nothing nested is left. */
function clean(text) {
  let out = text;
  for (let pass = 0; pass < 12; pass++) {
    const before = out;
    // {{sic}} / {{sic|reason}} are editorial notes about the game's own text, never shown.
    out = out.replace(/\{\{sic(\|[^{}]*)?\}\}/gi, "");
    // {{tact|end}} and friends are transcript actions, not lines.
    out = out.replace(/\{\{tact(\|[^{}]*)?\}\}/gi, "");
    out = out.replace(/\{\{tmissing(\|[^{}]*)?\}\}/gi, "");
    // {{Colour|#000080|Rune Armour}} — the wiki spells it Colour, Color and color.
    out = out.replace(/\{\{colou?r\|[^|{}]*\|([^{}]*)\}\}/gi, "$1");
    if (out === before) break;
  }
  // A message that is itself a tbox (Cooking 83, Woodcutting 29, Sailing 79-80): keep its text
  // parameters and drop the picture ones. Unwrapped from the last one so the spans stay valid.
  for (const { body, start, end } of templates(out, ["tbox"]).reverse()) {
    const parts = splitTop(body).filter((part) => !/^\s*(pic2?|align|float)\s*=/i.test(part));
    out = out.slice(0, start) + clean(parts.join("|")) + out.slice(end);
  }
  out = out.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1");
  out = out.replace(/\[\[([^\]]*)\]\]/g, "$1");
  out = out.replace(/'''?/g, "");
  out = out.replace(/<[^>]+>/g, "");
  out = out.replace(/&nbsp;/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

const TERM = /\b(?:level\s+)?(\d+)\s+([A-Za-z]+)\s*$/;
function term(text, lastLevel) {
  let t = text.trim().replace(/:$/, "").trim();
  let neg = false;
  if (/^does not have/i.test(t)) { neg = true; t = t.replace(/^does not have/i, "").trim(); }
  else if (/^doesn't have/i.test(t)) { neg = true; t = t.replace(/^doesn't have/i, "").trim(); }
  else if (/^has not completed/i.test(t)) return { quest: t.replace(/^has not completed/i, "").trim(), not: true };
  else if (/^(has\s+)?completed/i.test(t)) return { quest: t.replace(/^(has\s+)?completed/i, "").trim() };
  t = t.replace(/^(also\s+)?has\s+/i, "").trim();
  const numbered = TERM.exec(t);
  if (numbered) {
    const skill = SKILL_NAMES[numbered[2].toLowerCase()];
    if (skill) return neg ? { not: true, skill, min: Number(numbered[1]) } : { skill, min: Number(numbered[1]) };
  }
  const bare = /^([A-Za-z]+)$/.exec(t);
  if (bare && lastLevel !== null) {
    const skill = SKILL_NAMES[bare[1].toLowerCase()];
    if (skill) return neg ? { not: true, skill, min: lastLevel } : { skill, min: lastLevel };
  }
  return null;
}

/** "If the player does not have 70 Strength, and does not have 70 Magic or ..." -> a predicate. */
function condition(raw) {
  const source = raw.replace(/^if the player\s+/i, "").trim();
  const conjuncts = [];
  let lastLevel = null;
  for (let segment of source.split(",")) {
    // Trim first: "does not have ... , and does not have ..." puts a space before the
    // connector, and `^and` misses it if the replace runs before the trim.
    segment = segment.trim().replace(/^(and|but)\s+/i, "").trim();
    if (!segment) continue;
    if (/\bor\b/i.test(segment)) {
      const alternatives = segment.split(/\bor\b/i).map((part) => term(part, lastLevel)).filter(Boolean);
      if (alternatives.length) conjuncts.push({ any: alternatives });
      continue;
    }
    for (const part of segment.split(/\band\b/i)) {
      const parsed = term(part, lastLevel);
      if (!parsed) continue;
      if (parsed.min !== undefined) lastLevel = parsed.min;
      conjuncts.push(parsed);
    }
  }
  if (conjuncts.length === 0) return null;
  return conjuncts.length === 1 ? conjuncts[0] : { all: conjuncts };
}

function parseSkill(skill, raw) {
  // Commented-out wiki sections (Sailing's beta messages) are not part of the game's text.
  const wikitext = raw.replace(/<!--[\s\S]*?-->/g, "");
  const blocks = wikitext.split(/^==([^=].*?)==\s*$/m);
  let body = "", found = false;
  for (let i = 1; i < blocks.length; i += 2) {
    if (blocks[i].trim().toLowerCase().startsWith("level up messages")) { body += blocks[i + 1]; found = true; }
  }
  if (!found) return {};

  const levels = {};
  const sections = body.split(/^===\s*Level (\d+)\s*===\s*$/m);
  for (let i = 1; i < sections.length; i += 2) {
    const level = sections[i], chunk = sections[i + 1];
    const entries = [];
    let when = null;
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const conditions = templates(trimmed, ["tcond"]);
      if (conditions.length) {
        when = clean(splitTop(conditions[0].body).join("|"));
        continue;
      }
      const boxes = templates(trimmed, ["tbox"]);
      if (boxes.length) {
        for (const { body: box } of boxes) {
          const parts = splitTop(box).filter((part) => !/^\s*(pic2?|align|float)\s*=/i.test(part));
          const text = clean(parts.join("|"));
          if (!text) continue;
          const predicate = when ? condition(when) : null;
          entries.push(predicate ? { text, when: predicate } : text);
        }
        continue;
      }
      // A bare {{tmissing|reason}} bullet is a level with no message at all, and {{tact|end}}
      // is a transcript action; text *followed* by {{tmissing}} is real text the wiki has
      // simply not confirmed, and was kept by the tbox branch above.
      const bullet = /^\*+\s*(.+)$/.exec(trimmed);
      if (!bullet) continue;
      if (bullet[1].trimStart().startsWith("{{")) continue;
      const text = clean(bullet[1]);
      if (text && !/^transcript/i.test(text)) entries.push(when ? { text, when: condition(when) } : text);
    }
    if (entries.length) levels[level] = entries;
  }
  return levels;
}

/**
 * The raw wikitext for a skill. `curl` does the fetching: Node's own TLS stack rejects the
 * wiki's certificate chain on some networks (a TLS-inspecting proxy), while curl trusts it.
 * `--from <dir>` reads `<dir>/<Skill>.txt` instead, for an offline or reproducible dump.
 */
function fetchRaw(skill, fromDir) {
  if (fromDir) return fs.readFileSync(path.join(fromDir, skill + ".txt"), "utf8");
  const url = "https://oldschool.runescape.wiki/index.php?title=Transcript:" + encodeURIComponent(skill) + "&action=raw";
  return execFileSync("curl", ["-sS", "--fail", "-A", "tsps-level-up-dump/1.0 (tsps dev tooling)", url],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

(async () => {
  const fromIndex = process.argv.indexOf("--from");
  const fromDir = fromIndex > 0 ? process.argv[fromIndex + 1] : null;
  const data = { _source: SOURCE_NOTE };
  for (const skill of SKILLS) data[skill] = parseSkill(skill, fetchRaw(skill, fromDir));
  const text = JSON.stringify(data, null, 1) + "\n";

  const messages = SKILLS.reduce((total, skill) =>
    total + Object.values(data[skill]).reduce((n, entries) => n + entries.length, 0), 0);
  const leaked = SKILLS.flatMap((skill) => Object.entries(data[skill]).flatMap(([level, entries]) =>
    entries.filter((entry) => (typeof entry === "string" ? entry : entry.text).includes("{{"))
      .map((entry) => skill + " " + level + ": " + (typeof entry === "string" ? entry : entry.text))));
  console.error("skills: " + SKILLS.length + ", messages: " + messages + ", raw markup left: " + leaked.length);
  for (const line of leaked.slice(0, 10)) console.error("  " + line);

  if (process.argv.includes("--check")) {
    // core.autocrlf gives a Windows checkout CRLF; the generated text is LF.
    const current = (fs.existsSync(DEST) ? fs.readFileSync(DEST, "utf8") : "").replace(/\r\n/g, "\n");
    if (current !== text) { console.error("stale: " + DEST + " differs from a fresh dump"); process.exit(1); }
    console.error("up to date");
    return;
  }
  fs.writeFileSync(DEST, text);
  console.error("wrote " + DEST);
})().catch((error) => { console.error(error.message); process.exit(1); });
