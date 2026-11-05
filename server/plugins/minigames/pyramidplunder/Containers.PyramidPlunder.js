"use strict";

/**
 * The room containers: urns, the Grand Gold Chest and the sarcophagus.
 *
 * - **Urns** (ntk_urn_type*_multi_1..15; per-player varbit ntk_urnN_state: 0 closed,
 *   1 searched, 2 snake showing, 3 snake charmed). Search may be bitten (1-4 damage and
 *   poison); Check for Snakes shows the snake; a snake charm makes the search safe. A full
 *   search gives the room's urn XP; checking first splits it (1/3 then 2/3), and a charmed
 *   search pays 2/3 of that again (the Wiki: "only about 2/3rds").
 * - **Grand Gold Chest** (ntk_golden_chest_multi; ntk_golden_chest_state): always opens. A
 *   scarab swarm may come out instead of the XP (3 damage, then the swarm attacks); the
 *   artefact and the sceptre roll happen either way.
 * - **Sarcophagus** (ntk_sarcophagus_multi; ntk_sarcophagus_state: 0 closed, 1 open,
 *   2 opening): a Strength roll every few ticks until the lid moves. Strength XP, an artefact,
 *   the sceptre roll and a (room/9) chance of a mummy that attacks only the opener.
 *
 * Each container opens once per room visit, guarded on the server as well as by its varbit,
 * so a repeated click or a reconnect can't loot it again. A search takes a few ticks, and a
 * click while the last one is still going is ignored. When the sceptre turns up, the run ends
 * first, so the artefact found with it lands outside rather than on the tomb floor.
 *
 * Timing from rsprox captures (recordings 545, 549, 552, 1788, 1843, 1857), in ticks after the
 * click: an urn search plays urn_search (busy on) at 1, the result at 2 (urn_search_success and
 * "You successfully loot the urn!", or urn_search_bit), then a loot's synth 1217 at 4 and the
 * artefact and the urn's varbit at 5 (busy off), or a bite's damage, synth 797 and line at 4.
 * The Grand Gold Chest opens a tick after the click. The sarcophagus: busy at 1, the first push
 * at 2 (ntk_sarcophagus_push on), a push every tick until the lid moves (ntk_tomb_open, area
 * sound 1218, state 2), and the artefact five ticks later (state 1, push off), with no message.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Urn_(Pyramid_Plunder),
 * https://oldschool.runescape.wiki/w/Grand_Gold_Chest,
 * https://oldschool.runescape.wiki/w/Sarcophagus_(Pyramid_Plunder)
 */

const Common = require("./Common.PyramidPlunder");
const Mural = require("./Mural.PyramidPlunder");

const URN_STATE = { CLOSED: 0, SEARCHED: 1, SNAKE: 2, CHARMED: 3 };
const SARCOPHAGUS = { CLOSED: 0, OPEN: 1, OPENING: 2 };
/** Ticks between sarcophagus pushes, and the most a single Open keeps pushing. */
const PUSH_TICKS = 1;
const MAX_PUSHES = 20;
/** The captured sarcophagus: busy a tick after the click, the first push a tick later, the loot five ticks after the lid. */
const LID = { busyAt: 1, firstPushAt: 2, lootAfter: 5 };
const SWARM_DAMAGE = 3;
/** Ticks a snake check or a chest search takes. */
const SEARCH_TICKS = 3;
/** The captured urn search, in ticks after the click. */
const URN = { searchAt: 1, resultAt: 2, biteAt: 4, soundAt: 4, lootAt: 5 };
const MUMMY_CHANCE_DIVISOR = 9;

/** The run and room this object belongs to, or null (and a message) when it isn't this run's. */
function runFor(event) {
  const run = Common.sessionOf(event.player);
  if (!run) return null;
  const at = event.location;
  if (Common.roomAt(at.x, at.y, at.z) !== run.room) return null;
  return run;
}

function animate(player, animation) {
  player.performAnimation(new (Common.getCore().Animation)(animation));
}

