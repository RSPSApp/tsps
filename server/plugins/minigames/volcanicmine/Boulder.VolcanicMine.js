/**
 * The boulders in the mine's lava channels. The central one is recorded (rsprox 1858 G3): the
 * attached Giant Boulder at (3804,10124) breaks off, its tiles turn to lava, and it floats a tile a
 * tick to (3804,10133); that one breaks and the Large Boulder floats to (3805,10148). The Wiki gives
 * the rest: five stages (Giant attached, Giant, Large, Medium, Small) of 40 HP a player (the Small
 * 60), a fragment chance per chip by stage and the ore by Mining level, and +100 points for everyone
 * when a boulder falls into the lava vortex.
 *
 * The Wiki also opens a second boulder in the western channel from 10 players and a third in the
 * eastern channel from 20 (Volcanic Mine#Boulder). Its Boulder page's map pins give those channels'
 * stage tiles; the attached stage's lava spread and the tiny boulder's vortex float are recorded for
 * the central channel only, so the extra channels pay the vortex points when their Small is mined out.
 *
 * Mining (recorded): "You swing your pick at the rock." and the swing the tick after the click, then
 * a chip with sound 3600 every pickaxe interval (3 ticks with a dragon pickaxe, sometimes 2): +1
 * point, 5 Mining XP, and sometimes a fragment with its points, XP and a side find.
 */
const Common = require("./Common.VolcanicMine");
const Game = require("./Game.VolcanicMine");

const ORES = ["iron", "silver", "coal", "gold", "mithril", "adamantite", "runite"];
/** The Wiki's channels, and the order a larger team opens them in. */
const CHANNELS = ["central", "west", "east"];

function stageHp(game, stage) {
  return stage.hp * Math.max(1, game.players.size);
}

/** Each stage's stop tile for a channel. The central tiles are the capture's; west/east are Wiki pins. */
function stageTiles(channel) {
  const { boulder } = Common.data;
  if (channel === "central") return boulder.stages.map((stage) => stage.tile);
  return boulder.extraChannels[channel].stageTiles;
}

/** Wiki: under 10 players one boulder, 10+ a second (west), 20+ a third (east). */
function channelCount(players) {
  const { boulder } = Common.data;
  if (players >= boulder.thirdAt) return 3;
  if (players >= boulder.secondAt) return 2;
  return 1;
}

function createBoulder(game, channel) {
  const { boulder: data } = Common.data;
  const first = data.stages[0];
  const boulder = { channel, stage: 0, hp: stageHp(game, first), loc: null, moving: false, done: false };
  boulder.loc = game.setLoc(first.loc, stageTiles(channel)[0], 10, first.face);
  return boulder;
}

/** At the start: the attached boulders are put in the channels the team's size opens. */
function begin(game) {
  game.boulders = CHANNELS.slice(0, channelCount(game.players.size))
    .map((channel) => createBoulder(game, channel));
  // The central boulder keeps its name for the recorded behaviour and older callers.
  game.boulder = game.boulders[0];
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
function breakStage(game, boulder = game.boulder) {
  const { boulder: data, locs } = Common.data;
  const stage = data.stages[boulder.stage];
  const tiles = stageTiles(boulder.channel);
  const tile = tiles[boulder.stage];
  boulder.moving = true;
  game.removeLoc(boulder.loc);
  boulder.loc = null;
  const breaking = spawn(game, stage.breaking, tile);
  if (breaking) {
    const id = Common.core.CacheDefinitions.getSeqId(stage.breakSeq);
    if (id != null) breaking.performAnimation(new Common.core.Animation(id));
  }
  Common.later(2, () => despawn(game, breaking));
  if (boulder.stage === 0 && boulder.channel === "central") {
    for (const [x, y] of data.attachedLava) game.setLoc(locs.lava, [x, y, tile[2]]);
  }
  const nextIndex = boulder.stage + 1;
  const next = data.stages[nextIndex];
  if (!next) {
    vortex(game, boulder);
    return;
  }
  // The capture gives the central channel's float start; elsewhere it is the tile north of the stop.
  const from = boulder.channel === "central" ? next.from : [tile[0], tile[1] + 1, tile[2]];
  float(game, next.floating, from, tiles[nextIndex], () => {
    if (game.ended) return;
    boulder.stage = nextIndex;
    boulder.hp = stageHp(game, next);
    boulder.loc = game.setLoc(next.loc, tiles[nextIndex], 10, next.face);
    boulder.moving = false;
  });
}

function awardVortex(game) {
  for (const player of game.players) {
    player.sendMessage(Common.message("vortex"));
    game.addPoints(player, Common.data.points.vortex);
  }
}

function vortex(game, boulder = game.boulder) {
  boulder.done = true;
  if (boulder.channel !== "central") {
    // No recording of the extra channels' vortex float; the Wiki's +100 is paid on the last stage.
    awardVortex(game);
    return;
  }
  float(game, Common.data.boulder.tiny.npc, Common.data.boulder.tiny.from, Common.data.boulder.tiny.to,
    () => awardVortex(game));
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

function chip(game, player, boulder = game.boulder) {
  const { data } = Common;
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
  if (boulder.hp <= 0) breakStage(game, boulder);
}

/** The boulder whose object was clicked, by identity or by its current loc and tile. */
function boulderFor(game, event) {
  const list = game.boulders ?? (game.boulder ? [game.boulder] : []);
  if (list.length <= 1) return list[0] ?? null;
  const object = event.object;
  return list.find((boulder) => boulder.loc
    && (boulder.loc === object
      || (boulder.loc.getId?.() === event.objectId
        && boulder.loc.getLocation?.().equals?.(object?.getLocation?.())))) ?? null;
}

function mine(event) {
  const { player } = event;
  const game = Game.gameOf(player);
  const boulder = game ? boulderFor(game, event) : null;
  if (!boulder || boulder.moving || boulder.done || game.phase !== "running") return Boolean(game);
  const pickaxe = Common.bestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
    return true;
  }
  const from = player.getLocation();
  const stageAt = boulder.stage;
  const current = game.act(player);
  const token = game.actions.get(player);
  const mining = () => current(token) && Game.gameOf(player) === game && game.phase === "running"
    && !boulder.moving && boulder.stage === stageAt && player.getLocation().equals(from);
  const swing = () => {
    // As Mining does each tick: a pickaxe dropped or banked mid-swing ends it; a better one picked up is used.
    const held = mining() && Common.bestPickaxe(player);
    if (!held) return;
    player.performAnimation(held.animation);
    Common.sound(player, "pick");
    chip(game, player, boulder);
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

module.exports = {
  attachBoulder, rollOre, begin, breakStage, chip, vortex, stageTiles, channelCount, ORES,
};
