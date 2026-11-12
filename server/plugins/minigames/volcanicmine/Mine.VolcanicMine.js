/**
 * Inside the mine (recorded, rsprox 1858): the stairs, the exit ladder, the chambers and their large
 * rocks, the vents, the gas holes and the heat-proof vessel's water on the lava.
 *
 * Handlers see the instance tile; `templateOf` gives the source tile the data is keyed on.
 */
const Common = require("./Common.VolcanicMine");
const Game = require("./Game.VolcanicMine");
const Capacity = require("./Capacity.VolcanicMine");

/**
 * Clearing a blockage (recorded, rsprox 1858): the swing line and animation the tick after the
 * click, the first roll a tick later, then one every pickaxe interval; a missed roll replays the
 * swing, the clear stops it with sound 3600. Each roll has this chance (recorded: at once to a few rolls).
 */
const CLEAR_CHANCE = 1 / 3;
const CLEAR_TRIES = 8;

function at(event) {
  const game = Game.gameOf(event.player);
  if (!game || !event.object) return null;
  return { game, tile: game.area.templateOf(event.object.getLocation()) };
}

function chamberAt(tile) {
  const { chambers } = Common.data;
  return Object.keys(chambers).find((name) => chambers[name].tile.join() === tile.join()) ?? null;
}

// ------------------------------------------------------------------ stairs and the exit

function stairs(event) {
  const found = at(event);
  if (!found) return false;
  const { game, tile } = found;
  const to = Common.data.stairs[Common.key(...tile)];
  if (!to) return false;
  const { player } = event;
  if (game.collapsing) return true;
  if (game.phase === "lobby") {
    Common.box(player, Common.message("dormantStairs"));
    return true;
  }
  Common.animate(player, "ladder");
  Common.later(1, () => {
    if (Game.gameOf(player) === game) player.moveTo(game.area.at(to));
  });
  return true;
}

function exitLadder(event) {
  const game = Game.gameOf(event.player);
  if (!game) return false;
  game.exit(event.player);
  return true;
}

// ------------------------------------------------------------------ chambers and rocks

function block(event) {
  const found = at(event);
  if (!found) return false;
  const { game, tile } = found;
  const chamber = chamberAt(tile);
  if (!chamber) return false;
  const { player } = event;
  const { data } = Common;
  if (!player.getInventory().contains(data.items.rock)) {
    Common.box(player, Common.message("noRock"));
    return true;
  }
  Common.later(2, () => {
    if (Game.gameOf(player) !== game || game.isBlocked(chamber) || !player.getInventory().contains(data.items.rock)) return;
    player.getInventory().delete(data.items.rock, 1);
    Common.animate(player, "pickupTable");
    player.sendMessage(Common.message("block"));
    game.setLoc(data.locs.chamberBlocked, tile);
    game.setBlocked(chamber, true);
    game.addPoints(player, data.points.block, true);
  });
  return true;
}

function clear(event) {
  const found = at(event);
  if (!found) return false;
  const { game, tile } = found;
  const chamber = chamberAt(tile);
  if (!chamber) return false;
  const { player } = event;
  const { data } = Common;
  const pickaxe = Common.bestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.");
    return true;
  }
  const from = player.getLocation();
  let tries = 0;
  const current = game.act(player);
  const token = game.actions.get(player);
  const mining = () => current(token) && Game.gameOf(player) === game && game.isBlocked(chamber) && player.getLocation().equals(from);
  const roll = () => {
    if (!mining()) return;
    if (Math.random() < CLEAR_CHANCE || ++tries >= CLEAR_TRIES) {
      player.performAnimation(Common.core.Animation.DEFAULT_RESET_ANIMATION);
      Common.sound(player, "pick");
      player.sendMessage(Common.message("cleared"));
      game.setLoc(data.locs.chamberOpen, tile);
      game.setBlocked(chamber, false);
      game.addPoints(player, data.points.clear, true);
      Common.xp(player, "MINING", data.xp.clear);
      return;
    }
    player.performAnimation(pickaxe.animation);
    Common.later(Common.rollInterval(pickaxe), roll);
  };
  Common.later(1, () => {
    if (!mining()) return;
    Common.spam(player, Common.message("swing"));
    player.performAnimation(pickaxe.animation);
    Common.later(1, roll);
  });
  return true;
}