/** The bite itself: the damage, synth 797, the line and the poison. */
function bite(player, random) {
  const { CombatFactory } = Common.getCore();
  Common.hit(player, Common.rollHit(random));
  Common.sound(player, Common.ids().sound.bitten);
  Common.spam(player, Common.MESSAGES.bitten);
  Common.spam(player, Common.MESSAGES.urnPoisoned);
  CombatFactory.poisonEntity(player, Common.rollHit(random));
}

/** A step of a search that is still this run's room: nothing happens once the player has left it. */
function inRoom(player, run, room) {
  return Common.sessionOf(player) === run && run.room === room;
}

// --- Urns

function urnVarbit(objectId) {
  return Common.ids().urns.get(objectId);
}

/** Search: closed (bite risk), with a snake showing (worse), or charmed (safe). */
function searchUrn(event, random = Math.random) {
  const varbit = urnVarbit(event.objectId);
  if (varbit === undefined) return false;
  const run = runFor(event);
  if (!run) return true;
  const player = event.player;
  const stage = Common.varbitOf(player, varbit);
  if (stage === URN_STATE.SEARCHED || run.cleared.has(`urn:${varbit}`)) {
    Common.spam(player, Common.MESSAGES.looted);
    return true;
  }
  if (!Common.takeAction(run, URN.lootAt)) return true;
  const roomNumber = run.room;
  const room = Common.roomData(roomNumber);
  const level = Common.thievingLevel(player);
  const chance = stage === URN_STATE.CHARMED ? 1
    : stage === URN_STATE.SNAKE ? Common.chanceOf("searchPastSnake", level, roomNumber)
      : Common.chanceOf("urnSearch", level, roomNumber);
  const step = (ticks, action) => Common.later(ticks, () => inRoom(player, run, roomNumber) && action());
  step(URN.searchAt, () => {
    animate(player, Common.ids().anim.urnSearch);
    Common.busy(player, true);
  });
  step(URN.resultAt, () => {
    if (!Common.roll(chance, random)) {
      animate(player, Common.ids().anim.urnBitten);
      step(URN.biteAt - URN.resultAt, () => {
        bite(player, random);
        Common.busy(player, false);
      });
      return;
    }
    if (!Common.claim(run, `urn:${varbit}`)) return;
    animate(player, Common.ids().anim.urnSuccess);
    Common.spam(player, Common.MESSAGES.urnLooted);
    step(URN.soundAt - URN.resultAt, () => Common.sound(player, Common.ids().sound.urnLooted));
    step(URN.lootAt - URN.resultAt, () => {
      const xp = stage === URN_STATE.CLOSED ? room.urnXp
        : stage === URN_STATE.SNAKE ? (room.urnXp * 2) / 3
          : (room.urnXp * 4) / 9;
      Common.send(player, varbit, URN_STATE.SEARCHED);
      Common.addXp(player, "THIEVING", xp);
      Common.giveArtefact(player, Common.rollUrnArtefact(roomNumber, random));
      Common.busy(player, false);
    });
  });
  return true;
}

/** Check for Snakes: shows the snake (a third of the urn's XP), or bites on a failed check. */
function checkUrn(event, random = Math.random) {
  const varbit = urnVarbit(event.objectId);
  if (varbit === undefined) return false;
  const run = runFor(event);
  if (!run) return true;
  const player = event.player;
  if (Common.varbitOf(player, varbit) !== URN_STATE.CLOSED) return true;
  if (!Common.takeAction(run, SEARCH_TICKS)) return true;
  if (!Common.roll(Common.chanceOf("checkForSnakes", Common.thievingLevel(player), run.room), random)) {
    animate(player, Common.ids().anim.urnBitten);
    bite(player, random);
    return true;
  }
  Common.send(player, varbit, URN_STATE.SNAKE);
  Common.spam(player, Common.MESSAGES.snake);
  Common.addXp(player, "THIEVING", Common.roomData(run.room).urnXp / 3);
  return true;
}

