// Imports the transport tables of the Shortest Path RuneLite plugin
// (https://github.com/Skretzo/shortest-path, BSD 2-Clause) into
// plugins/agent/data/transports.json, for the agent MCP's travel_to tool: how a player gets
// from one tile to another in live OSRS (doors, stairs, shortcuts, boats ...), with the click
// that does it and what it needs. It is a description of live OSRS kept apart from tsps's own
// data, so a route that works live but not here shows up as a failed leg.
//
//   git clone https://github.com/Skretzo/shortest-path ../shortest-path
//   yarn import:shortest-path --repo ../shortest-path
//
// Use --ref <full commit SHA> to read immutable Git blobs without moving the source checkout.
// The output records the source commit, licence and validated project correction input.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const SERVER = path.resolve(__dirname, "..");
const OUT_FILE = path.join(SERVER, "plugins", "agent", "data", "transports.json");
const REPO_URL = "https://github.com/Skretzo/shortest-path";
const CORRECTIONS = path.join(__dirname, "shortest-path-corrections.json");

// Fixed tile-to-tile routes only. Teleports (spells, items, minigame and house portals) start
// anywhere and are the agent's own choice to cast; seasonal ones are not on the main game.
// Destination networks (fairy rings, spirit trees, gliders, balloons, mushtrees, quetzals,
// obelisks) list no destination per row: the player picks it on an interface.
const FILES = [
  "transports.tsv",
  "agility_shortcuts.tsv",
  "boats.tsv",
  "canoes.tsv",
  "charter_ships.tsv",
  "magic_carpets.tsv",
  "minecarts.tsv",
  "ships.tsv",
  "teleportation_boxes.tsv",
  "teleportation_levers.tsv",
  "teleportation_portals.tsv",
];

// Column name in the TSV header -> field in the output row. Rows are arrays in COLUMNS order,
// grouped by table, with null for an empty cell and trailing empty cells left off.
const FIELDS = {
  Skills: "skills",
  Items: "items",
  Quests: "quests",
  Varbits: "varbits",
  VarPlayers: "varps",
  Duration: "ticks",
  "Display info": "info",
};
const COLUMNS = ["from", "to", "menu", "id", ...Object.values(FIELDS)];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && (!process.argv[index + 1] || process.argv[index + 1].startsWith("--"))) {
    throw new Error(`${flag} needs a value`);
  }
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function tile(text) {
  const parts = String(text ?? "").trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
}

/**
 * "Climb-up Staircase 16671" -> { menu: "Climb-up Staircase", id: 16671 }; a row without the id
 * keeps id null and is found by name. The option/target split is resolved at runtime.
 */
function click(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const match = /^(.*\S)\s+(-?\d+)$/.exec(trimmed);
  return match ? { menu: match[1], id: Number(match[2]) } : { menu: trimmed, id: null };
}

function readTable(text, type, skipped) {
  const lines = text.split(/\r?\n/);
  const header = lines.find((line) => line.startsWith("# Origin"));
  if (!header) throw new Error(`${type} has no "# Origin" header`);
  const columns = header.slice(2).split("\t");
  const rows = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cells = line.split("\t");
    const value = (name) => (cells[columns.indexOf(name)] ?? "").trim();
    const from = tile(value("Origin"));
    const to = tile(value("Destination"));
    const action = click(value("menuOption menuTarget objectID"));
    if (!from || !to || !action) {
      skipped.push(`${type}: ${line}`);
      continue;
    }
    const row = [from, to, action.menu, action.id];
    for (const [column, field] of Object.entries(FIELDS)) {
      const text = value(column);
      row.push(!text ? null : field === "ticks" ? Number(text) : text);
    }
    while (row[row.length - 1] === null) row.pop();
    rows.push(row);
  }
  return rows;
}

/** AXE -> [1351, 1349, ...]: the item groups the Items column names. */
function readItemGroups(text) {
  const groups = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, ids] = line.split("\t");
    groups[name.trim()] = ids.split(",").map(Number).filter(Number.isInteger);
  }
  return groups;
}

