/**
 * The dummies you Attack (data/attack-dummies.json; Wiki Dummy): a hit with the weapon's attack
 * animation and the dummy's defend, as recordings 237/01098 and 230/02965 play Civitas's. Up to
 * level 7 a hit gives the dummy's Attack experience; from 8 there is nothing more to learn.
 */
const fs = require("fs");
const path = require("path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "attack-dummies.json"), "utf8"));
/** The tick a player last hit a dummy: one hit per `hitTicks` however fast the clicks come. */
const lastHit = new WeakMap();
/** Players near enough to see the dummy move. */
const VIEW_DISTANCE = 15;

let core = null;
let pluginApi = null;

function hit({ player, object, objectId }) {
  const dummy = data.dummies[String(objectId)];
  if (!dummy || !player) return false;
  const { World, Skill, Animation, CombatFactory, CombatType, CacheDefinitions } = core;
  if (CombatFactory.getMethod(player).type() === CombatType.RANGED) {
    player.sendMessage(data.messages.ranged);
    return true;
  }
  const tick = World.getProcessCycle();
  if (tick - (lastHit.get(player) ?? -Infinity) < data.hitTicks) return true;
  lastHit.set(player, tick);
  player.performAnimation(new Animation(player.getAttackAnim()));
  player.getPacketSender().sendSoundEffect(data.sound, 1, 0);
  player.sendMessage(data.messages.hit);
  // "dummies:hit" { player, objectId }: a dummy hit (a league's "Attack a dummy").
  pluginApi?.emitCustomEvent?.("dummies:hit", { player, objectId });
  const defend = new Animation(CacheDefinitions.getSeqId(data.dummyAnimation));
  const at = object.getLocation();
  World.getPlayers().forEach((viewer) => {
    if (!viewer) return;
    const there = viewer.getLocation();
    if (there.getZ() === at.getZ() && Math.max(Math.abs(there.getX() - at.getX()), Math.abs(there.getY() - at.getY())) <= VIEW_DISTANCE) {
      viewer.getPacketSender().sendObjectAnimation(object, defend);
    }
  });
  if (!(dummy.experience > 0)) return true;
  if (player.getSkillManager().getMaxLevel(Skill.ATTACK) > data.maxLevel) {
    player.sendMessage(data.messages.learned);
    return true;
  }
  player.getSkillManager().addExperiences(Skill.ATTACK, dummy.experience);
  return true;
}

module.exports = {
  name: "AttackDummies",
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onObjectInteraction("Dummy", { Attack: hit });
  },
};

module.exports._test = { hit, data };
