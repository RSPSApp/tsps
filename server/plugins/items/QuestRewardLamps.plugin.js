/**
 * The antique lamps the 3 November 2026 update added to free-to-play quests (Wiki: Update:Quest
 * Month Kick Off, TFA Tweaks & More; each lamp's own page). Rub: choose a skill on the shared
 * xpreward interface (plugins/interface/XpReward.plugin.js) and gain the lamp's experience.
 *
 *   34755 Shield of Arrav, 34750 Ernest the Chicken, 34754 Romeo & Juliet: 500 XP, any skill
 *   34748 Black Knights' Fortress, 34749 Demon Slayer: 1,000 XP in a combat skill or Prayer
 *
 * The quests hand them out ("quest-lamps:give" { player, lamp, count }). No recording rubs one; the
 * line is the Ides of Milk lamp's recorded "Your wish has been granted!" form (rsprox 238/239).
 */
const LAMP_IDS = Object.freeze({
  BLACK_KNIGHTS_FORTRESS: 34748,
  DEMON_SLAYER: 34749,
  ERNEST_THE_CHICKEN: 34750,
  ROMEO_AND_JULIET: 34754,
  SHIELD_OF_ARRAV: 34755,
});

let core;
let pluginApi;
let LAMPS;
const pending = new WeakMap();

function initialize(coreApi) {
  core = coreApi;
  const { Skill } = core;
  const combat = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER];
  LAMPS = new Map([
    [LAMP_IDS.SHIELD_OF_ARRAV, { xp: 500 }],
    [LAMP_IDS.ERNEST_THE_CHICKEN, { xp: 500 }],
    [LAMP_IDS.ROMEO_AND_JULIET, { xp: 500 }],
    [LAMP_IDS.BLACK_KNIGHTS_FORTRESS, { xp: 1000, skills: combat }],
    [LAMP_IDS.DEMON_SLAYER, { xp: 1000, skills: combat }],
  ]);
}

function rub({ player, item, itemId, slot }) {
  const lamp = LAMPS?.get(itemId);
  if (!lamp) return false;
  if (player.getInventory().get(slot) !== item) return true;
  const request = { item, slot, lamp };
  pending.set(player, request);
  pluginApi.emitCustomEvent("xpreward:open", {
    player, skills: lamp.skills, onConfirm: (skill, name) => grant(player, request, skill, name),
  });
  return true;
}

/** The message box text, or null when the lamp is kept. */
function grant(player, request, skill, name = skill.getName()) {
  if (pending.get(player) !== request) return null;
  pending.delete(player);
  if (request.lamp.skills && !request.lamp.skills.includes(skill)) return null;
  const inventory = player.getInventory();
  if (inventory.get(request.slot) !== request.item) return null;
  const manager = player.getSkillManager();
  const before = manager.getExperience(skill);
  manager.addExperience(skill, request.lamp.xp, true);
  if (manager.getExperience(skill) === before) {
    player.sendMessage("You cannot gain experience in that skill right now.");
    return null;
  }
  inventory.deleteAtSlot(request.slot, 1);
  return `<col=0000ff>Your wish has been granted!</col> You have been awarded ${request.lamp.xp.toLocaleString("en-GB")} ${name} experience!`;
}

/** "quest-lamps:give" { player, lamp (a LAMP_IDS key), count }: what fits goes in the pack, the rest to the floor. */
function give(event) {
  const id = LAMP_IDS[event?.lamp];
  if (!event?.player || id === undefined) return;
  event.player.getInventory().forceAdd(event.player, new core.Item(id, Math.max(1, event.count | 0)));
  event.given = true;
}

module.exports = {
  name: "QuestRewardLamps",
  description: "The antique lamps from Shield of Arrav, Ernest the Chicken, Romeo & Juliet, Black Knights' Fortress and Demon Slayer: rub for their experience.",
  LAMP_IDS,
  register(api) {
    pluginApi = api;
    api.onServerStartup(initialize.bind(null, api.core));
    api.onItemAction("Antique lamp", { Rub: rub });
    api.onCustomEvent("quest-lamps:give", give);
  },
  _test: { rub, grant, give, initialize },
};
