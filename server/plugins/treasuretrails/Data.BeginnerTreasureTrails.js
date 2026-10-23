"use strict";

// Content is Jagex's clue-helper catalogue in the installed cache. Keep row identities,
// targets, text and equipment together rather than maintaining a second list of clues.
const MAP_INTERFACES = ["trail_map01", "trail_map06", "trail_map15", "trail_map05", "trail_map03"];
const CHARLIE_ITEMS = ["TROUT", "PIKE", "RAW_HERRING", "RAW_TROUT", "IRON_ORE", "IRON_DAGGER", "LEATHER_BODY", "LEATHER_CHAPS"];
const EMOTE_SLOTS = [19, 2, 7, 20, 18, 14];
const EMOTE_RADII = [2, 3, 3, 3, 16, 3];

function coordinate(packed) {
  return { x: (packed >>> 14) & 16383, y: packed & 16383, z: packed >>> 28 };
}

function load(core) {
  const C = core.CacheDefinitions;
  function table(name) {
    const id = C.getDbTableId(name);
    if (id == null) throw new Error(`Missing beginner clue table ${name}`);
    return C.getDbTableRows(id).filter(row => value(row, "difficulty") === 0);
  }
  function value(row, name, fallback = null) {
    const column = C.getDbColumn(row.tableId, name);
    return column == null ? fallback : row.column(column)[0] ?? fallback;
  }
  function target(row) {
    const targetRow = C.getDbRow(value(row, "target"));
    const packed = value(targetRow, "coord");
    const npcIds = new Set();
    function includeNpc(id) {
      if (id == null || id < 0 || npcIds.has(id)) return;
      npcIds.add(id);
      // Clue helper targets can name a multi-NPC base, while the interaction
      // packet names its live morph (Sedridor, Gertrude and Reldo, for example).
      for (const morph of C.getNpc(id).transforms ?? []) includeNpc(morph);
    }
    includeNpc(value(targetRow, "npc"));
    includeNpc(value(targetRow, "fallback_npc"));
    return { targetRow: targetRow.id, location: coordinate(packed), description: value(targetRow, "description", ""), npcIds: [...npcIds] };
  }
  function step(row, kind) {
    return { row: row.id, key: C.getDbRowName(row.id), id: value(row, "id"), kind, text: value(row, "clue_text", ""), ...target(row) };
  }
  const steps = table("cluehelper_clue_anagram").map(row => step(row, "anagram"));
  for (const row of table("cluehelper_clue_cryptic")) {
    const key = C.getDbRowName(row.id);
    steps.push(step(row, key.endsWith("_charlie_the_tramp") ? "charlie" : key.endsWith("_reldo") ? "hotcold" : "npc"));
  }
  for (const row of table("cluehelper_clue_map")) {
    const index = Number(C.getDbRowName(row.id).match(/_(\d+)$/)[1]);
    steps.push({ ...step(row, "map"), interfaceId: C.getInterfaceId(MAP_INTERFACES[index]) });
  }
  for (const row of table("cluehelper_clue_emote")) {
    const index = Number(C.getDbRowName(row.id).match(/_(\d+)$/)[1]);
    const outfitId = value(row, "outfit");
    const outfit = outfitId == null ? null : C.getDbRow(outfitId);
    const equipment = outfit ? C.getDbColumns(outfit.tableId).filter(name => name.startsWith("wearpos_") && !name.includes("param"))
      .flatMap(name => outfit.column(C.getDbColumn(outfit.tableId, name))).filter(id => id >= 0) : [];
    steps.push({ ...step(row, "emote"), emote: EMOTE_SLOTS[index], radius: EMOTE_RADII[index], equipment });
  }
  const hotcold = table("cluehelper_clue_hotcold").map(row => step(row, "hotcold-target"));
  const tasks = table("cluehelper_clue_skillchallenge").map((row, index) => ({ ...step(row, "charlie-task"), itemId: core.ItemIdentifiers[CHARLIE_ITEMS[index]] }));
  const items = core.ItemIdentifiers;
  return { steps, hotcold, tasks, byRow: new Map(steps.map(entry => [entry.row, entry])),
    scroll: items.CLUE_SCROLL_BEGINNER_, casket: items.REWARD_CASKET_BEGINNER_,
    box: items.SCROLL_BOX_BEGINNER_, device: C.getObjId("beginner_device"),
    uri: C.getNpcId("trail_beginner_uri"), textInterface: C.getInterfaceId("trail_cluetext"),
    rewardInterface: C.getInterfaceId("trail_rewardscreen"), rewardInventory: 141 };
}

module.exports = { load, coordinate };