/** Charm Snake: always works with a snake charm (snake_flute) in the pack. */
function charmUrn(event) {
  const varbit = urnVarbit(event.objectId);
  if (varbit === undefined) return false;
  const run = runFor(event);
  if (!run) return true;
  const player = event.player;
  if (Common.varbitOf(player, varbit) !== URN_STATE.SNAKE) return true;
  if (player.getInventory().getAmount(Common.ids().item.snakeCharm) <= 0) {
    Common.spam(player, Common.MESSAGES.noCharm);
    return true;
  }
  animate(player, Common.ids().anim.charm);
  Common.send(player, varbit, URN_STATE.CHARMED);
  Common.spam(player, Common.MESSAGES.charmed);
  return true;
}

// --- The Grand Gold Chest

function searchChest(event, random = Math.random) {
  if (event.objectId !== Common.ids().chest) return false;
  const run = runFor(event);
  if (!run) return true;
  const player = event.player;
  const v = Common.ids().varbit;
  if (Common.varbitOf(player, v.chest) !== 0 || run.cleared.has("chest")) {
    Common.spam(player, Common.MESSAGES.looted);
    return true;
  }
  if (!Common.takeAction(run, SEARCH_TICKS) || !Common.claim(run, "chest")) return true;
  const roomNumber = run.room;
  // Captured: the chest opens a tick after the click.
  Common.later(1, () => inRoom(player, run, roomNumber) && openChest(player, run, random));
  return true;
}

function openChest(player, run, random) {
  const v = Common.ids().varbit;
  animate(player, Common.ids().anim.chest);
  Common.sound(player, Common.ids().sound.chest);
  Common.send(player, v.chest, 1);
  Mural.chestPillaged(player, run.room);
  const room = Common.roomData(run.room);
  const swarm = !Common.roll(Common.chanceOf("chestNoSwarm", Common.thievingLevel(player), run.room), random);
  if (swarm) {
    Common.spam(player, Common.MESSAGES.swarm);
    Common.hit(player, SWARM_DAMAGE);
    spawnHostile(player, Common.ids().npc.scarabs);
  } else {
    Common.addXp(player, "THIEVING", room.chestXp);
  }
  loot(player, run, Common.rollChestArtefact(run.room, random), random);
  // "pyramid-plunder:chest-searched" { player, room }: a room's Grand Gold Chest searched (a league's
  // "Search the Golden Chest in Room 8").
  Common.getApi()?.emitCustomEvent?.("pyramid-plunder:chest-searched", { player, room: run.room });
}

/** The sceptre roll comes first: finding it ends the run, then the artefact follows outside. */
function loot(player, run, artefact, random) {
  if (Common.rollSceptre(run.room, random)) Common.awardSceptre(player);
  Common.giveArtefact(player, artefact);
}

// --- The sarcophagus

function openSarcophagus(event, random = Math.random) {
  if (event.objectId !== Common.ids().sarcophagus) return false;
  const run = runFor(event);
  if (!run) return true;
  const player = event.player;
  const v = Common.ids().varbit;
  const stage = Common.varbitOf(player, v.sarcophagus);
  if (stage === SARCOPHAGUS.OPEN || run.cleared.has("sarcophagus")) {
    Common.spam(player, Common.MESSAGES.looted);
    return true;
  }
  if (stage === SARCOPHAGUS.OPENING || run.pushing) return true;
  if (Common.sarcophagusChance(Common.strengthLevel(player), run.room) <= 0) {
    player.sendMessage(Common.MESSAGES.sarcophagusWeak);
    return true;
  }
  run.pushing = true;
  const at = player.getLocation();
  const tile = { x: at.getX(), y: at.getY() };
  const lid = { x: event.location.x, y: event.location.y, z: event.location.z };
  Common.later(LID.busyAt, () => Common.sessionOf(player) === run && Common.busy(player, true));
  Common.later(LID.firstPushAt, () => push(player, run, tile, lid, 0, random));
  return true;
}

/** The open lid's Search: it's been looted. */
function searchOpenSarcophagus(event) {
  if (event.objectId !== Common.ids().sarcophagus) return false;
  Common.spam(event.player, Common.MESSAGES.looted);
  return true;
}

