"use strict";

const { Animation, Equipment, ItemDefinition, Location, Skill, Task, TaskManager, World } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Prizes = require("./Prizes.Construction");

// Games room ranging games (rsprox captures): each click is one shot. Hoop and stick plays
// human_throw_hoop1 then human_throw_hoop2 the next tick (synth 2708 on the throw, 976 when it
// lands); the dartboard plays snakeboss_blowpipe_attack and needs a thrown weapon wielded ("You
// must wield a thrown weapon."); the archery target plays human_bow and takes an arrow from the
// quiver ("There is no ammo left in your quiver."). The poh_ranging overlay lists up to four
// players' shots and scores and marks the "Winner!" once everyone has had ten shots ("You've had
// your ten shots. You should wait for the other players to finish."). The scoring itself (a hit
// chance and score per shot from Ranged level) is this server's.
const OVERLAY = Ids.iface("poh_ranging");
const OVERLAY_HUD_UID = Ids.component("toplevel_osrs_stretch:overlay_hud");
const PLAYER_TEXT = [9, 10, 11, 12];
const SHOTS_TEXT = [13, 14, 15, 16];
const SCORE_TEXT = [17, 18, 19, 20];
const WINNER_TEXT = [21, 22, 23, 24];
const SHOTS = 10;
const MAX_PLAYERS = 4;
const SHOT_TICKS = 3;
const GAMES = {
  HOOP_AND_STICK: {
    game: "hoop", throwAnimations: [Ids.seq("human_throw_hoop1"), Ids.seq("human_throw_hoop2")], projectile: Ids.spotanim("poh_hoop_projectile"), throwSound: 2708, hitSound: 976, landTicks: 2, hitLoc: Ids.loc("poh_stick+hoop2"),
    score: (level) => (Math.random() < Math.min(0.95, 0.4 + level / 165) ? 1 : 0),
  },
  DARTBOARD: {
    game: "darts", throwAnimations: [Ids.seq("snakeboss_blowpipe_attack")], projectile: Ids.spotanim("poh_dart_projectile"), hitSound: 944, landTicks: 2, hitLoc: Ids.loc("poh_dartboard2"),
    requires: thrownWeapon, score: ringScore,
  },
  ARCHERY_TARGET: {
    game: "archery", throwAnimations: [Ids.seq("human_bow")], projectile: Ids.spotanim("poh_arrow_projectile"), hitSound: 944, landTicks: 3, hitLoc: Ids.loc("poh_archery_target2"),
    requires: bowAndArrow, score: ringScore,
  },
};

/** house -> Map(furniture -> { players: Map(player -> { shots, score }), done }) */
const busyUntil = new WeakMap();
const games = new WeakMap();

function gamesIn(house) {
  let map = games.get(house);
  if (!map) games.set(house, map = new Map());
  return map;
}

function nameOf(itemId) {
  return itemId > 0 ? (ItemDefinition.forId(itemId)?.getName?.() ?? "").toLowerCase() : "";
}

function thrownWeapon(player) {
  const weapon = nameOf(player.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId());
  if (/\b(dart|knife|thrownaxe|javelin)\b/.test(weapon)) return true;
  player.sendMessage("You must wield a thrown weapon.");
  return false;
}

function bowAndArrow(player) {
  const items = player.getEquipment().getItems();
  const bow = nameOf(items[Equipment.WEAPON_SLOT].getId());
  if (!/bow\b/.test(bow) || bow.includes("crossbow")) {
    player.sendMessage("You need to wield a bow to shoot at the target.");
    return false;
  }
  if (!nameOf(items[Equipment.AMMUNITION_SLOT].getId()).includes("arrow")) {
    player.sendMessage("There is no ammo left in your quiver.");
    return false;
  }
  return true;
}

/** Darts and arrows: a miss scores nothing, a hit lands nearer the middle with more Ranged. */
function ringScore(level) {
  if (Math.random() >= Math.min(0.95, 0.5 + level / 200)) return 0;
  const reach = 2 + Math.floor(level / 12);
  return 1 + Math.floor(Math.random() * Math.min(10, reach));
}

function shoot(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const kind = furniture && GAMES[furniture.buildableKey];
  if (!kind) return false;
  if (house.buildingMode) return player.sendMessage("You can't play games in building mode."), true;
  if (World.getProcessCycle() < (busyUntil.get(player) ?? 0)) return true;
  let game = gamesIn(house).get(furniture);
  if (game?.done) {
    gamesIn(house).delete(furniture);
    game = null;
  }
  const start = () => fire(player, house, furniture, kind, event.location);
  if (!game) {
    gamesIn(house).set(furniture, { players: new Map(), done: false });
    Prizes.offer(player, house, kind.game, start);
    return true;
  }
  start();
  return true;
}

