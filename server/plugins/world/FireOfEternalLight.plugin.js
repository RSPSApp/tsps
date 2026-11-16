"use strict";

/**
 * Building a Fire of Eternal Light in an Old fire pit (Wiki: Old fire pit; Fire of Eternal Light). The pits
 * my2arm_fire_pit_mole, _lumb and _horrors (Mole Hole, Lumbridge Swamp Caves, Mos Le'Harmless Cave) are
 * multilocs on my2arm_fire_mole, _lumb and _horrors: 0 is the Old fire pit (op1 Build), 1 the fire. Darkness
 * reads the varbit, so a built fire lights its dark area for good.
 *
 * Wiki: Making Friends with My Arm done, 35 Construction (boostable), 66 Firemaking (not boostable), a hammer,
 * a saw and a tinderbox; 2 mahogany planks, 2 steel bars, 300 Te, 100 Efh and 50 Urt salt are used; 350
 * Construction and 300 Firemaking experience.
 *
 * rsprox_transcripts/226/01638.txt (my2arm_fire_pit_mole at 1748, 5237):
 * - tick 283, short of materials: the gamemessage below, nothing else.
 * - tick 400: my2arm_fire_mole 0 -> 1, human_poh_build, the planks, bars and salts gone, synth poh_build_wood,
 *   then fire_lit (delay 30), then 300 Firemaking and 350 Construction experience; no chat line.
 *
 * The quest line is the Wiki's (Old fire pit). No source gives a line for too low a level or a missing tool,
 * so those refuse with no message.
 *
 * The Weiss, Mort Myre and God Wars Dungeon pits build other fires with other salts and effects; they are not
 * built here.
 */

const Hammers = require("../items/Hammers");
const Saws = require("../items/Saws");

const QUEST_KEY = "making_friends_with_my_arm";
const QUEST_MESSAGE = "You can't see what would burn very well here. Perhaps you should complete Making Friends with My Arm first.";
const MATERIALS_MESSAGE = "You need 2 Steel Bars, 2 Mahogany Planks, 300 Te Salt, 100 Efh Salt, and 50 Urt Salt to build this.";
const CONSTRUCTION_LEVEL = 35;
const FIREMAKING_LEVEL = 66;
const CONSTRUCTION_EXPERIENCE = 350;
const FIREMAKING_EXPERIENCE = 300;
/** synth poh_build_wood (938) and fire_lit (2596), the cache's sound names; no lookup by name exists. */
const BUILD_SOUND = 938;
const FIRE_LIT_SOUND = 2596;
const FIRE_LIT_SOUND_DELAY = 30;

/** Each pit's loc, its varbit and the saved attribute that keeps it built. */
const PITS = [
  { loc: "my2arm_fire_pit_mole", varbit: "my2arm_fire_mole", attribute: "fire-of-eternal-light:mole-hole" },
  { loc: "my2arm_fire_pit_lumb", varbit: "my2arm_fire_lumb", attribute: "fire-of-eternal-light:lumbridge-swamp-caves" },
  { loc: "my2arm_fire_pit_horrors", varbit: "my2arm_fire_horrors", attribute: "fire-of-eternal-light:mos-le-harmless-cave" },
];

let api;
let core;
let ids;

function lookup() {
  if (ids) return ids;
  const { CacheDefinitions, ItemIdentifiers: I } = core;
  ids = {
    pits: new Map(PITS.map((pit) => [CacheDefinitions.getLocId(pit.loc), { ...pit, varbitId: CacheDefinitions.getVarbitId(pit.varbit) }])),
    animation: new core.Animation(CacheDefinitions.getSeqId("human_poh_build")),
    materials: [[I.MAHOGANY_PLANK, 2], [I.STEEL_BAR, 2], [I.TE_SALT, 300], [I.EFH_SALT, 100], [I.URT_SALT, 50]],
  };
  return ids;
}

function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function hasTools(player) {
  return Hammers.holdsHammer(core, player) && Saws.holdsSaw(core, player)
    && player.getInventory().contains(core.ItemIdentifiers.TINDERBOX);
}

function hasLevels(player) {
  const skills = player.getSkillManager();
  return skills.getCurrentLevel(core.Skill.CONSTRUCTION) >= CONSTRUCTION_LEVEL
    && skills.getMaxLevel(core.Skill.FIREMAKING) >= FIREMAKING_LEVEL;
}

function hasMaterials(player) {
  const inventory = player.getInventory();
  return lookup().materials.every(([id, amount]) => inventory.getAmount(id) >= amount);
}

function showFire(player, pit) {
  player.getPacketSender().sendVarbit(pit.varbitId, 1);
}

/** "Build" on an Old fire pit that is one of the three Eternal Light pits. */
function buildFire(event) {
  const { player, objectId } = event;
  const known = lookup();
  const pit = known.pits.get(objectId);
  if (!pit) return false;
  if (player.getAttribute(pit.attribute) === true) return true;
  if (!questComplete(player)) {
    player.sendMessage(QUEST_MESSAGE);
    return true;
  }
  if (!hasLevels(player) || !hasTools(player)) return true;
  if (!hasMaterials(player)) {
    player.sendMessage(MATERIALS_MESSAGE);
    return true;
  }
  const inventory = player.getInventory();
  for (const [id, amount] of known.materials) inventory.delete(id, amount);
  player.setAttribute(pit.attribute, true);
  showFire(player, pit);
  player.performAnimation(known.animation);
  const sender = player.getPacketSender();
  sender.sendSound(BUILD_SOUND, 1, 0);
  sender.sendSound(FIRE_LIT_SOUND, 1, FIRE_LIT_SOUND_DELAY);
  const skills = player.getSkillManager();
  skills.addExperiences(core.Skill.FIREMAKING, FIREMAKING_EXPERIENCE);
  skills.addExperiences(core.Skill.CONSTRUCTION, CONSTRUCTION_EXPERIENCE);
  return true;
}

/** Varbits aren't saved: a built fire is sent again on login. */
function restoreFires({ player }) {
  for (const pit of lookup().pits.values()) {
    if (player.getAttribute(pit.attribute) === true) showFire(player, pit);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  for (const pit of PITS) pluginApi.persistAttribute(pit.attribute, false);
}

module.exports = {
  name: "FireOfEternalLight",
  description: "Lets players build a Fire of Eternal Light in the Old fire pits of the Mole Hole, Lumbridge Swamp Caves and Mos Le'Harmless Cave.",
  members: true,
  _test: { buildFire, restoreFires, PITS, QUEST_MESSAGE, MATERIALS_MESSAGE },
  register(pluginApi) {
    attach(pluginApi);
    pluginApi.onObjectInteraction("Old fire pit", { Build: buildFire });
    pluginApi.onPlayerLogin(restoreFires);
  },
};