/** Stops pushing: walked off, gave up or the run ended. */
function stopPushing(player, run) {
  run.pushing = false;
  if (Common.sessionOf(player) !== run) return;
  Common.send(player, Common.ids().varbit.sarcophagusPush, 0);
  Common.busy(player, false);
}

/**
 * One push a tick, until the lid moves, the player walks off or the run ends. The first push
 * only pushes (and sets ntk_sarcophagus_push); each later tick rolls, and a hit opens the lid
 * instead of pushing again.
 */
function push(player, run, tile, lid, attempt, random) {
  if (Common.sessionOf(player) !== run || !run.pushing) return;
  const at = player.getLocation();
  if (at.getX() !== tile.x || at.getY() !== tile.y) {
    stopPushing(player, run);
    return;
  }
  if (attempt > 0 && Common.roll(Common.sarcophagusChance(Common.strengthLevel(player), run.room), random)) {
    lidOff(player, run, lid, random);
    return;
  }
  if (attempt >= MAX_PUSHES) {
    stopPushing(player, run);
    return;
  }
  animate(player, Common.ids().anim.push);
  if (attempt === 0) {
    Common.send(player, Common.ids().varbit.sarcophagusPush, 1);
    Common.busy(player, false);
  }
  Common.later(PUSH_TICKS, () => push(player, run, tile, lid, attempt + 1, random));
}

/** The lid moves (state 2, Strength XP); the artefact comes five ticks later with the open lid (state 1). */
function lidOff(player, run, lid, random) {
  const v = Common.ids().varbit;
  run.pushing = false;
  if (!Common.claim(run, "sarcophagus")) return;
  const room = run.room;
  // A room's sarcophagus opened (the Desert Diary's first-room task).
  Common.getApi()?.emitCustomEvent?.("pyramid-plunder:sarcophagus-opened", { player, room });
  Common.send(player, v.sarcophagus, SARCOPHAGUS.OPENING);
  animate(player, Common.ids().anim.lidOff);
  Common.areaSound(player, Common.ids().sound.lidArea, lid);
  Common.busy(player, true);
  Common.addXp(player, "STRENGTH", Common.roomData(room).sarcophagusXp);
  Common.later(LID.lootAfter, () => {
    if (!inRoom(player, run, room)) return;
    Common.send(player, v.sarcophagus, SARCOPHAGUS.OPEN);
    Common.send(player, v.sarcophagusPush, 0);
    Common.busy(player, false);
    const artefact = Common.rollSarcophagusArtefact(room, random);
    if (Common.roll(room / MUMMY_CHANCE_DIVISOR, random)) {
      Common.spam(player, Common.MESSAGES.mummy);
      spawnHostile(player, Common.ids().npc.mummy);
    }
    loot(player, run, artefact, random);
  });
}

/** A swarm or mummy beside the player, attacking only them; it goes when the run ends. */
function spawnHostile(player, npcId) {
  const api = Common.getApi();
  const at = player.getLocation();
  const npc = api.spawnNpc({ id: npcId, x: at.getX(), y: at.getY(), z: at.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
  if (!npc) return null;
  npc.getCombat?.().attack(player);
  const run = Common.sessionOf(player);
  if (run) (run.hostiles ??= []).push(npc);
  return npc;
}

module.exports = function registerContainers(api) {
  Common.bind(api);
  api.onObjectInteraction("Urn", { Search: searchUrn, "Check for Snakes": checkUrn, "Charm Snake": charmUrn });
  api.onObjectInteraction("Grand Gold Chest", { Search: searchChest });
  api.onObjectInteraction("Sarcophagus", { Open: openSarcophagus, Search: searchOpenSarcophagus });
};

module.exports._test = { URN, URN_STATE, LID, SARCOPHAGUS, SEARCH_TICKS, searchUrn, searchOpenSarcophagus, checkUrn, charmUrn, searchChest, openSarcophagus, spawnHostile };