function takeRock(event) {
  const found = at(event);
  if (!found) return false;
  const { game, tile } = found;
  const { player } = event;
  const { data } = Common;
  const key = Common.key(...tile);
  if (game.rocks.get(key)) return true;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  // Recorded: like Block, the rock is taken two ticks after the click.
  Common.later(2, () => {
    if (Game.gameOf(player) !== game || game.ended || game.rocks.get(key)) return;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    Common.animate(player, "pickupTable");
    player.sendMessage(Common.message("takeRock"));
    player.getInventory().adds(data.items.rock, 1);
    game.rocks.set(key, true);
    game.setLoc(data.locs.rockDepleted, tile);
    Common.later(data.timing.rockRespawn, () => {
      if (game.ended) return;
      game.rocks.delete(key);
      game.setLoc(data.locs.rock, tile);
    });
  });
  return true;
}

// ------------------------------------------------------------------ vents

/** The vent's chamber: the one with the nearest x (the recorded B and C fit). */
function ventOf(tile) {
  const { chambers } = Common.data;
  let best = null;
  for (const [name, { tile: chamber }] of Object.entries(chambers)) {
    const distance = Math.abs(chamber[0] - tile[0]);
    if (!best || distance < best[1]) best = [name, distance];
  }
  return best[0];
}

function inspect(event) {
  const found = at(event);
  if (!found) return false;
  const { game, tile } = found;
  const { player } = event;
  const vent = ventOf(tile);
  Common.later(1, () => {
    if (Game.gameOf(player) !== game) return;
    Common.box(player, Common.message("vent", { vent, gas: game.gas[vent] }));
    const fresh = !game.known[vent];
    game.reveal(vent);
    if (fresh) game.addPoints(player, Common.data.points.inspect);
  });
  return true;
}

// ------------------------------------------------------------------ gas holes

/** Feel (recorded): +1 "Ouch! Hot hot!" and the launch, +4 the landing, +6 the land seq, +9 the hit. */
function feel(event) {
  const found = at(event);
  if (!found) return false;
  const { game } = found;
  const to = Common.data.gasHoles[String(event.objectId)];
  if (!to) return false;
  const { player } = event;
  if (game.collapsing) return true;
  const holeTile = event.object.getLocation();
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement?.(true);
  const still = () => Game.gameOf(player) === game;
  Common.later(1, () => {
    if (!still()) return;
    player.forceChat?.(Common.message("ouch"));
    Common.animate(player, "launch");
    player.getPacketSender().sendGraphic(new Common.core.Graphic(Common.data.graphics.gasJump, 0, 0), holeTile);
    Common.sound(player, "jump");
  });
  Common.later(4, () => {
    if (still()) player.moveTo(game.area.at(to));
  });
  Common.later(6, () => {
    if (!still()) return;
    Common.animate(player, "land");
    Common.sound(player, "land");
  });
  Common.later(9, () => {
    player.getMovementQueue().setBlockMovement?.(false);
    if (still()) Common.hurt(player, Common.randomInt(...Common.data.gasHoleDamage));
  });
  return true;
}

// ------------------------------------------------------------------ water on the lava

function lavaAt(game, tile) {
  const key = Common.key(...tile);
  // Lava, or a crust past its first stage (recorded: throwing on stepping_1 refreshes it).
  if (game.lava?.has(key)) return game.lava.get(key).stage !== 0;
  return game.area.getTemplateObjects(game.area.at(tile)).some((o) => o.getId() === Common.data.locs.lava);
}

