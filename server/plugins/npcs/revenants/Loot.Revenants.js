/**
 * Revenant loot (docs/revenants.md): the shared drop table under the revenant for its killer,
 * ether into an absorbing bracelet, and an amulet of avarice noting the rest. Each kill in the
 * caves also counts towards the Revenant maledictus.
 */
const { REVENANT_IDS, MALEDICTUS_ID, ITEMS, inCaves } = require("./Data.Revenants");
const { resetHeals } = require("./Combat.Revenants");
const { rollDrops } = require("./Drops.Revenants");
const Bracelet = require("./Bracelet.Revenants");
const Maledictus = require("./Maledictus.Revenants");
const Revenants = require("./Common.Revenants");

const AMULET_SLOT = 2;

function isRevenant(npcId) {
  return REVENANT_IDS.includes(npcId);
}

/** The revenant death hooks own loot. Keep the imported tables available for lookup. */
function claimLoot(event) {
  if (isRevenant(event.npcId) || event.npcId === MALEDICTUS_ID) event.handled = true;
}

function onTask(player, npc) {
  const request = { player, npc, onTask: false };
  Revenants.api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

function ownsLootingBag(player) {
  const request = { player, owned: false };
  Revenants.api.emitCustomEvent("looting-bag:owned", request);
  return request.owned === true;
}

/** The ground options NpcDrops gives a kill's loot ("npc-drops:ground-options": the Wiki's 200-tick tradeable lifetime). */
function lootOptions(player, itemId, area) {
  const request = { player, itemId, area, options: {} };
  Revenants.api.emitCustomEvent("npc-drops:ground-options", request);
  return request.options;
}

/** Drops land under the revenant for the killer; an amulet of avarice notes them (Wiki). */
function dropLoot({ killer, npc, npcId }) {
  if (!killer?.isPlayer?.() || !isRevenant(npcId)) return;
  resetHeals(npc);
  if (inCaves(npc.getLocation())) Maledictus.onRevenantKilled(npc.getDefinition().getCombatLevel());
  const { core } = Revenants;
  const player = killer.getAsPlayer();
  const drops = rollDrops({
    npcId,
    combat: npc.getDefinition().getCombatLevel(),
    skulled: player.isSkulled(),
    onTask: onTask(player, npc),
    ownsLootingBag: ownsLootingBag(player),
    boost: Revenants.dropBoost(player, npc.getDefinition().getName?.() ?? "Revenant"),
  });
  const avarice = player.getEquipment().getItems()[AMULET_SLOT]?.getId?.() === ITEMS.AMULET_OF_AVARICE;
  const where = npc.getLocation().clone();
  for (const drop of drops) {
    Revenants.api.emitCustomEvent("collection-log:obtain", { player, itemId: drop.itemId, amount: drop.amount });
    let amount = drop.amount;
    if (drop.itemId === ITEMS.ETHER) amount = Bracelet.absorbEther(player, amount);
    if (amount <= 0) continue;
    const definition = core.ItemDefinition.forId(drop.itemId);
    const noteId = definition.getNoteId();
    const noted = (drop.noted || avarice) && noteId >= 0 && core.ItemDefinition.forId(noteId).isNoted();
    const itemId = noted ? noteId : drop.itemId;
    if (noted || core.ItemDefinition.forId(itemId).isStackable()) {
      core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount), where, undefined, lootOptions(player, itemId));
    } else {
      for (let i = 0; i < amount; i++) core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, 1), where, undefined, lootOptions(player, itemId));
    }
  }
}

module.exports = function attachLoot(api) {
  api.onCustomEvent("npc-drops:claim", claimLoot);
  api.onNpcDeath(dropLoot);
};

Object.assign(module.exports, { dropLoot });
