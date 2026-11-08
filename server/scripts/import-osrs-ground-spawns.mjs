#!/usr/bin/env node
/**
 * Import an audited ordinary subset of the osrsreboxed ItemSpawnLine export.
 * Existing definitions are preserved byte-for-field and order; equality is exact
 * item/x/y/plane, never a two-tile equivalence. Raw/conditional rows remain in the report.
 *
 * Infobox Item documents respawn in ticks. For these audited ordinary rows with
 * no tile override, apply the item's explicit infobox value as the spawn's timer.
 * This is an import policy, not automatic inheritance supplied by the Wiki map template.
 * Only separately audited member pages use the existing row-membership loader gate;
 * untyped overrides never become guessed ticks.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SOURCE_PIN = Object.freeze({
  revision: "50574b943b447ed8b9c86eb9813f90960757d61b",
  exportSha256: "251bc25a375029cd746c3fdb8ca21478f87b740473e38dd6828e11595223c924",
  inputSha256: "3c2de222f445a46dc47aecd7c7bd9fb5857932c3ffb5be52322c21c30169bcaa",
});
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
// These pages' F2P rows have been checked as ordinary public ground spawns.
// Access requirements (e.g. telegrab) do not by themselves make a spawn conditional.
const AUDITED_ORDINARY_ITEMS = new Map([
  ["Air rune", 556], ["Body rune", 559], ["Earth rune", 557],
  ["Fire rune", 554], ["Mind rune", 558], ["Nature rune", 561], ["Water rune", 555],
  ["Crossbow", 837], ["Shears", 1735],
]);
// Their three explicit member rows were separately checked as ordinary spawns.
// The seven rune pages above retain their original F2P-only scope.
const AUDITED_MEMBER_ORDINARY_ITEMS = new Map([["Crossbow", 837], ["Shears", 1735]]);
// Only this location-pinned selection was audited; the other Sea shell rows stay held.
const EASTERN_CONCH_SHELL_TILES = new Set([
  "3258:2481", "3257:2477", "3259:2469", "3261:2458", "3260:2451",
  "3256:2449", "3261:2444", "3258:2437", "3262:2435",
]);
function isAuditedEasternConchShell(row) {
  return row.page === "Sea shell" && row.id === 31395 && row.members === true
    && row.location === "[[The Great Conch]] - eastern coast" && row.plane === 0
    && row.quantity === 1 && row.infobox_respawn_ticks === 50
    && EASTERN_CONCH_SHELL_TILES.has(`${row.x}:${row.y}`);
}
const OWNED_EXACT = new Map([
  ["560:2500:2967:0", "Quests.plugin.js Watchtower definition provider"],
  ["2398:2528:9415:0", "Quests.plugin.js Watchtower definition provider"],
  ["2398:2530:9462:0", "Quests.plugin.js Watchtower definition provider"],
  ["532:1475:9498:1", "MeatAndGreet.Quest.js post-Alpha private scene"],
  ["532:1477:9499:1", "MeatAndGreet.Quest.js post-Alpha private scene"],
  ["532:1478:9497:1", "MeatAndGreet.Quest.js post-Alpha private scene"],
  ...[[3110,2430],[3118,2419],[3119,2443],[3102,2415],[3115,2407],[3131,2398]]
    .map(([x,y]) => [String(31393)+":"+x+":"+y+":0", "TroubledTortugans.Quest.js stage-owned materials"]),
  ...[[3161,2389],[3168,2388],[3179,2384],[3190,2379],[3191,2383],[3197,2376]]
    .map(([x,y]) => [String(31395)+":"+x+":"+y+":0", "TroubledTortugans.Quest.js stage-owned materials"]),
  ["401:2962:2600:0", "TroubledTortugans.Quest.js stage-owned seaweed"],
]);
for (const [id, points] of [[5559, [[2969,4999],[2970,5000],[3009,5063],[3009,5070]]], [5568, [[3018,5080],[3018,5086],[3011,5082],[3013,5090]]]]) {
  for (const [x,y] of points) for (const plane of [0,1]) {
    OWNED_EXACT.set([id,x,y,plane].join(":"), "Lobby.RoguesDen.js owns plane1; legacy plane0 must not be duplicated");
  }
}
const keyOf = (id, x, y, z) => [id, x, y, z].join(":");
const rowKey = (r) => keyOf(r.id, r.x, r.y, r.plane);
const definitionKey = (r) => keyOf(r.id, r.location?.x, r.location?.y, r.location?.z);
const ownerOf = (r) => OWNED_EXACT.get(rowKey(r))
  ?? (r.location?.includes("[[Hallowed Sepulchre]]") ? "HallowedSepulchre per-player floor template integration required" : null);

export function importSpawns(source, existing) {
  if (source.schema !== 1 || !Array.isArray(source.rows) || !Array.isArray(existing)) {
    throw new Error("Expected source schema1 and an array of existing definitions");
  }
  const definitions = structuredClone(existing);
  const exact = new Map();
  for (const d of existing) {
    const key = definitionKey(d);
    exact.set(key, [...(exact.get(key) ?? []), d]);
  }
  const eligible = new Map();
  const report = [];
  for (const row of source.rows) {
    const entry = { source: row, status: null, reasons: [...row.unresolved_reasons] };
    const owner = ownerOf(row);
    if (owner) {
      entry.status = "area-owned-or-instance-integration";
      entry.owner = owner;
    } else if (entry.reasons.length) {
      entry.status = "unresolved-source";
    } else if (row.members !== false
      && !(row.members === true && AUDITED_MEMBER_ORDINARY_ITEMS.get(row.page) === row.id)
      && !isAuditedEasternConchShell(row)) {
      entry.status = "members-world-scope-deferred";
    } else if (AUDITED_ORDINARY_ITEMS.get(row.page) !== row.id && !isAuditedEasternConchShell(row)) {
      entry.status = "ordinary-page-not-yet-audited";
    } else if (![row.id,row.x,row.y,row.plane,row.quantity,row.infobox_respawn_ticks].every(Number.isInteger)
      || row.id < 0 || row.plane < 0 || row.plane > 3 || row.quantity <= 0
      || row.infobox_respawn_ticks <= 0 || row.tile_respawn_raw != null) {
      throw new Error("Invalid source-complete row: "+JSON.stringify(row));
    } else {
      const key = rowKey(row);
      eligible.set(key, [...(eligible.get(key) ?? []), entry]);
    }
    report.push(entry);
  }
  for (const [key, entries] of eligible) {
    const states = new Set(entries.map(({ source:r }) => [r.quantity,r.infobox_respawn_ticks,r.members].join(":")));
    if (states.size !== 1) {
      for (const entry of entries) entry.status = "conflicting-source-quantity-timer-or-membership";
      continue;
    }
    const row = entries[0].source;
    const present = exact.get(key);
    if (present?.length) {
      for (const entry of entries) {
        entry.status = present.every(d => (d.amt ?? 1) === row.quantity && d.respawn === row.infobox_respawn_ticks
          && (d.members === true) === row.members)
          ? "existing-exact" : "existing-exact-state-discrepancy";
        entry.existingCount = present.length;
      }
      continue;
    }
    const occupants = existing.filter(d => d.location?.x === row.x && d.location?.y === row.y
      && d.location?.z === row.plane && d.id !== row.id);
    if (occupants.length) {
      for (const entry of entries) {
        entry.status = "possible-replaced-id-review";
        entry.existingOccupants = occupants;
      }
      continue;
    }
    const nearby = existing.filter(d => d.location?.z === row.plane
      && Math.abs(d.location.x-row.x) <= 2 && Math.abs(d.location.y-row.y) <= 2);
    const definition = { id:row.id, location:{x:row.x,y:row.y,z:row.plane},
      amt:row.quantity, respawn:row.infobox_respawn_ticks, ...(row.members === true ? {members:true} : {}), description:"OSRS Wiki: "+row.page+" — "+row.location };
    definitions.push(definition);
    exact.set(key, [definition]);
    entries.forEach((entry,index) => {
      entry.status = index === 0 ? "added" : "duplicate-source-exact";
      if (nearby.length) entry.nearbyPlacementWarnings = nearby;
    });
  }
  const counts = {};
  for (const entry of report) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return { definitions, report: { schema:1, sourceInputSha256:source.input_sha256,
    policy:"Audited ordinary F2P rune/tool, explicit member Crossbow/Shears and nine exact eastern Great Conch Sea shell rows only; explicit infobox ticks applied only without tile override; all legacy entries preserved.",
    counts, rows:report } };
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i=0;i<args.length;i++) {
    if (args[i]==="--check") options.check=true;
    else if (["--source","--existing","--output","--report"].includes(args[i])) options[args[i].slice(2)]=args[++i];
    else throw new Error("Unknown option "+args[i]);
  }
  const sourceFile = options.source ?? path.resolve(repoRoot,"../osrsreboxed-db/docs/ground-item-spawns.json");
  const existingFile = options.existing ?? path.join(repoRoot,"server/data/definitions/ground-items.json");
  const output = options.output ?? existingFile;
  const raw = fs.readFileSync(sourceFile);
  const sourceHash = crypto.createHash("sha256").update(raw).digest("hex");
  const source = JSON.parse(raw);
  if (sourceHash !== SOURCE_PIN.exportSha256 || source.input_sha256 !== SOURCE_PIN.inputSha256) {
    throw new Error("Pinned source export changed; re-audit source conditions and update the explicit pin before importing");
  }
  const result = importSpawns(source,JSON.parse(fs.readFileSync(existingFile,"utf8")));
  result.report.sourceRevision = SOURCE_PIN.revision;
  result.report.sourceExportSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const rendered = "[\n"+result.definitions.map(row => "  "+JSON.stringify(row)).join(",\n")+"\n]\n";
  if (options.check) {
    if (JSON.stringify(JSON.parse(fs.readFileSync(output,"utf8"))) !== JSON.stringify(result.definitions)) {
      throw new Error("Ground definitions need regeneration");
    }
  } else {
    fs.writeFileSync(output, rendered);
  }
  if (options.report) fs.writeFileSync(options.report,JSON.stringify(result.report,null,2)+"\n");
  console.log(JSON.stringify({ definitions:result.definitions.length, counts:result.report.counts }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
