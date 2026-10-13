/**
 * The friendly event (Wiki; captured): Abidor Crank walks up and, talked to, blesses player and
 * follower - their hitpoints, the player's Defence, and every rotten food turned to stew. It's
 * worth no points, so the path on is open from the start.
 */
const Common = require("./Common.TempleTrekking");
const Trek = require("./Trek.TempleTrekking");
const Combat = require("./Combat.TempleTrekking");

const GLOW_GRAPHIC = 626;
const HEAL = 15;
/** Wiki: "boosting your Defence level by up to 12 (depending on the player's Defence level)". */
const DEFENCE_BOOST_MAX = 12;

function start(trek, room) {
  const { spec } = room;
  const box = Array.isArray(spec.spawn) ? spec.spawn : spec.spawn[trek.direction];
  const tile = [Math.floor((box[0] + box[2]) / 2), box[3], 0];
  const npc = trek.spawn(Common.data.npcs.templetrek_good_samaritan, tile);
  if (npc) npc.setFollowing(trek.player);
  room.state = { abidor: npc, blessed: false };
  room.complete = true;
}

function bless(trek) {
  const { player } = trek;
  const { Graphic, Item, Skill } = Common.core;
  const skills = player.getSkillManager();
  skills.setCurrentLevel(Skill.HITPOINTS, Math.min(skills.getMaxLevel(Skill.HITPOINTS), skills.getCurrentLevel(Skill.HITPOINTS) + HEAL), true);
  const defence = skills.getMaxLevel(Skill.DEFENCE);
  const boost = Math.min(DEFENCE_BOOST_MAX, 3 + Math.floor(defence / 10));
  skills.setCurrentLevel(Skill.DEFENCE, Math.max(skills.getCurrentLevel(Skill.DEFENCE), defence + boost), true);
  const inventory = player.getInventory();
  const items = inventory.getItems();
  for (let slot = 0; slot < items.length; slot++) {
    if (items[slot]?.getId?.() === Common.data.items.rotten_food) inventory.setItem(slot, new Item(Common.data.items.stew, 1));
  }
  inventory.refreshItems();
  player.performGraphic(new Graphic(GLOW_GRAPHIC));
  if (trek.npc?.isRegistered?.()) {
    trek.npc.heal(HEAL);
    trek.npc.performGraphic(new Graphic(GLOW_GRAPHIC));
  }
}

function talkTo(event) {
  const trek = Trek.trekOf(event.player);
  if (trek?.room?.key !== "samaritan" || event.npc !== trek.room.state.abidor) return false;
  const { player, room } = trek;
  const abidor = Common.data.npcs.templetrek_good_samaritan;
  event.npc.setFollowing(null);
  if (room.state.blessed) {
    Common.chat(player, [["player", "Hello there..."], ["npc", abidor, "Ohhh, hello again... sorry my friend, but I have to get going."]]);
    return true;
  }
  Common.chat(player, [
    ["player", "Hello there..."],
    ["npc", abidor, "Ahhh, hello there my friend. You look like you could do with some assistance."],
    ["player", "We do?"],
    ["npc", abidor, "Yes, of course... Here, prepare yourselves!"],
  ], () => {
    room.state.blessed = true;
    bless(trek);
    Common.chat(player, [["npc", abidor, "There you go... Right, I must be off now. Good luck with your travels."]]);
  });
  return true;
}

function samaritanRoom(trek) {
  return Combat.eventRoom(trek, "samaritan");
}

function attachSamaritan(api) {
  Trek.registerEvent("samaritan", { room: samaritanRoom, start });
  api.onNpcInteraction("Abidor Crank", { "Talk-to": talkTo });
}

module.exports = { attachSamaritan };
