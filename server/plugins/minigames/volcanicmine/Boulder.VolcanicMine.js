/**
 * The boulder down the central channel. Recorded (rsprox 1858 G3): the attached Giant Boulder at
 * (3804,10124) breaks off, its tiles turn to lava, and it floats a tile a tick to (3804,10133); that
 * one breaks and the Large Boulder floats to (3805,10148). The Wiki gives the rest: five stages
 * (Giant attached, Giant, Large, Medium, Small) of 40 HP a player (the Small 60), a fragment
 * chance per chip by stage and the ore by Mining level, and +100 points for everyone when the
 * last of it falls into the lava vortex.
 *
 * Mining (recorded): "You swing your pick at the rock." and the swing the tick after the click, then
 * a chip with sound 3600 every pickaxe interval (3 ticks with a dragon pickaxe, sometimes 2): +1
 * point, 5 Mining XP, and sometimes a fragment with its points, XP and a side find.
 */
const Common = require("./Common.VolcanicMine");
const Game = require("./Game.VolcanicMine");

const ORES = ["iron", "silver", "coal", "gold", "mithril", "adamantite", "runite"];

function stageHp(game, stage) {
  return stage.hp * Math.max(1, game.players.size);
}

/** At the start: the attached boulder is put in the channel. */
function begin(game) {
  const [first] = Common.data.boulder.stages;
  game.boulder = { stage: 0, hp: stageHp(game, first), loc: null, moving: false, done: false };
  game.boulder.loc = game.setLoc(first.loc, first.tile, 10, first.face);
}

function spawn(game, id, tile) {
  const at = game.area.at(tile);
  const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0 });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  npc.getMovementQueue?.().setBlockMovement?.(true);
  game.area.add(npc);
  game.area.spawned.push(npc);
  return npc;
}

function despawn(game, npc) {
  if (!npc) return;
  game.area.detach?.(npc);
  game.area.spawned = game.area.spawned.filter((entry) => entry !== npc);
  Common.api.removeNpc(npc);
}

/** A floating boulder npc from `from` to `to`, a tile a tick; then `done`. */
function float(game, id, from, to, done) {
  const npc = spawn(game, id, from);
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  let tile = [...from];
  const step = () => {
    if (game.ended) return;
    if (tile[0] === to[0] && tile[1] === to[1]) {
      despawn(game, npc);
      done();
      return;
    }
    tile = [tile[0] + (tile[0] !== to[0] ? dx : 0), tile[1] + (tile[1] !== to[1] ? dy : 0), tile[2]];
    npc?.exactMove(game.area.at(tile));
    Common.later(1, step);
  };
  Common.later(1, step);
}

/** The stage is mined out: it breaks, and the next floats down to its stop. */
function breakStage(game) {
  const { boulder: data, locs } = Common.data;
  const boulder = game.boulder;
  const stage = data.stages[boulder.stage];
  boulder.moving = true;
  game.removeLoc(boulder.loc);
  boulder.loc = null;
  const breaking = spawn(game, stage.breaking, stage.tile);
  if (breaking) {
    const id = Common.core.CacheDefinitions.getSeqId(stage.breakSeq);
    if (id != null) breaking.performAnimation(new Common.core.Animation(id));
  }
  Common.later(2, () => despawn(game, breaking));
  if (boulder.stage === 0) {
    for (const [x, y] of data.attachedLava) game.setLoc(locs.lava, [x, y, stage.tile[2]]);
  }
  const nextIndex = boulder.stage + 1;
  const next = data.stages[nextIndex];
  if (!next) {
    float(game, data.tiny.npc, data.tiny.from, data.tiny.to, () => vortex(game));
    return;
  }
  float(game, next.floating, next.from, next.tile, () => {
    if (game.ended) return;
    boulder.stage = nextIndex;
    boulder.hp = stageHp(game, next);
    boulder.loc = game.setLoc(next.loc, next.tile, 10, next.face);
    boulder.moving = false;
  });
}

function vortex(game) {
  game.boulder.done = true;
  for (const player of game.players) {
    player.sendMessage(Common.message("vortex"));
    game.addPoints(player, Common.data.points.vortex);
  }
}

/** The Wiki's ore for a fragment at this Mining level (the nearest lower level's row). */
function rollOre(level) {
  const rows = Common.data.fragmentTypes;
  let row = rows[0][1];
  for (const [min, chances] of rows) if (level >= min) row = chances;
  return Common.weighted(Object.entries(row));
}

