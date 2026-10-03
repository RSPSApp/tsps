/**
 * Warriors' Guild: Ajjat's dummy room. One of seven dummies pops out of its hole at a time and
 * has to be hit with the matching combat style or attack type: 15 Attack XP and 2 tokens for the
 * right one, a three-tick stun for the wrong one (Wiki). The pop-up timing, fall animation and
 * messages follow Near-Reality's port.
 */
const Guild = require("./Common.WarriorsGuild");

const ATTACK_XP = 15;
const TOKENS = 2;
const STUN_TICKS = 3;
const FALL_ANIMATION = 4164;
const DIZZY_GRAPHIC = 80;
const KEY_INTERFACE = 412;
const CATAPULT_KEY_INTERFACE = 410;
const VIEW_DISTANCE = 15;

const STAB = 0;
const SLASH = 1;
const CRUSH = 2;

/**
 * The dummies in Wiki order (accurate, slash, aggressive, controlled, crush, stab, defensive),
 * each with the hole it rises from. The controlled dummy pops up in two holes at once.
 */
let DUMMIES = [];

function buildDummies() {
  const Objects = Guild.core.ObjectIdentifiers;
  const { FightStyle } = Guild.core;
  const style = (wanted) => (type) => type.getStyle() === wanted;
  const attack = (wanted) => (type) => type.getBonusType() === wanted;
  return [
    { id: Objects.DUMMY_5, hole: Objects.HOLE_33, tiles: [[2856, 3554, 0]], hits: style(FightStyle.ACCURATE) },
    { id: Objects.DUMMY_6, hole: Objects.HOLE_34, tiles: [[2858, 3554, 0]], hits: attack(SLASH) },
    { id: Objects.DUMMY_7, hole: Objects.HOLE_35, tiles: [[2860, 3553, 1]], hits: style(FightStyle.AGGRESSIVE) },
    { id: Objects.DUMMY_8, hole: Objects.HOLE_36, tiles: [[2860, 3551, 1], [2855, 3552, 3]], hits: style(FightStyle.CONTROLLED) },
    { id: Objects.DUMMY_9, hole: Objects.HOLE_37, tiles: [[2859, 3549, 2]], hits: attack(CRUSH) },
    { id: Objects.DUMMY_10, hole: Objects.HOLE_38, tiles: [[2857, 3549, 2]], hits: attack(STAB) },
    { id: Objects.DUMMY_11, hole: Objects.HOLE_39, tiles: [[2855, 3550, 3]], hits: style(FightStyle.DEFENSIVE) },
  ];
}

/** The dummy that is up, the ticks it has left, and who has hit it. */
const round = { dummy: null, ticks: 0, hitBy: new Set() };

/** Each dummy's map holes and the dummy locs that replace them, made once. */
function locsOf(dummy) {
  if (!dummy.locs) {
    const { GameObject, MapObjects } = Guild.core;
    dummy.locs = dummy.tiles.map(([x, y, face]) => {
      const at = Guild.tile(x, y, 0);
      return {
        hole: MapObjects.get(dummy.hole, at, null) ?? new GameObject(dummy.hole, at, 10, face, null),
        dummy: new GameObject(dummy.id, at, 10, face, null),
      };
    });
  }
  return dummy.locs;
}

/** Swaps one loc for another on its tile, as Motherlode's veins do. */
function swap(from, to) {
  const { MapObjects, ObjectManager } = Guild.core;
  MapObjects.remove(from);
  ObjectManager.deregister(from, false);
  ObjectManager.register(to, true);
}

function popUp(dummy) {
  for (const { hole, dummy: loc } of locsOf(dummy)) swap(hole, loc);
}

function popDown(dummy) {
  for (const { hole, dummy: loc } of locsOf(dummy)) swap(loc, hole);
}

function nearbyPlayers() {
  const players = [];
  for (const player of Guild.core.World.getPlayers()) {
    const at = player?.getLocation();
    if (at && at.getZ() === 0 && Math.abs(at.getX() - 2858) <= VIEW_DISTANCE && Math.abs(at.getY() - 3552) <= VIEW_DISTANCE) {
      players.push(player);
    }
  }
  return players;
}

function tick() {
  if (round.ticks === 0) {
    round.dummy = DUMMIES[Guild.random(0, DUMMIES.length - 1)];
    round.ticks = Guild.random(4, 15);
    round.hitBy.clear();
    popUp(round.dummy);
  } else if (round.ticks === 2) {
    const fall = new Guild.core.Animation(FALL_ANIMATION);
    for (const player of nearbyPlayers()) {
      for (const { dummy } of locsOf(round.dummy)) player.getPacketSender().sendObjectAnimation(dummy, fall);
    }
  } else if (round.ticks === 1) {
    popDown(round.dummy);
  }
  round.ticks--;
}

function hitDummy({ player, objectId }) {
  if (!DUMMIES.some((candidate) => candidate.id === objectId)) return false;
  const dummy = round.dummy;
  if (!dummy || dummy.id !== objectId || round.ticks <= 1) return;
  if (round.hitBy.has(player)) {
    player.sendMessage("You already hit a dummy this turn.");
    return;
  }
  const fightType = player.getFightType();
  if (fightType.getBonusType() > CRUSH) {
    player.sendMessage("You can only use melee weapons in this minigame.");
    return;
  }
  round.hitBy.add(player);
  const right = dummy.hits(fightType);
  player.performAnimation(new Guild.core.Animation(fightType.getAnimation()));
  Guild.later(player, 1, () => {
    if (right) {
      player.getSkillManager().addExperiences(Guild.core.Skill.ATTACK, ATTACK_XP);
      Guild.credit(player, TOKENS);
      player.sendMessage("You whack the dummy successfully!");
      return;
    }
    player.sendMessage("You whack the dummy with the wrong attack style.");
    player.performGraphic(new Guild.core.Graphic(DIZZY_GRAPHIC, Guild.core.GraphicHeight.HIGH));
    player.getMovementQueue().reset();
    player.getTimers().registers(Guild.core.TimerKey.STUN, STUN_TICKS);
  });
}

function viewDummyKey({ player }) {
  player.getPacketSender().sendInterface(KEY_INTERFACE);
}

function viewCatapultKey({ player }) {
  player.getPacketSender().sendInterface(CATAPULT_KEY_INTERFACE);
}

function start() {
  Guild.every(null, tick);
}

function viewScroll(event) {
  const Objects = Guild.core.ObjectIdentifiers;
  if (event.objectId === Objects.INFORMATION_SCROLL_2) return viewDummyKey(event);
  if (event.objectId === Objects.INFORMATION_SCROLL_3) return viewCatapultKey(event);
  return false;
}

module.exports = function attachDummies(api) {
  DUMMIES = buildDummies();
  api.onServerStartup(start);
  api.onObjectInteraction("Dummy", { Hit: hitDummy });
  api.onObjectInteraction("Information Scroll", { View: viewScroll });
};
