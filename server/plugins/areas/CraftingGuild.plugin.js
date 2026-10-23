/**
 * The Crafting Guild (https://oldschool.runescape.wiki/w/Crafting_Guild):
 *
 * - The door: coming in needs 40 Crafting and a brown (or golden) apron, a Crafting cape or a
 *   max cape (or variant) worn. The Master Crafter turns the rest away, or welcomes them in,
 *   with his Wiki transcript's lines. Leaving is never stopped.
 * - The bank chest and deposit box: only for players who have done the hard Falador Diary or
 *   have 99 Crafting.
 *
 * The refusals for too low a Crafting level and for the bank have no capture.
 */
const REQUIRED_LEVEL = 40;
const BANK_LEVEL = 99;
const NO_APRON_VARIANT = "when-trying-to-enter-the-guild-without-wearing-a-brown-apron-or-crafting-cape";
const WELCOME_VARIANT = "when-trying-to-enter-the-guild-whilst-wearing-a-brown-apron-or-crafting-cape";
/** The guild is south of the door; its tile, under the porch, is outside. */
const OUTSIDE_FROM_Y = 3289;
const WALK_ANIMATION = 819;
const APRONS = /^(?:brown|golden) apron$/i;

let api;
let core;

function wornName(player, slot) {
  const id = player.getEquipment().getItems()[slot]?.getId?.() ?? -1;
  return id > 0 ? core.ItemDefinition.forId(id)?.getName?.() ?? "" : "";
}

function wearsCraftingCape(player) {
  const request = { player, skill: "CRAFTING", result: false };
  api.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

function dressedForIt(player) {
  return APRONS.test(wornName(player, core.Equipment.BODY_SLOT)) || wearsCraftingCape(player);
}

function masterCrafterSays(player, variant) {
  api.emitCustomEvent("npc-dialogue:start", { player, npcId: core.NpcIdentifiers.MASTER_CRAFTER, variant, handled: false });
}

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, player, false); }
    execute() { this.stop(); action(); }
  })());
}

function crossDoor(player, door, entering) {
  if (player.getForceMovement()) return;
  const { Location, ForceMovement, ForceMovementTask } = core;
  const doorTile = door.getLocation();
  const inside = new Location(doorTile.getX(), doorTile.getY() - 1, doorTile.getZ());
  const from = entering ? doorTile : inside;
  const to = entering ? inside : doorTile;
  if (!player.getLocation().equals(from)) player.moveTo(from.clone());

  const dx = to.getX() - from.getX();
  const dy = to.getY() - from.getY();
  const direction = dy > 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
  const sender = player.getPacketSender();
  sender.sendObjectRemoval(door);
  core.TaskManager.submit(new ForceMovementTask(player, 2,
    new ForceMovement(from.clone(), new Location(dx, dy), 0, 30, direction, WALK_ANIMATION)));
  later(player, 3, () => sender.sendObject(door));
}

function openDoor(event) {
  const { player } = event;
  const entering = player.getLocation().getY() >= OUTSIDE_FROM_Y;
  if (!entering) {
    crossDoor(player, event.object, false);
    return true;
  }
  if (player.getSkillManager().getMaxLevel(core.Skill.CRAFTING) < REQUIRED_LEVEL) {
    player.sendMessage(`You need a Crafting level of ${REQUIRED_LEVEL} to enter the Crafting Guild.`);
    return true;
  }
  if (!dressedForIt(player)) {
    masterCrafterSays(player, NO_APRON_VARIANT);
    return true;
  }
  masterCrafterSays(player, WELCOME_VARIANT);
  crossDoor(player, event.object, true);
  return true;
}

function canBank(player) {
  if (player.getSkillManager().getMaxLevel(core.Skill.CRAFTING) >= BANK_LEVEL) return true;
  const request = { player, diary: "falador", tier: "hard", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function useBank(event) {
  if (canBank(event.player)) return false;
  event.player.sendMessage("Only those who have completed the hard Falador Diary or have 99 Crafting may use this.");
  return true;
}

module.exports = {
  name: "CraftingGuild",
  _test: { openDoor, canBank, dressedForIt },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    const { CacheDefinitions } = core;
    api.onObjectFirstClick(CacheDefinitions.getLocId("craftingguilddoor"), openDoor);
    api.onObjectFirstClick(CacheDefinitions.getLocId("diary_guild_bankchest"), useBank);
    api.onObjectSecondClick(CacheDefinitions.getLocId("diary_guild_bankchest"), useBank);
    api.onObjectFirstClick(CacheDefinitions.getLocId("diary_guild_deposit_box"), useBank);
  },
};