/** A fragment's side find (Wiki): calcite or pyrophosphite at 1/10, else the fossil table. */
function sideFind(player) {
  const { items, sideDrops } = Common.data;
  if (Math.random() < 1 / sideDrops.mineral) {
    const mineral = Math.random() < 0.5 ? "calcite" : "pyrophosphite";
    player.getInventory().adds(items[mineral], Common.randomInt(...sideDrops.mineralAmount));
    player.sendMessage(Common.message("mineral", { mineral: mineral === "calcite" ? "Calcite" : "Pyrophosphite" }));
    return;
  }
  if (Math.random() < sideDrops.numulite[0] / sideDrops.numulite[1]) {
    player.getInventory().adds(items.numulite, Common.randomInt(...sideDrops.numuliteAmount));
    player.sendMessage(Common.message("numulite"));
    return;
  }
  // Content may make fossils commoner ("minigame:chance", a league fragment): `multiplier` times.
  const fossils = { player, minigame: "fossil-island", kind: "fossil", multiplier: 1 };
  Common.api?.emitCustomEvent?.("minigame:chance", fossils);
  for (const [size, weight, outOf] of sideDrops.fossils) {
    if (Math.random() < (weight * Math.max(1, fossils.multiplier)) / outOf) {
      // A fossil the player had Peter block is not given (Ours: nothing replaces it).
      const drop = { player, itemId: items.fossils[size], blocked: false };
      Common.api?.emitCustomEvent?.("fossil-island:fossil-drop", drop);
      if (drop.blocked) return;
      player.getInventory().adds(items.fossils[size], 1);
      player.sendMessage(Common.message("fossil"));
      return;
    }
  }
}

function chip(game, player) {
  const { data } = Common;
  const boulder = game.boulder;
  const stage = data.boulder.stages[boulder.stage];
  boulder.hp--;
  if (Math.random() < 1 / stage.fragment) {
    const ore = rollOre(Common.maxLevel(player, "MINING"));
    if (player.getInventory().getFreeSlots() > 0) {
      player.getInventory().adds(data.items.fragments[ore], 1);
      const name = ore[0].toUpperCase() + ore.slice(1);
      Common.spam(player, Common.message("fragment", { ore: name }));
      Common.xp(player, "MINING", data.xp.fragments[ore]);
      game.addPoints(player, data.points.fragments[ore]);
      sideFind(player);
    } else {
      // Wiki: a full inventory turns a fragment into a plain chip.
      Common.spam(player, Common.message("chip"));
      Common.xp(player, "MINING", data.xp.chip);
      game.addPoints(player, data.points.chip);
    }
  } else {
    Common.spam(player, Common.message("chip"));
    Common.xp(player, "MINING", data.xp.chip);
    game.addPoints(player, data.points.chip);
  }
  if (boulder.hp <= 0) breakStage(game);
}

function mine(event) {
  const { player } = event;
  const game = Game.gameOf(player);
  if (!game?.boulder || game.boulder.moving || game.boulder.done || game.phase !== "running") return Boolean(game);
  const pickaxe = Common.bestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
    return true;
  }
  const from = player.getLocation();
  const stageAt = game.boulder.stage;
  const current = game.act(player);
  const token = game.actions.get(player);
  const mining = () => current(token) && Game.gameOf(player) === game && game.phase === "running"
    && !game.boulder.moving && game.boulder.stage === stageAt && player.getLocation().equals(from);
  const swing = () => {
    // As Mining does each tick: a pickaxe dropped or banked mid-swing ends it; a better one picked up is used.
    const held = mining() && Common.bestPickaxe(player);
    if (!held) return;
    player.performAnimation(held.animation);
    Common.sound(player, "pick");
    chip(game, player);
    Common.later(Common.rollInterval(held), swing);
  };
  Common.later(1, () => {
    const held = mining() && Common.bestPickaxe(player);
    if (!held) return;
    Common.spam(player, Common.message("swing"));
    player.performAnimation(held.animation);
    Common.later(Common.rollInterval(held), swing);
  });
  return true;
}

function attachBoulder(api) {
  Game.onStart(begin);
  api.onObjectClick(Common.data.locs.boulders, 1, mine);
}

module.exports = { attachBoulder, rollOre, begin, breakStage, chip, ORES };
