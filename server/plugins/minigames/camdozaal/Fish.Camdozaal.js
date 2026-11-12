"use strict";

const S = require("./Shared.Camdozaal");
const { run } = require("./Actions.Camdozaal");
const COOKING = require("../../skills/data/cooking.json");
const ZEALOT = require("../../skills/data/bone-altars.json").zealot;
const PREPARATION_TABLE = "camdozaal_preparation_table";
const ALTAR = "camdozaal_altar";
const PRAYER_XP = { guppy: 4, cavefish: 7, tetra: 10, catfish: 16 };

function rows() {
  return COOKING.cookables.filter(row => row.facility === PREPARATION_TABLE).map(row => ({
    ...row, rawId: S.obj(row.raw), cookedId: S.obj(row.cooked), ruinedId: S.obj(row.burnt), prayerXp: PRAYER_XP[row.name],
  }));
}
function available(row) { return S.core().WorldDefinition.isMembersWorld() || !S.core().CacheDefinitions.getItem(row.rawId)?.isMembers; }
function knife(player) { return player.getInventory().contains(S.core().ItemIdentifiers.KNIFE); }
function nearby(player, object) { return S.inRuins(player) && player.getLocation().isWithinDistance(object.getLocation(), 3); }

/** Published no-ruin levels are exact boundaries; the intermediate curve is a TSPS estimate. */
function prepareChance(player, row) {
  const level = player.getSkillManager().getCurrentLevel(S.core().Skill.COOKING);
  const permanent = S.purchased(player, 1);
  const stop = permanent ? row.preparationStopBurn : row.stopBurn;
  if (level >= stop) return 1;
  const base = 0.6 + 0.4 * (level - row.level) / (row.stopBurn - row.level);
  // Preserve a real ruin outcome below the published no-ruin boundary, even
  // when the estimated additive curve would otherwise saturate early.
  return Math.max(0, Math.min(255 / 256, base + (permanent ? 0.1 : 0) + (S.boostTicks(player) > 0 ? 0.05 : 0)));
}
function prepareOne(player, row) {
  const inventory = player.getInventory();
  if (!available(row) || !knife(player) || !inventory.contains(row.rawId)) return false;
  if (player.getSkillManager().getCurrentLevel(S.core().Skill.COOKING) < row.level) {
    player.sendMessage(`You need a Cooking level of ${row.level} to prepare ${row.name}.`);
    return false;
  }
  const success = Math.random() < prepareChance(player, row);
  inventory.deleteNumber(row.rawId, 1);
  inventory.adds(success ? row.cookedId : row.ruinedId, 1);
  if (success) player.getSkillManager().addExperiences(S.core().Skill.COOKING, row.xp);
  player.sendMessage(success ? `You prepare the ${row.name}.` : `You accidentally ruin the ${row.name}.`);
  S.pluginApi().emitCustomEvent("cooking:count", { player, burnt: !success });
  if (success) S.pluginApi().emitCustomEvent("cooking:success", { player, skill: S.core().Skill.COOKING,
    rawId: row.rawId, itemId: row.cookedId, amount: 1, location: player.getLocation().clone(),
    objectId: S.core().CacheDefinitions.getLocId(PREPARATION_TABLE) });
  return true;
}
function zealotChance(player) {
  return ZEALOT.pieces.filter(name => player.getEquipment().contains(S.obj(name))).length * ZEALOT.chancePerPiece;
}
function offerOne(player, row) {
  const inventory = player.getInventory();
  if (!available(row) || !inventory.contains(row.cookedId)) return false;
  const saved = Math.random() < zealotChance(player);
  if (!saved) inventory.deleteNumber(row.cookedId, 1);
  else player.sendMessage("Your Zealot's robes save the fish but still grant you experience.");
  player.getSkillManager().addExperiences(S.core().Skill.PRAYER, row.prayerXp);
  return true;
}
function start(player, object, row, amount, offering) {
  if (!nearby(player, object) || !S.questComplete(player) || !available(row)) return;
  if (!offering && !knife(player)) return player.sendMessage("You need a knife to prepare fish.");
  let remaining = Math.max(0, Math.min(Number(amount) || 0, player.getInventory().getAmount(offering ? row.cookedId : row.rawId)));
  if (!remaining) return;
  player.getPacketSender().sendInterfaceRemoval();
  run(player, tick => {
    if (!nearby(player, object)) return false;
    // Wiki fish pages: first action2 ticks; auto preparation4, offerings3 thereafter.
    if (tick < 2 || (tick - 2) % (offering ? 3 : 4) !== 0) return true;
    if (!(offering ? offerOne(player, row) : prepareOne(player, row))) return false;
    return --remaining > 0;
  });
}
function choose(event, offering, onlyItem = null) {
  const { player, object } = event;
  if (!nearby(player, object) || !S.questComplete(player)) return;
  if (!offering && !knife(player)) return player.sendMessage("You need a knife to prepare fish.");
  const fish = rows().filter(row => available(row) && player.getInventory().contains(offering ? row.cookedId : row.rawId)
    && (onlyItem === null || onlyItem === (offering ? row.cookedId : row.rawId)));
  if (!fish.length) return player.sendMessage(offering ? "You have no prepared fish to offer." : "You have no fish to prepare.");
  const ids = fish.map(row => offering ? row.cookedId : row.rawId);
  if (fish.length === 1 && player.getInventory().getAmount(ids[0]) === 1) return start(player, object, fish[0], 1, offering);
  const menu = new (S.core().CreationMenu)(offering ? "What would you like to offer?" : "What would you like to prepare?", ids, {
    execute(id, amount) {
      const row = fish.find(row => (offering ? row.cookedId : row.rawId) === id);
      if (row) start(player, object, row, amount, offering);
    },
  }, { mode: 6 });
  player.getPacketSender().sendCreationMenu(menu);
}
function prepare(event) { choose(event, false); }
function offer(event) { choose(event, true); }
function useFish(event) {
  if (event.handled) return;
  const loc = S.core().CacheDefinitions;
  const offering = event.objectId === loc.getLocId(ALTAR);
  if (!offering && event.objectId !== loc.getLocId(PREPARATION_TABLE)) return;
  if (!rows().some(row => event.itemId === (offering ? row.cookedId : row.rawId))) return;
  event.handled = true;
  choose(event, offering, event.itemId);
}

module.exports = function attach(api) {
  api.onObjectInteraction("Preparation Table", { "Prepare-fish": prepare });
  api.onObjectInteraction("Altar", { "Offer-fish": offer });
  api.onItemOnObject(useFish);
};
