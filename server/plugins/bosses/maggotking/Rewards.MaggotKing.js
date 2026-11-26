"use strict";

/**
 * The Maggot King's corpse: Open-stomach or Take-eggs, as the Wiki's Loot mechanics section has it.
 *
 * The engine's death roll is suppressed (Instance.claimBossDrops), so the choice reads the generated
 * table itself: open-stomach rolls npc-drops.json's `maggot_king_2`, take-eggs rolls
 * `maggot_king` (the same table the old death roll used). Harvested loot goes into the pack, with
 * overflow on the floor for three hours (Wiki, 15 July 2026 update). The boss respawns shortly
 * after the corpse is used; it does not respawn while the corpse is waiting.
 *
 * Take-eggs' no-loot line is the Wiki's "The eggs pop as you try to take them."
 */
const Common = require("./Common.MaggotKing");
const Instance = require("./Instance.MaggotKing");

/** The generated tables keyed by the NPCs the importer maps them to. */
const OPEN_STOMACH_NPC = "MAGGOT_KING_CORPSE";
const TAKE_EGGS_NPC = "MAGGOT_KING";
/** Wiki (15 July 2026): Maggot King overflow remains for three hours. 0.6 s a tick. */
const OVERFLOW_TICKS = 3 * 60 * 60 * 10 / 6;
const NOTHING_LINE = "The eggs pop as you try to take them.";

let api = null;
let core = null;

function sessionOf(npc) {
  return npc?.__maggotKingCorpse ?? null;
}

/** The corpse this interaction belongs to: the lair's live session, unclaimed, same player. */
function validCorpse(npc, player) {
  const session = sessionOf(npc);
  return !!session && !session.ended && session.player === player && session.corpse === npc
    && !session.corpseClaimed;
}

/** Rolls the corpse's own generated table; `boss` makes the corpse's uniques take the boss multiplier. */
function roll(player, npcKey, boss = false) {
  const request = {
    player,
    npcId: core.NpcIdentifiers[npcKey],
    drops: [],
    source: "Maggot King",
  };
  if (boss) request.boss = true;
  api.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops;
}

/** Puts the harvested loot in the pack, or on the floor when it will not fit. */
function give(player, drops, location) {
  const manager = api.getItemOnGroundManager();
  const area = player.getPrivateArea?.() ?? null;
  const inventory = player.getInventory();
  api.emitCustomEvent("npc-drops:report", { player, npcId: core.NpcIdentifiers.MAGGOT_KING, drops });
  for (const drop of drops) {
    if (!Number.isInteger(drop?.itemId) || !(drop.amount > 0)) continue;
    const noteId = core.ItemDefinition.forId(drop.itemId).getNoteId();
    const itemId = drop.noted && noteId >= 0 && core.ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
    const stackable = core.ItemDefinition.forId(itemId).isStackable();
    const item = new core.Item(itemId, drop.amount);
    // A stack already at the cap accepts only the room left; the remainder must reach the floor.
    const accepted = Math.max(0, Math.min(drop.amount, inventory.getAddableAmount(item)));
    if (accepted > 0) inventory.adds(itemId, accepted);
    const overflow = drop.amount - accepted;
    if (overflow <= 0) continue;
    if (!location) continue;
    if (stackable) {
      manager.registerLocation(player, new core.Item(itemId, overflow), location, area, { despawnDelay: OVERFLOW_TICKS });
    } else {
      for (let index = 0; index < overflow; index++) {
        manager.registerLocation(player, new core.Item(itemId, 1), location, area, { despawnDelay: OVERFLOW_TICKS });
      }
    }
  }
  inventory.refreshItems();
}

function finish(session) {
  session.corpseClaimed = true;
  session.removeCorpse();
  session.scheduleRespawn(session.corpseRespawn ?? 9);
}

function claim(event, npcKey, boss, { emptyLine = null } = {}) {
  const { player, npc } = event ?? {};
  if (!player || !npc || !validCorpse(npc, player)) return false;
  const session = sessionOf(npc);
  const location = npc.getLocation?.() ?? null;
  const drops = roll(player, npcKey, boss);
  // The harvest is this roll, so pets, clue capacity, ironman rules and the collection log read it
  // here; the kill itself was already counted by Combat Achievements (countKill: false).
  api.emitCustomEvent("npc-drops:roll", { player, npc, npcId: core.NpcIdentifiers.MAGGOT_KING, drops, countKill: false });
  give(player, drops, location);
  if (emptyLine && drops.length === 0) player.sendMessage(emptyLine);
  finish(session);
  return true;
}

function openStomach(event) {
  return claim(event, OPEN_STOMACH_NPC, true);
}

function takeEggs(event) {
  return claim(event, TAKE_EGGS_NPC, false, { emptyLine: NOTHING_LINE });
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onNpcInteraction("Maggot King Corpse", {
    "Open-stomach": openStomach,
    "Take-eggs": takeEggs,
  });
}

module.exports = {
  attach,
  openStomach,
  takeEggs,
  OPEN_STOMACH_NPC,
  TAKE_EGGS_NPC,
  OVERFLOW_TICKS,
  NOTHING_LINE,
  _test: { roll, give, validCorpse },
};