function fire(player, house, furniture, kind, target) {
  const game = gamesIn(house).get(furniture);
  if (!game || game.done || House.houseFor(player) !== house) return;
  let entry = game.players.get(player);
  if (!entry) {
    if (game.players.size >= MAX_PLAYERS) return player.sendMessage("There are already four players in this game.");
    game.players.set(player, entry = { shots: 0, score: 0 });
  }
  if (entry.shots >= SHOTS) return player.sendMessage("You've had your ten shots. You should wait for the other players to finish.");
  if (kind.requires && !kind.requires(player)) return;
  if (kind.game === "archery") player.getEquipment().deleteAtSlot(Equipment.AMMUNITION_SLOT, 1);
  const to = new Location(target.x, target.y, target.z);
  player.setPositionToFace(to);
  player.performAnimation(new Animation(kind.throwAnimations[0]));
  if (kind.throwSound) player.getPacketSender().sendSound(kind.throwSound, 0, 0);
  busyUntil.set(player, World.getProcessCycle() + SHOT_TICKS);
  entry.shots++;
  let tick = 0;
  TaskManager.submit(new class extends Task {
    constructor() { super(1, `construction:ranging:${player.getIndex()}`, false); }
    execute() {
      tick++;
      if (tick === 1) {
        if (kind.throwAnimations[1]) player.performAnimation(new Animation(kind.throwAnimations[1]));
        for (const watcher of house.getPlayers()) {
          watcher.getPacketSender().sendProjectile(player.getLocation(), to, 0, 30, kind.projectile, 0, 0, null, 0, 2, 64);
        }
      }
      if (tick === kind.landTicks) {
        const score = kind.score(player.getSkillManager().getCurrentLevel(Skill.RANGED));
        entry.score += score;
        if (score > 0) {
          player.getPacketSender().sendSound(kind.hitSound, 0, 0);
          if (furniture.displayObjectId !== kind.hitLoc) {
            furniture.displayObjectId = kind.hitLoc;
            house.redrawFurniture();
          }
        }
        finishIfDone(house, furniture, kind, game);
        sendOverlay(game);
      }
      if (tick >= SHOT_TICKS) this.stop();
    }
  }());
}

function finishIfDone(house, furniture, kind, game) {
  for (const [player] of game.players) if (House.houseFor(player) !== house) game.players.delete(player);
  if (!game.players.size || [...game.players.values()].some(entry => entry.shots < SHOTS)) return;
  game.done = true;
  const best = Math.max(...[...game.players.values()].map(entry => entry.score));
  game.winners = [...game.players].filter(([, entry]) => entry.score === best).map(([player]) => player);
  Prizes.award(house, kind.game, game.winners.length === 1 ? game.winners[0] : null);
  if (game.winners.length !== 1) Prizes.withdraw(house, kind.game);
  delete furniture.displayObjectId;
  house.redrawFurniture();
}

function sendOverlay(game) {
  const rows = [...game.players];
  for (const [viewer] of rows) {
    const sender = viewer.getPacketSender();
    for (let row = 0; row < MAX_PLAYERS; row++) {
      const [player, entry] = rows[row] ?? [];
      sender.sendString(player ? player.getDisplayName() : "", (OVERLAY << 16) | PLAYER_TEXT[row]);
      sender.sendString(player ? String(entry.shots) : "", (OVERLAY << 16) | SHOTS_TEXT[row]);
      sender.sendString(player ? String(entry.score) : "", (OVERLAY << 16) | SCORE_TEXT[row]);
      sender.sendString(player && game.winners?.includes(player) ? "Winner!" : "", (OVERLAY << 16) | WINNER_TEXT[row]);
    }
    sender.sendSubInterface(OVERLAY_HUD_UID, OVERLAY, 1);
  }
}

/** House.leftHouse: the overlay goes, and the game carries on without them. */
function leftGames(player, house) {
  busyUntil.delete(player);
  for (const [furniture, game] of gamesIn(house)) {
    if (!game.players.delete(player)) continue;
    player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
    const kind = GAMES[furniture.buildableKey];
    if (!game.done) finishIfDone(house, furniture, kind, game);
    if (game.players.size) sendOverlay(game);
    else {
      gamesIn(house).delete(furniture);
      delete furniture.displayObjectId; // the hoop or dart isn't left on it
    }
  }
}

function attachRangingGames(api) {
  api.onObjectInteraction("Stick", { Hoop: shoot });
  api.onObjectInteraction("Stick and hoop", { Hoop: shoot });
  api.onObjectInteraction("Dartboard", { "Throw-at": shoot });
  api.onObjectInteraction("Archery target", { "Shoot-at": shoot });
}

Object.assign(module.exports, { attachRangingGames, leftGames });