function onChannel([x, y, z]) {
  const [x0, y0, x1, y1, cz] = Common.data.boulder.channel;
  return z === cz && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** The lava tile the player throws at: the one in front, else the nearest next to them. */
function target(game, player) {
  const here = game.area.templateOf(player.getLocation());
  const facing = player.__vmFacing ?? [0, 1];
  const ahead = [here[0] + facing[0], here[1] + facing[1], here[2]];
  if (lavaAt(game, ahead)) return ahead;
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const tile = [here[0] + dx, here[1] + dy, here[2]];
    if (lavaAt(game, tile)) return tile;
  }
  return null;
}

/** A crust's life (recorded): stepping, 74 ticks, stepping_1, 65, stepping_2, 10, lava again. */
function harden(game, tile) {
  const { locs, water } = Common.data;
  if (!game.lava) game.lava = new Map();
  const key = Common.key(...tile);
  const state = { stage: 0, generation: (game.lava.get(key)?.generation ?? 0) + 1 };
  game.lava.set(key, state);
  const advance = (stage) => {
    if (game.ended || game.lava.get(key) !== state) return;
    state.stage = stage;
    if (stage < locs.crust.length) {
      game.setLoc(locs.crust[stage], tile);
      Common.later(water.stages[stage], () => advance(stage + 1));
    } else {
      state.stage = -1;
      game.setLoc(locs.lava, tile);
    }
  };
  advance(0);
}

function throwWater(event) {
  const { player } = event;
  const game = Game.gameOf(player);
  if (!game) return false;
  const { data } = Common;
  const throws = Number(player.getAttribute("volcanic-mine:throws") ?? 0);
  if (throws <= 0) {
    player.sendMessage(Common.message("vesselEmpty"));
    return true;
  }
  const tile = target(game, player);
  if (!tile) return true;
  if (onChannel(tile)) {
    player.sendMessage(Common.message("channel"));
    return true;
  }
  Common.animate(player, "fling");
  harden(game, tile);
  const left = throws - 1;
  player.setAttribute("volcanic-mine:throws", left);
  // Recorded: the count on throws 1, 6, 11, 16... (35, 30, 25, 20 left).
  if ((Number(player.getAttribute(Capacity.INITIAL_THROWS_ATTRIBUTE) ?? data.water.throws) - left) % 5 === 1) player.sendMessage(Common.message("throwsLeft", { n: left }));
  game.addPoints(player, data.points.throw);
  return true;
}

function checkLevel(event) {
  const { player } = event;
  if (!Game.gameOf(player)) return false;
  const left = Number(player.getAttribute("volcanic-mine:throws") ?? 0);
  player.sendMessage(Common.message("throwsLeft", { n: left }));
  return true;
}

/** Where the player last walked, for the throw's "in front". */
function trackFacing({ player, destination }) {
  if (!Game.gameOf(player) || !destination) return;
  const here = player.getLocation();
  const dx = Math.sign(destination.x - here.getX());
  const dy = Math.sign(destination.y - here.getY());
  if (dx || dy) player.__vmFacing = [dx, dy];
}

function attachMine(api) {
  const { locs } = Common.data;
  api.onObjectClick([locs.stairsTop, locs.stairsBottom], 1, stairs);
  api.onObjectClick(locs.exit, 1, exitLadder);
  api.onObjectClick(locs.chamberOpen, 1, block);
  api.onObjectClick(locs.chamberBlocked, 1, clear);
  api.onObjectClick(locs.rock, 1, takeRock);
  api.onObjectClick(locs.vent, 1, inspect);
  api.onObjectClick(Object.keys(Common.data.gasHoles).map(Number), 1, feel);
  api.onItemAction("Heat-proof vessel", { "Throw-water": throwWater, "Throw-water direction": throwWater, "Check-level": checkLevel });
  api.onWalkRoute?.(trackFacing);
}

module.exports = { attachMine, ventOf, chamberAt, harden, onChannel };
