"use strict";

// Mystery box (Quiz Master reward), Wiki "Mystery box". OSRS rolls 1/256 for the stale baguette,
// then one slot of the free-to-play, members or Entrana table. The members tables are 15 slots:
// 12 items, 2 of the clue table (easy/medium/hard 10:6:4; nothing when that tier can't be taken)
// and 1 of the rare drop table, rolled by NpcDrops from the server's shared drop data.
const ids = { LAMP: 2528, CABBAGE: 1965, DIAMOND: 1601, BUCKET: 1925, FLYER: 956,
  STEEL_PLATEBODY: 1119, OLD_BOOT: 685, BODY_RUNE: 559, ONION: 1957, MITHRIL_SCIMITAR: 1329,
  CASKET: 405, NATURE_RUNE: 561, STALE_BAGUETTE: 20590, NOTED_MITHRIL_BAR: 2360, NOTED_STEEL_BAR: 2354 };
const CLUE_SLOTS = 2, RARE_SLOTS = 1;
const CLUE_WEIGHTS = [["easy", 10], ["medium", 6], ["hard", 4]];
const SHARED_SLOTS = [[ids.LAMP, 1], [ids.CABBAGE, 1], [ids.DIAMOND, 1], [ids.BUCKET, 1], [ids.FLYER, 1]];
const F2P_TABLE = [...SHARED_SLOTS, [ids.STEEL_PLATEBODY, 1]];
const COMMON_MEMBERS_SLOTS = [...SHARED_SLOTS, [ids.OLD_BOOT, 1], [ids.BODY_RUNE, 1], [ids.ONION, 1],
  [ids.CASKET, 1], [ids.NATURE_RUNE, 20]];
const MEMBERS_TABLE = [...COMMON_MEMBERS_SLOTS, [ids.MITHRIL_SCIMITAR, 1], [ids.STEEL_PLATEBODY, 1]];
const ENTRANA_TABLE = [...COMMON_MEMBERS_SLOTS, [ids.NOTED_MITHRIL_BAR, 5], [ids.NOTED_STEEL_BAR, 5]];

function onEntrana(player) {
  const location = player?.getLocation?.();
  return location != null && location.getZ() === 0 && location.getX() >= 2800 && location.getX() <= 2879 &&
    location.getY() >= 3320 && location.getY() <= 3391;
}

function rollClue(api, player) {
  let roll = Math.floor(Math.random() * CLUE_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0));
  const [tier] = CLUE_WEIGHTS.find(([, weight]) => (roll -= weight) < 0);
  const receive = { player, tier, allowed: null };
  api.emitCustomEvent("treasure-trails:can-receive", receive);
  if (receive.allowed === false) return [];
  const clue = { player, itemId: api.core.ItemIdentifiers[`CLUE_SCROLL_${tier.toUpperCase()}_`], box: false };
  api.emitCustomEvent("treasure-trails:clue-item", clue);
  return [{ id: clue.itemId, amount: 1, clue: true }];
}

function rollRare(api, player) {
  const request = { player, source: "Mystery box", drops: [],
    table: { entries: [{ always: true, shared_table: "rareDrop" }] } };
  api.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops.map((drop) => {
    const noteId = drop.noted ? api.core.ItemDefinition.forId(drop.itemId).getNoteId() : -1;
    return { id: noteId >= 0 ? noteId : drop.itemId, amount: drop.amount };
  });
}

function roll(api, player = null) {
  if (Math.floor(Math.random() * 256) === 0) return [{ id: ids.STALE_BAGUETTE, amount: 1 }];
  const members = api.core.WorldDefinition.isMembersWorld();
  const table = !members ? F2P_TABLE : onEntrana(player) ? ENTRANA_TABLE : MEMBERS_TABLE;
  const slot = Math.floor(Math.random() * (table.length + (members ? CLUE_SLOTS + RARE_SLOTS : 0)));
  if (slot < table.length) return [{ id: table[slot][0], amount: table[slot][1] }];
  return slot < table.length + CLUE_SLOTS ? rollClue(api, player) : rollRare(api, player);
}

module.exports = { roll };
