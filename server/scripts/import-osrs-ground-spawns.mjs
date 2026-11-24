#!/usr/bin/env node
/**
 * Import the osrsreboxed ItemSpawnLine export into ground-items.json.
 * Every source-clean row is imported unless it is owned by a quest/instance plugin (OWNED_EXACT,
 * OWNED_LOCATIONS) or a same-item legacy spawn sits within two tiles (held for placement review).
 * Legacy definitions keep their fields and order except where the source explicitly identifies
 * a pickup replacement at the same tile. Raw and conditional rows remain in the report.
 *
 * Infobox Item documents respawn in ticks. For rows with no tile override, apply the item's
 * explicit infobox value as the spawn's timer. This is an import policy, not automatic
 * inheritance supplied by the Wiki map template; untyped overrides never become guessed ticks.
 * Members rows use the existing row-membership loader gate.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SOURCE_PIN = Object.freeze({
  repository: "RSPSApp/osrsreboxed-db",
  revision: "6a0d09b19e5698d18f3b1adc594fe3d2a63e92d9",
  exportSha256: "4c5619a145f07a8ca59496c046aac803bcef8c4249d4d842f87795c72eb75546",
  inputSha256: "00d8bcd0ed7d8d0340f69953fb73aa2e51813f03dbbc964b70d9872fe4ad048a",
});
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
// This member quest stock is public; pickup eligibility remains in TempleOfIkov.Quest.js.
// The producer reconciles case-only page aliases and retains their source identities.
const AUDITED_MEMBER_QUEST_ROWS = new Map([
  ["Staff of Armadyl:84:2638:9906:0", "[[Temple of Ikov (dungeon)|Temple of Ikov]]"],
  ["Staff of armadyl:84:2638:9906:0", "[[Temple of Ikov (dungeon)|Temple of Ikov]]"],
]);
function isAuditedMemberQuestRow(row) {
  const location = AUDITED_MEMBER_QUEST_ROWS.get([row.page,row.id,row.x,row.y,row.plane].join(":"));
  return location !== undefined && row.members === true && location === row.location;
}
// Exact previously audited legacy state, not replacement output. Values to import
// always come from the pinned producer; other legacy discrepancies remain held.
const AUDITED_LEGACY_STATE = new Map([
  ["84:2638:9906:0", { quantity:1, respawn:0, members:false }],
]);
const OWNED_EXACT = new Map([
  ["560:2500:2967:0", "Quests.plugin.js Watchtower definition provider"],
  ["2398:2528:9415:0", "Quests.plugin.js Watchtower definition provider"],
  ["2398:2530:9462:0", "Quests.plugin.js Watchtower definition provider"],
  ["2397:2617:9437:0", "Quests.plugin.js Watchtower definition provider"],
  ["532:1475:9498:1", "MeatAndGreet.Quest.js post-Alpha private scene"],
  ["532:1477:9499:1", "MeatAndGreet.Quest.js post-Alpha private scene"],
  ["532:1478:9497:1", "MeatAndGreet.Quest.js post-Alpha private scene"],
  ...[[3110,2430],[3118,2419],[3119,2443],[3102,2415],[3115,2407],[3131,2398]]
    .map(([x,y]) => [String(31393)+":"+x+":"+y+":0", "TroubledTortugans.Quest.js stage-owned materials"]),
  ...[[3161,2389],[3168,2388],[3179,2384],[3190,2379],[3191,2383],[3197,2376]]
    .map(([x,y]) => [String(31395)+":"+x+":"+y+":0", "TroubledTortugans.Quest.js stage-owned materials"]),
  ["401:2962:2600:0", "TroubledTortugans.Quest.js stage-owned seaweed"],
  ["1351:1683:2975:0", "RibbitingTale.Quest.js takes the axe from the Locus logs loc"],
  ["2349:1466:9573:0", "TheFinalDawn.Quest.js Teumo's basement barrels"],
  ["946:1646:3095:0", "TheFinalDawn.Quest.js safehouse loot"],
  ["307:1331:3330:0", "ShadowsOfCustodia.Quest.js per-player rod spawn"],
  ["2347:1207:3108:0", "Scrambled.Quest.js per-player hammer"],
  ["8794:1212:3093:0", "Scrambled.Quest.js per-player saw"],
  ["960:1238:3076:0", "Scrambled.Quest.js per-player planks"],
  ["245:3018:10353:0", "WineOfZamorak.plugin.js Deep Wilderness Dungeon wine"],
  // Its 7-tick respawn is taken from the Deep Wilderness Dungeon page and captures (4abb2bfb7).
  ["23489:3018:10353:0", "WineOfZamorak.plugin.js Deep Wilderness Dungeon wine"],
  // c166cbdf2 gave the base tinderboxes a 2-tick respawn with the Castle Wars supplies rework.
  ...[[2431,3072,0],[2423,3080,1],[2368,3135,0],[2376,3127,1]]
    .map(([x,y,z]) => ["590:"+x+":"+y+":"+z, "CastleWars supplies: 2-tick base tinderboxes"]),
]);
// Rows beside a same-item legacy spawn that live captures show as a second, separate spawn:
// rsprox (https://rsprox.net/database) has an obj_add on both tiles in the same recordings.
const SEPARATE_FROM_NEARBY_LEGACY = new Map([
  ["1511:2959:3205:0", "Rimmington logs: 2958,3205 and 2959,3205 both added in 37 recordings"],
]);
// Rows inside instanced areas whose plugins build the floor per player or party.
const OWNED_LOCATIONS = [
  ["[[Hallowed Sepulchre]]", "HallowedSepulchre per-player floor template integration required"],
  ["[[Chambers of Xeric]]", "Chambers of Xeric raid instance"],
];
for (const [id, points] of [[5559, [[2969,4999],[2970,5000],[3009,5063],[3009,5070]]], [5568, [[3018,5080],[3018,5086],[3011,5082],[3013,5090]]]]) {
  for (const [x,y] of points) for (const plane of [0,1]) {
    OWNED_EXACT.set([id,x,y,plane].join(":"), "Lobby.RoguesDen.js owns plane1; legacy plane0 must not be duplicated");
  }
}
const keyOf = (id, x, y, z) => [id, x, y, z].join(":");
const rowKey = (r) => keyOf(r.id, r.x, r.y, r.plane);
const definitionKey = (r) => keyOf(r.id, r.location?.x, r.location?.y, r.location?.z);
const ownerOf = (r) => OWNED_EXACT.get(rowKey(r))
  ?? OWNED_LOCATIONS.find(([link]) => r.location?.includes(link))?.[1] ?? null;

function reconcilePickupReplacements(rows, existing) {
  const statuses = new Map();
  const replacements = new Map();
  const projections = new Set();
  for (const row of rows) {
    const pickup = row.pickup_replacement;
    if (!pickup || row.unresolved_reasons.length) continue;
    const key = rowKey(row);
    const display = existing.filter(d => definitionKey(d) === key);
    if (display.length !== 1 || (display[0].amt ?? 1) !== row.quantity
      || display[0].respawn !== row.infobox_respawn_ticks || (display[0].members === true) !== row.members) continue;

    const rewardKey = keyOf(pickup.id, row.x, row.y, row.plane);
    const projectionsAtTile = rows.filter(other => rowKey(other) === rewardKey && other.name === row.name
      && other.location === row.location && other.members === row.members && other.quantity === row.quantity
      && !other.unresolved_reasons.length && !other.pickup_replacement);
    if (projectionsAtTile.length !== 1) continue;
    const [projection] = projectionsAtTile;

    replacements.set(key, {
      id: pickup.id,
      ...(pickup.telegrab_denial ? { telegrabDenial: pickup.telegrab_denial } : {}),
    });
    projections.add(rewardKey);
    statuses.set(row, "existing-pickup-replacement");
    statuses.set(projection, "pickup-reward-projection");
  }
  const definitions = existing.filter(d => !projections.has(definitionKey(d))).map(d => {
    const replacement = replacements.get(definitionKey(d));
    return replacement ? { ...d, pickupReplacement: replacement } : d;
  });
  return { definitions, statuses };
}

function conflictingCaseAliases(rows) {
  const byTitle = new Map(), conflicts = new Set();
  for (const row of rows) {
    const title = row.page.toLowerCase();
    byTitle.set(title, [...(byTitle.get(title) ?? []), row]);
  }
  const couldShareIdentity = (a,b) => ["id","x","y","plane"].every(key => {
    if (Number.isInteger(a[key]) && Number.isInteger(b[key]) && a[key] !== b[key]) return false;
    if (key === "id") for (const [known, uncertain] of [[a,b],[b,a]]) {
      if (Number.isInteger(known.id) && uncertain.candidate_ids?.length
        && !uncertain.candidate_ids.includes(known.id)) return false;
    }
    return true;
  });
  const state = row => JSON.stringify([row.quantity,row.infobox_respawn_ticks,row.members,
    row.location,row.tile_respawn_raw,row.pickup_replacement ?? null]);
  for (const aliases of byTitle.values()) for (let i=0;i<aliases.length;i++) {
    for (let k=i+1;k<aliases.length;k++) {
      const a=aliases[i], b=aliases[k];
      if (!couldShareIdentity(a,b)) continue;
      // Already-unresolved pairs stay held under their original source diagnostics.
      if (a.unresolved_reasons.length && b.unresolved_reasons.length) continue;
      if (a.unresolved_reasons.length || b.unresolved_reasons.length || state(a) !== state(b)) {
        conflicts.add(a); conflicts.add(b);
      }
    }
  }
  return conflicts;
}

export function importSpawns(source, existing) {
  if (source.schema !== 1 || !Array.isArray(source.rows) || !Array.isArray(existing)) {
    throw new Error("Expected source schema1 and an array of existing definitions");
  }
  const aliasConflicts = conflictingCaseAliases(source.rows);
  const reconciled = reconcilePickupReplacements(source.rows.filter(row => !aliasConflicts.has(row)), existing);
  existing = reconciled.definitions;
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
    if (aliasConflicts.has(row)) {
      entry.status = "conflicting-source-alias-state";
      entry.reasons = [...new Set([...entry.reasons, "conflicting-source-alias-state"])];
    } else if (reconciled.statuses.has(row)) {
      entry.status = reconciled.statuses.get(row);
    } else if (/scenery/i.test(row.section ?? "")) {
      // Listed under "Scenery object spawns": the item is taken from a loc, not lying on the ground.
      entry.status = "scenery-object-spawn";
    } else if (owner) {
      entry.status = "area-owned-or-instance-integration";
      entry.owner = owner;
    } else if (entry.reasons.length) {
      entry.status = "unresolved-source";
    } else if (typeof row.members !== "boolean") {
      entry.status = "unresolved-source";
      entry.reasons.push("unknown-world-membership");
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
      const prior = AUDITED_LEGACY_STATE.get(key);
      if (prior && present.length === 1 && entries.every(entry => isAuditedMemberQuestRow(entry.source))
        && (!Object.hasOwn(present[0], "amt") || (Number.isInteger(present[0].amt) && present[0].amt === prior.quantity))
        && present[0].respawn === prior.respawn
        && (!Object.hasOwn(present[0], "members") || (typeof present[0].members === "boolean" && present[0].members === prior.members))) {
        const index = existing.indexOf(present[0]);
        definitions[index] = { ...definitions[index], amt:row.quantity,
          respawn:row.infobox_respawn_ticks, members:row.members };
        for (const entry of entries) {
          entry.status = "existing-audited-source-state-reconciled";
          entry.existingCount = 1;
        }
        continue;
      }
      const matches = present.every(d => (d.amt ?? 1) === row.quantity && d.respawn === row.infobox_respawn_ticks
        && (d.members === true) === row.members);
      // A single legacy entry on the row's exact tile is that spawn: take its amount, timer and
      // world membership from the source. Several entries on one tile, or fields of an unexpected
      // type, stay reported for review rather than guessed.
      const [legacy] = present;
      const wellTyped = present.length === 1
        && (!Object.hasOwn(legacy, "amt") || (Number.isInteger(legacy.amt) && legacy.amt > 0))
        && Number.isInteger(legacy.respawn) && legacy.respawn >= 0
        && (!Object.hasOwn(legacy, "members") || typeof legacy.members === "boolean");
      if (!matches && wellTyped) {
        const index = existing.indexOf(legacy);
        const { id, location, amt: _amt, respawn: _respawn, members: _members, ...rest } = definitions[index];
        definitions[index] = { id, location, amt:row.quantity, respawn:row.infobox_respawn_ticks,
          ...(row.members ? { members:true } : {}), ...rest };
      }
      for (const entry of entries) {
        entry.status = matches ? "existing-exact"
          : wellTyped ? "existing-source-state-reconciled" : "existing-exact-state-discrepancy";
        entry.existingCount = present.length;
        if (!matches && wellTyped) entry.previousState = { amt:legacy.amt, respawn:legacy.respawn, members:legacy.members };
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
    // A legacy spawn of the same item within two tiles is most likely this row placed slightly off.
    // Adding the row would double the spawn, so it is held for placement review instead.
    const sameItemNearby = nearby.filter(d => d.id === row.id);
    if (sameItemNearby.length && !SEPARATE_FROM_NEARBY_LEGACY.has(key)) {
      for (const entry of entries) {
        entry.status = "near-legacy-placement-review";
        entry.nearbyLegacy = sameItemNearby;
      }
      continue;
    }
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
    policy:"Every source-clean ground row (not under a Scenery object spawns heading, no unresolved reason, no alias conflict, not owned by a quest or instance) with explicit infobox ticks and no tile override; members rows carry the loader membership gate; rows with a same-item legacy spawn within two tiles are held for placement review; a single legacy entry on a row's exact tile takes the row's amount, timer and membership; legacy entries otherwise preserved except exact source-proven pickup reward projections and audited Temple of Ikov staff state reconciliation from pinned source (alias provenance retained).",
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
  result.report.sourceRepository = SOURCE_PIN.repository;
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
