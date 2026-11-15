/**
 * Vet'ion and Calvar'ion (https://oldschool.runescape.wiki/w/Vet'ion/Strategies,
 * https://oldschool.runescape.wiki/w/Calvar'ion/Strategies), as captured
 * (docs/wilderness-bosses.md):
 *
 * - Lightning, every attack he isn't bashing (a magic or a melee swing, said aloud): a bolt on or
 *   next to each player in the lair (up to 7) and 4 more around him, shown where they will land;
 *   3 ticks later each strikes its 3x3, hardest on its own tile.
 * - Shield bash ("Too close!"), only next to a player: shadows on one side (2 deep), a corner, or
 *   all round him; 3 ticks later those standing in them are hit and staggered ("The shield bash
 *   staggers you, slowing your next attack!": 8 ticks before they may attack).
 * - At half health he calls two skeleton hellhounds 3 ticks later; until they are dead he takes no
 *   damage (and only a tenth before they come). Their death gets a line from him.
 * - At 0 in his first form he can't die: "Now... DO IT AGAIN!!!", a ring of orange bolts 3 tiles
 *   out, and 4 ticks on he is back at full health in his second form, attacking every 5 ticks
 *   instead of 6, harder, in capitals. Dying in that form ends the fight.
 * - His coffin shows his state: whole while he lives, cracked in his second form, open when dead.
 */
const Common = require("./Common.WildernessBosses");
const Caves = require("./Caves.WildernessBosses");

const SIZE = 3;

const BOSSES = Object.freeze({
  6611: Object.freeze({
    key: "vetion", trans: 12002, second: 6612, hounds: [6613, 6614],
    bolt: 30, splash: 15, bash: 35, coffin: [3293, 10210, 1],
  }),
  11993: Object.freeze({
    key: "calvarion", trans: 11995, second: 11994, hounds: [12107, 12108],
    bolt: 26, splash: 13, bash: 26, coffin: [1885, 11554, 1],
  }),
});
/** The second form hits a quarter harder (Vet'ion's 35 bash becomes the Wiki's 44). */
const SECOND_FORM_DAMAGE = 1.25;

const ANIMATION = Object.freeze({
  magic: [9969, 9970], // npc_vetion_attack_magic_01/02
  melee: [9971, 9972], // npc_vetion_attack_melee_01/02
  bash: [9973, 9974], // npc_vetion_defend_parry_01/02
  hounds: [9975, 9976], // npc_vetion_defend_shield_01/02
  spawn: 9977,
  enrage: 9978,
});
const GRAPHIC = Object.freeze({
  cast: [2344, 2345], // fx_vetion_attack_magic_01/02, on him
  swing: 2348, // fx_vetion_attack_melee
  bolt: [2346, 2347], // fx_vetion_attack_magic_impact_01/02, on the tiles
  shadow: 1446, // gargboss_debris_shadow_90
  dust: 2184, // zebak_roar_wave_dust
});
const SPEED = Object.freeze({ first: 6, second: 5 });
const FIRST_ATTACK_TICKS = 5;
const STRIKE_TICKS = 3;
const RANDOM_BOLTS = 4;
const MAX_TARGETED_BOLTS = 7;
const BOLT_RANGE = 8;
/** Captured: about one attack in six next to a player is the bash. */
const BASH_CHANCE = 1 / 6;
const STAGGER_TICKS = 8;
const HOUNDS = 2;
const HOUND_DELAY_TICKS = 3;
const HOUND_RANGE = 6;
const RESISTANCE_BEFORE_HOUNDS = 0.1;
const REBIRTH = Object.freeze({ trans: 1, ring: 2, enrage: 3, second: 5 });
const COFFIN = Object.freeze({ whole: 43108, cracked: 46910, open: 46911 });

