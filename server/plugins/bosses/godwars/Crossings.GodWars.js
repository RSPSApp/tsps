"use strict";

/**
 * The ways into the four strongholds, as captured (ticks from arrival), with the Wiki's 70 level
 * requirements:
 *
 * - Bandos: the big door. Strength and a hammer bang the gong (godwars_hammer_gong_hammer), the
 *   door opens at +3 and the player steps through.
 * - Armadyl: the pillar. A crossbow with a mithril grapple fires at +1 (dorgesh_xbow_swing, the
 *   grapple spot and the pillar's swing), two exact-moves at +4 and +5 cross the gap.
 * - Saradomin: the two rocks. Tie-rope spends a rope and keeps the rope there for good (varbits
 *   godwars_saradomin_rope1/2); Climb-down moves the player a tick after the climb animation.
 * - Zamorak: the ice bridge. A swim (godwars_human_swim_double) under it; on the Zamorak side the
 *   area's evil drains Prayer.
 */
const Common = require("./Common.GodWars");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner");

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(Common.core.Skill[skill]);
}

function weaponName(player) {
  const { Equipment, ItemDefinition } = Common.core;
  const id = player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
  return id > 0 ? ItemDefinition.forId(id)?.getName?.()?.toLowerCase?.() ?? "" : "";
}

function bangGong({ player }) {
  const door = Common.data.crossings.bandosDoor;
  if (ObstacleRunner.isBusy(player)) return true;
  const fromEast = player.getLocation().getX() >= door.east[0];
  if (!fromEast) {
    ObstacleRunner.run({ player }, [{ walk: [door.east.slice(0, 2)] }]);
    return true;
  }
  if (level(player, "STRENGTH") < door.strength) {
    player.sendMessage(`You need a Strength level of ${door.strength} to bang the gong.`);
    return true;
  }
  if (!player.getInventory().contains(Common.core.ItemIdentifiers.HAMMER)) {
    player.sendMessage("You need a hammer to bang the gong.");
    return true;
  }
  ObstacleRunner.run({ player }, [
    { faceDir: "west" },
    { anim: door.anim, delay: 5 },
    { wait: 2 },
    { sound: door.sound },
    { walk: [door.west.slice(0, 2)] },
  ]);
  return true;
}

function grapple(event) {
  const { player } = event;
  const pillar = Common.data.crossings.armadylPillar;
  if (ObstacleRunner.isBusy(player)) return true;
  const { Equipment } = Common.core;
  const ammo = player.getEquipment().get(Equipment.AMMUNITION_SLOT)?.getId?.() ?? -1;
  if (ammo !== pillar.grapple || !weaponName(player).includes("crossbow")) {
    player.sendMessage("You need a mithril grapple-tipped bolt with a rope to do that.");
    return true;
  }
  if (level(player, "RANGED") < pillar.ranged) {
    player.sendMessage(`You need a Ranged level of ${pillar.ranged} to cross here.`);
    return true;
  }
  const southward = player.getLocation().getY() > pillar.middle[1];
  const [start, end] = southward ? [pillar.north, pillar.south] : [pillar.south, pillar.north];
  ObstacleRunner.run(event, [
    { walk: [start.slice(0, 2)] },
    { faceDir: southward ? "south" : "north" },
    { msg: "You fire your grapple at the pillar..." },
    { wait: 1 },
    { anim: pillar.anim, delay: 6 },
    { gfx: pillar.gfx, delay: 6, height: pillar.gfxHeight },
    ...pillar.sounds.map(([sound, delay]) => ({ sound, delay })),
    { objAnim: pillar.objAnim },
    { wait: 3 },
    { move: pillar.middle, speed: [15, 29], ticks: 1 },
    { move: end, speed: [0, 21], ticks: 1 },
    { sound: pillar.landSound },
    { msg: "...and swing safely to the other side." },
  ]);
  return true;
}

function ropeFor(objectId) {
  return Common.data.crossings.saradominRopes.find((rope) => rope.id === objectId) ?? null;
}

function tieRope({ player, objectId }) {
  const rope = ropeFor(objectId);
  if (!rope) return false;
  const { crossings } = Common.data;
  if (player.getAttribute(Common.ropeAttribute(rope.varbit)) === true) return climbDownRope({ player, objectId });
  if (level(player, "AGILITY") < crossings.ropeAgility) {
    player.sendMessage(`You need an Agility level of ${crossings.ropeAgility} to climb down here.`);
    return true;
  }
  if (!player.getInventory().contains(Common.core.ItemIdentifiers.ROPE)) {
    player.sendMessage("You need a rope to tie here.");
    return true;
  }
  player.getInventory().delete(Common.core.ItemIdentifiers.ROPE, 1);
  player.performAnimation(new Common.core.Animation(Common.data.entrance.climbAnim));
  player.getPacketSender().sendSoundEffect(crossings.ropeTieSound, 1, 0);
  player.setAttribute(Common.ropeAttribute(rope.varbit), true);
  player.getPacketSender().sendVarbit(rope.varbit, 1);
  return true;
}

function climbDownRope({ player, objectId }) {
  const rope = ropeFor(objectId);
  if (!rope || ObstacleRunner.isBusy(player)) return true;
  if (player.getAttribute(Common.ropeAttribute(rope.varbit)) !== true) return tieRope({ player, objectId });
  ObstacleRunner.run({ player }, [
    { anim: Common.data.entrance.climbAnim },
    { msg: "You climb down the rope." },
    { wait: 1 },
    { tele: rope.down },
  ]);
  return true;
}

function swim({ player }) {
  const bridge = Common.data.crossings.zamorakBridge;
  if (ObstacleRunner.isBusy(player)) return true;
  if (level(player, "HITPOINTS") < bridge.hitpoints) {
    player.sendMessage(`You need a Hitpoints level of ${bridge.hitpoints} to swim across.`);
    return true;
  }
  const northward = player.getLocation().getY() <= bridge.south[1];
  const steps = [
    { faceDir: northward ? "north" : "south" },
    { wait: 2 },
    { tele: northward ? bridge.southWater : bridge.northWater },
    { anim: bridge.anim },
    { sound: bridge.sound },
    { wait: 5 },
    { tele: northward ? bridge.north : bridge.south },
    { msg: "Dripping, you climb out of the water." },
  ];
  if (northward) {
    steps.push({ msg: "The extreme evil of this area leaves your Prayer drained." });
    steps.push({ run: ({ player: swimmer }) => drainPrayer(swimmer) });
  }
  ObstacleRunner.run({ player }, steps);
  return true;
}

function drainPrayer(player) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  skills.setCurrentLevels(Skill.PRAYER, 0);
  skills.updateSkill(Skill.PRAYER);
}

function attachCrossings(api) {
  const { crossings } = Common.data;
  const ropes = crossings.saradominRopes.map((rope) => rope.id);
  api.onObjectFirstClick(crossings.bandosDoor.id, bangGong);
  api.onObjectFirstClick(crossings.armadylPillar.id, grapple);
  api.onObjectFirstClick(ropes, tieRope);
  api.onObjectSecondClick(ropes, climbDownRope);
  api.onObjectFirstClick(crossings.zamorakBridge.id, swim);
}

module.exports = { attachCrossings };