function format(data) {
  const { transports, ...head } = data;
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, "");
  const tables = Object.entries(transports).map(([type, rows]) =>
    `    ${JSON.stringify(type)}: [\n${rows.map((row) => `      ${JSON.stringify(row)}`).join(",\n")}\n    ]`);
  return `${top},\n  "transports": {\n${tables.join(",\n")}\n  }\n}\n`;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function applyCorrections(transports, input) {
  if (!exactKeys(input, ["version", "corrections"]) || input.version !== 1
      || !Array.isArray(input.corrections) || !input.corrections.length) {
    throw new Error("Malformed transport correction input");
  }
  const seen = new Set();
  const updates = [];
  const validTile = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isInteger);
  for (const correction of input.corrections) {
    if (correction === null || typeof correction !== "object" || Array.isArray(correction)) {
      throw new Error("Malformed transport correction");
    }
    const duration = Object.hasOwn(correction, "ticks");
    const field = duration ? "ticks" : "quests";
    const expected = duration ? correction.expectedTicks : correction.expectedQuest;
    const replacement = duration ? correction.ticks : correction.quest;
    const keys = duration ? ["expectedTicks", "ticks"] : ["expectedQuest", "quest"];
    if (!exactKeys(correction, ["table", "from", "to", "menu", "id", ...keys])
        || !FILES.includes(`${correction.table}.tsv`)
        || !validTile(correction.from) || !validTile(correction.to)
        || typeof correction.menu !== "string" || !correction.menu.trim()
        || !Number.isInteger(correction.id)
        || (duration
          ? !Number.isInteger(expected) || expected < 1 || !Number.isInteger(replacement) || replacement < 1
          : !(expected === null || (typeof expected === "string" && expected.trim()))
            || typeof replacement !== "string" || !replacement.trim())
        || replacement === expected) {
      throw new Error("Malformed transport correction");
    }
    const selection = JSON.stringify([correction.table, correction.from, correction.to, correction.menu, correction.id]);
    if (seen.has(selection)) throw new Error("Duplicate transport correction");
    seen.add(selection);
    const matches = (transports[correction.table] || []).filter((row) =>
      JSON.stringify(row.slice(0, 4)) === JSON.stringify([correction.from, correction.to, correction.menu, correction.id]));
    if (matches.length !== 1) throw new Error(`Transport correction requires exactly one match; found ${matches.length}`);
    if ((matches[0][COLUMNS.indexOf(field)] ?? null) !== expected) {
      throw new Error(`Stale transport correction: expected ${field} differs`);
    }
    updates.push([matches[0], COLUMNS.indexOf(field), replacement]);
  }
  for (const [row, column, value] of updates) {
    while (row.length <= column) row.push(null);
    row[column] = value;
  }
}

function generate(repo, ref) {
  if (ref !== undefined && !/^[a-f0-9]{40}$/.test(ref)) throw new Error("--ref must be a full immutable commit SHA");
  const commit = execFileSync("git", ["-C", repo, "rev-parse", "--verify", `${ref || "HEAD"}^{commit}`], { encoding: "utf8" }).trim();
  const read = (file) => execFileSync("git", ["-C", repo, "show", `${commit}:${file}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const skipped = [];
  const transports = Object.fromEntries(FILES.map((name) => {
    const type = name.replace(/\.tsv$/, "");
    return [type, readTable(read(`src/main/resources/transports/${name}`), type, skipped)];
  }));
  const correctionText = fs.readFileSync(CORRECTIONS, "utf8").replace(/\r\n?/g, "\n");
  applyCorrections(transports, JSON.parse(correctionText));
  const data = {
    $comment: "Generated by scripts/import-shortest-path.cjs from the Shortest Path RuneLite plugin; regenerate, don't edit.",
    source: { repo: REPO_URL, commit, corrections: {
      file: path.relative(SERVER, CORRECTIONS).split(path.sep).join("/"),
      sha256: createHash("sha256").update(correctionText).digest("hex"),
    } },
    license: read("LICENSE").trim(),
    itemGroups: readItemGroups(read("src/main/resources/item-variations.tsv")),
    columns: COLUMNS,
    transports,
  };
  return { data, skipped };
}

function main() {
  const repo = argValue("--repo");
  if (!repo) throw new Error("Usage: yarn import:shortest-path --repo <shortest-path checkout> [--ref <full commit SHA>]");
  const { data, skipped } = generate(repo, argValue("--ref"));
  const count = Object.values(data.transports).reduce((sum, rows) => sum + rows.length, 0);
  fs.writeFileSync(OUT_FILE, format(data));
  console.log(`${count} transports from ${data.source.commit.slice(0, 9)} -> ${path.relative(SERVER, OUT_FILE)}`);
  if (skipped.length) console.log(`skipped ${skipped.length} rows without a destination or click:\n  ${skipped.join("\n  ")}`);
}

if (require.main === module) main();
module.exports = { applyCorrections, generate, format };