const LINES = Object.freeze({
  bolt: ["Hold still so I can smite you!", "I will smite you!", "Perish, fool!", "You're mine now!", "Stand still, rat!",
    "Raaargh!", "Die!", "Die, rodent!", "You call that a weapon?!", "I've got you now!", "For the lord!", "Dodge this!",
    "Time to die, mortal!", "You can't escape!", "I will cut you down!", "I will end you!", "Filthy whelps!",
    "You are weak! You are feeble!", "You are powerless to me!"],
  bash: ["Too close!", "Defend yourself!", "Grrrah!", "You're not blocking this one!", "Hands off, wretch!",
    "Back off, mutt!", "Take this!", "Now I've got you!"],
  hounds: ["Hounds! Get rid of these interlopers!", "Hounds! Dispose of these tresspassers!", "I've had enough of this! Hounds!",
    "Go forth, my hounds, and destroy them!", "Time to feast, hounds!", "Gah! Hounds! Get them!"],
  houndsDead: ["Fine! I'll deal with you myself!", "My hounds! I'll make you pay for that!",
    "I'll kill you for killing my pets!", "Must I do everything around here?!"],
  death: ["This isn't... the last... of me...", "Urk! I... failed...", "I'll... be... back...",
    "Urgh... not... again...", "My lord... I'm... sorry..."],
});
const REBIRTH_LINE = "Now... DO IT AGAIN!!!";
const STAGGER_MESSAGE = "The shield bash staggers you, slowing your next attack!";

let api = null;
let core = null;
/** boss npc -> { form, hounds: NPC[], houndsCalled, reborn } */
const fights = new WeakMap();

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** By his own id: getId() answers with the form he has taken. */
function bossOf(npc) {
  return BOSSES[npc?.getRealId?.()] ?? null;
}

function fightOf(npc) {
  let fight = fights.get(npc);
  if (!fight) {
    fight = { form: 1, hounds: [], houndsCalled: false, houndsPending: false, reborn: false };
    fights.set(npc, fight);
  }
  return fight;
}

/** A line in his voice: shouted in his second form. */
function say(npc, fight, line) {
  npc.forceChat(fight.form === 2 ? line.toUpperCase() : line);
}

function lairPlayers(boss) {
  return Caves.playersIn(boss.key).filter(Common.alive);
}

function toLair(boss, send) {
  for (const player of Caves.playersIn(boss.key)) send(player);
}

function tileGraphic(boss, id, location, delay = 0) {
  toLair(boss, (player) => player.getPacketSender().sendGlobalGraphic(core.Graphic.delayed(id, delay), location));
}

function centre(npc) {
  const base = npc.getLocation();
  return { x: base.getX() + 1, y: base.getY() + 1, z: base.getZ() };
}

function chebyshev(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function scaled(fight, value) {
  return fight.form === 2 ? Math.round(value * SECOND_FORM_DAMAGE) : value;
}

// ------------------------------------------------------------------ lightning

function boltTiles(npc, boss) {
  const tiles = [];
  const from = centre(npc);
  for (const player of lairPlayers(boss).slice(0, MAX_TARGETED_BOLTS)) {
    const at = player.getLocation();
    const x = at.getX() + Common.randomBetween(-1, 1);
    const y = at.getY() + Common.randomBetween(-1, 1);
    tiles.push(Common.open(x, y, at.getZ()) ? new core.Location(x, y, at.getZ()) : at.clone());
  }
  for (let tries = 0, added = 0; added < RANDOM_BOLTS && tries < 100; tries++) {
    const x = from.x + Common.randomBetween(-BOLT_RANGE, BOLT_RANGE);
    const y = from.y + Common.randomBetween(-BOLT_RANGE, BOLT_RANGE);
    if (!Common.open(x, y, from.z)) continue;
    tiles.push(new core.Location(x, y, from.z));
    added++;
  }
  return tiles;
}

/** Bolts strike 3 ticks after they show: full on the tile, the splash around it. */
function strike(npc, method, boss, fight, tiles, form) {
  Common.later(STRIKE_TICKS, () => {
    if (!npc.isRegistered()) return;
    for (const player of lairPlayers(boss)) {
      const at = player.getLocation();
      let nearest = Infinity;
      for (const tile of tiles) {
        if (tile.getZ() === at.getZ()) nearest = Math.min(nearest, chebyshev(tile.getX(), tile.getY(), at.getX(), at.getY()));
      }
      if (nearest > 1) continue;
      const max = nearest === 0 ? boss.bolt : boss.splash;
      Common.bossHit(npc, method, player, Common.randomBetween(0, form === 2 ? Math.round(max * SECOND_FORM_DAMAGE) : max));
    }
  }, npc);
}

function lightning(npc, method, boss, fight) {
  const swing = Math.random() < 0.5;
  const index = fight.form - 1;
  npc.performAnimation(new core.Animation(swing ? ANIMATION.melee[index] : ANIMATION.magic[index], 30));
  npc.performGraphic(new core.Graphic(swing ? GRAPHIC.swing : GRAPHIC.cast[index], 30));
  say(npc, fight, pick(LINES.bolt));
  const tiles = boltTiles(npc, boss);
  for (const tile of tiles) tileGraphic(boss, GRAPHIC.bolt[index], tile);
  strike(npc, method, boss, fight, tiles, fight.form);
}

// ------------------------------------------------------------------ shield bash

/**
 * The captured shapes, from his south-west tile: a side two deep (widening by a tile each row), a
 * corner's two-deep L, or a ring one deep all round.
 */
function bashTiles(npc, target) {
  const base = npc.getLocation();
  const bx = base.getX();
  const by = base.getY();
  const z = base.getZ();
  const at = target.getLocation();
  const sx = at.getX() < bx ? -1 : at.getX() > bx + SIZE - 1 ? 1 : 0;
  const sy = at.getY() < by ? -1 : at.getY() > by + SIZE - 1 ? 1 : 0;
  const shape = Math.random() < 1 / 3 ? "ring" : sx !== 0 && sy !== 0 ? "corner" : "side";
  const tiles = [];
  for (let x = bx - 2; x <= bx + SIZE + 1; x++) {
    for (let y = by - 2; y <= by + SIZE + 1; y++) {
      const distance = Common.edgeDistance(npc, x, y);
      if (distance < 1 || distance > 2) continue;
      let hit = false;
      if (shape === "ring") {
        hit = distance === 1;
      } else if (shape === "corner") {
        const nearX = sx < 0 ? x <= bx + SIZE - 2 : x >= bx + 1;
        const nearY = sy < 0 ? y <= by + SIZE - 2 : y >= by + 1;
        hit = nearX && nearY;
      } else if (sx !== 0) {
        const depth = sx < 0 ? bx - x : x - (bx + SIZE - 1);
        hit = depth >= 1 && y >= by - depth && y <= by + SIZE - 1 + depth;
      } else {
        const depth = sy < 0 ? by - y : y - (by + SIZE - 1);
        hit = depth >= 1 && x >= bx - depth && x <= bx + SIZE - 1 + depth;
      }
      if (hit) tiles.push({ location: new core.Location(x, y, z), distance });
    }
  }
  return tiles;
}

function bash(npc, method, boss, fight, target) {
  npc.performAnimation(new core.Animation(ANIMATION.bash[fight.form - 1], 60));
  say(npc, fight, pick(LINES.bash));
  const tiles = bashTiles(npc, target);
  for (const { location } of tiles) tileGraphic(boss, GRAPHIC.shadow, location);
  Common.later(STRIKE_TICKS, () => {
    if (!npc.isRegistered()) return;
    for (const { location, distance } of tiles) tileGraphic(boss, GRAPHIC.dust, location, distance === 1 ? 2 : 4);
    const struck = new Set(tiles.map(({ location }) => `${location.getX()},${location.getY()}`));
    for (const player of lairPlayers(boss)) {
      const at = player.getLocation();
      if (!struck.has(`${at.getX()},${at.getY()}`)) continue;
      Common.bossHit(npc, method, player, Common.randomBetween(0, scaled(fight, boss.bash)));
      player.sendMessage(STAGGER_MESSAGE);
      player.getCombat().extendAttackDelay(STAGGER_TICKS);
    }
  }, npc);
}

// ------------------------------------------------------------------ hellhounds

function callHounds(npc, boss, fight) {
  fight.houndsPending = false;
  if (!Common.alive(npc) || fight.reborn) return;
  npc.performAnimation(new core.Animation(ANIMATION.hounds[fight.form - 1]));
  say(npc, fight, pick(LINES.hounds));
  const from = centre(npc);
  const players = lairPlayers(boss);
  for (let i = 0, tries = 0; i < HOUNDS && tries < 100; tries++) {
    const x = from.x + Common.randomBetween(-HOUND_RANGE, HOUND_RANGE);
    const y = from.y + Common.randomBetween(-HOUND_RANGE, HOUND_RANGE);
    if (!Common.open(x, y, from.z) || Common.edgeDistance(npc, x, y) < 2) continue;
    const hound = core.NPC.create(boss.hounds[fight.form - 1], new core.Location(x, y, from.z));
    hound.__skipDefaultRespawn = true;
    hound.__wildernessBoss = npc;
    hound.getMovementCoordinator?.().setRadius?.(20);
    // Always multi, so in the singles tomb too they join his fight without tying anyone up.
    hound.setMultiCombat(true);
    core.World.getAddNPCQueue().push(hound);
    fight.hounds.push(hound);
    const target = npc.getCombat().getTarget() ?? players[i % Math.max(1, players.length)];
    if (target) Common.engage(hound, target);
    i++;
  }
}

function houndsAlive(fight) {
  fight.hounds = fight.hounds.filter((hound) => hound.isRegistered() && hound.getHitpoints() > 0);
  return fight.hounds.length > 0;
}

function houndDied({ npc }) {
  const boss = npc?.__wildernessBoss;
  if (!boss) return;
  const fight = fights.get(boss);
  if (!fight || !Common.alive(boss)) return;
  if (fight.hounds.some((hound) => hound !== npc && hound.isRegistered() && hound.getHitpoints() > 0)) return;
  Common.later(1, () => Common.alive(boss) && say(boss, fight, pick(LINES.houndsDead)), boss);
}

function dismissHounds(fight) {
  for (const hound of fight.hounds) {
    if (hound.isRegistered()) core.World.getRemoveNPCQueue().push(hound);
  }
  fight.hounds = [];
}

// ------------------------------------------------------------------ his rebirth and death

function setCoffin(boss, id) {
  const [x, y, z] = boss.coffin;
  api.getObjectManager().register(new core.GameObject(id, new core.Location(x, y, z), 10, 0, null), true);
}

function ringTiles(npc) {
  const from = centre(npc);
  const offsets = [[-3, 1], [-2, 2], [-1, 3], [1, 3], [2, 2], [3, 1], [3, -1], [2, -2], [1, -3], [-1, -3], [-2, -2], [-3, -1]];
  return offsets.map(([dx, dy]) => new core.Location(from.x + dx, from.y + dy, from.z));
}

/** His second form shakes off the first form's drains (Wiki: he resets stat reductions on changing). */
function restoreStats(npc) {
  const { ATTACK, STRENGTH, DEFENCE, MAGIC, RANGED } = core.Skill;
  for (const skill of [ATTACK, STRENGTH, DEFENCE, MAGIC, RANGED]) {
    npc.setCurrentLevels(skill, npc.getMaxLevel(skill));
  }
}

/** His first death: reborn in his second form, with a ring of bolts as he rises. */
function rebirth(npc, method, boss, fight) {
  fight.reborn = true;
  dismissHounds(fight);
  npc.getCombat().reset();
  Common.later(REBIRTH.trans, () => npc.setNpcTransformationId(boss.trans), npc);
  Common.later(REBIRTH.ring, () => {
    if (!npc.isRegistered()) return;
    npc.forceChat(REBIRTH_LINE);
    const tiles = ringTiles(npc);
    for (const tile of tiles) tileGraphic(boss, GRAPHIC.bolt[1], tile);
    strike(npc, method, boss, fight, tiles, 1);
  }, npc);
  Common.later(REBIRTH.enrage, () => {
    if (!npc.isRegistered()) return;
    npc.performAnimation(new core.Animation(ANIMATION.enrage));
    npc.performGraphic(new core.Graphic(GRAPHIC.cast[1]));
    setCoffin(boss, COFFIN.cracked);
  }, npc);
  Common.later(REBIRTH.second, () => {
    if (!npc.isRegistered()) return;
    npc.setNpcTransformationId(boss.second);
    npc.setHitpoints(npc.getMaxHitpoints());
    restoreStats(npc);
    fight.form = 2;
    fight.houndsCalled = false;
    fight.houndsPending = false;
    fight.reborn = false;
    npc.getCombat().setAttackDelay(STRIKE_TICKS);
  }, npc);
}

function beforeDeath(event) {
  const { npc } = event;
  const boss = bossOf(npc);
  if (boss) {
    const fight = fightOf(npc);
    if (fight.form === 1) {
      event.preventDeath = true;
      if (!fight.reborn) rebirth(npc, fight.method ?? new (combatClass())(), boss, fight);
      return;
    }
    say(npc, fight, pick(LINES.death));
    dismissHounds(fight);
    setCoffin(boss, COFFIN.open);
    return;
  }
  if (npc?.__wildernessBoss) houndDied({ npc });
}

/** No damage while his hounds live or he rises; a tenth below half health before they come. */
function hitModify({ npc, hit }) {
  const boss = bossOf(npc);
  if (!boss) return;
  const fight = fightOf(npc);
  const parts = hit.getHits?.() ?? [];
  const incoming = parts.reduce((sum, part) => sum + (part.getDamage?.() ?? 0), 0);
  if (fight.reborn || houndsAlive(fight)) {
    for (const part of parts) part.setDamage(0);
    hit.updateTotalDamage?.();
    return;
  }
  const half = npc.getMaxHitpoints() / 2;
  if (fight.houndsCalled && !fight.houndsPending) return;
  if (npc.getHitpoints() <= half) {
    for (const part of parts) part.setDamage(Math.floor((part.getDamage?.() ?? 0) * RESISTANCE_BEFORE_HOUNDS));
    hit.updateTotalDamage?.();
    return;
  }
  if (npc.getHitpoints() - incoming > half) return;
  fight.houndsCalled = true;
  fight.houndsPending = true;
  Common.later(HOUND_DELAY_TICKS, () => callHounds(npc, boss, fight), npc);
}

// ------------------------------------------------------------------ the combat method

function combatClass() {
  const { CombatMethod, CombatType } = core;
  return class VetionCombat extends CombatMethod {
    start(character, target) {
      const npc = character.getAsNpc();
      const boss = bossOf(npc);
      this.npc = npc;
      if (!boss || !target?.isPlayer?.()) return;
      const fight = fightOf(npc);
      fight.method = this;
      if (fight.reborn) {
        character.getCombat().setAttackDelay(1);
        return;
      }
      npc.setPositionToFace(target.getLocation());
      const at = target.getLocation();
      if (Common.edgeDistance(npc, at.getX(), at.getY()) === 1 && Math.random() < BASH_CHANCE) bash(npc, this, boss, fight, target);
      else lightning(npc, this, boss, fight);
      character.getCombat().setAttackDelay(fight.form === 2 ? SPEED.second : SPEED.first);
    }

    hits() {
      return [];
    }

    attackDistance() {
      return 10;
    }

    type() {
      return CombatType.MAGIC;
    }
  };
}

/** An abandoned fight (Caves): his hounds go, and he is back in his first form, coffin whole. */
function reset(npc) {
  const boss = bossOf(npc);
  if (!boss) return;
  const fight = fightOf(npc);
  dismissHounds(fight);
  Object.assign(fight, { form: 1, houndsCalled: false, houndsPending: false, reborn: false });
  npc.setNpcTransformationId(-1);
  setCoffin(boss, COFFIN.whole);
}

function spawned(npc) {
  const boss = bossOf(npc);
  if (!boss) return;
  const fight = fightOf(npc);
  dismissHounds(fight);
  Object.assign(fight, { form: 1, houndsCalled: false, houndsPending: false, reborn: false });
  npc.setFlag("combat:close-in");
  npc.setFlag("combat:no-regen");
  npc.performAnimation(new core.Animation(ANIMATION.spawn));
  npc.getCombat().setAttackDelay(FIRST_ATTACK_TICKS);
  setCoffin(boss, COFFIN.whole);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.registerNpcCombatMethodProvider(Object.keys(BOSSES).map(Number), combatClass(), { singleton: false });
  pluginApi.onNpcHitModify(hitModify);
  pluginApi.onNpcBeforeDeath(beforeDeath);
  for (const boss of Object.values(BOSSES)) Common.FIGHTS.set(boss.key, { spawned, reset });
}

module.exports = { attach, _test: { BOSSES, bashTiles, ringTiles, restoreStats, tileGraphic } };
