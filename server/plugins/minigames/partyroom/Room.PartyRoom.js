"use strict";

/**
 * The Falador Party Room (Wiki: Party Room, Party chest, Party balloon): donate items to the chest,
 * pull the lever for 1,000 coins and 200 balloons float down; popping one may give an item from the
 * chest. Nothing comes out of the chest any other way.
 *
 * The offer screen is the one Clan Halls use (interface/partychest); this file is the chest's rules
 * (Store.PartyRoom.js is its file). Evidence: the cache (chest locs 26193 shut and 2418 open,
 * levers 2421 and 26194, balloons 115-122, screens 265 and 266, invs 91 and 92) and RSProx archives
 * 4001, 349 and 3237 (the open chest at 3054,3376,0). Not captured: a player using any of it. Ours: the
 * odds, where the balloons land, how long they fall, one drop at a time, and the wording.
 * See server/docs/party-room.md.
 */
const crypto = require("crypto");
const path = require("path");
const PartyChest = require("../../interface/partychest/Offer.PartyChest");
const Store = require("./Store.PartyRoom");
const Knights = require("./Knights.PartyRoom");

const CLOSED_CHEST = 26193; // Open
const OPEN_CHEST = 2418; // Deposit, Shut
const CHEST_TILE = { x: 3054, y: 3376, z: 0 }; // RSProx 4001, 349, 3237
const LEVERS = [2421, 26194];
const FIRST_BALLOON = 115; // 115-122 have Burst in the cache
const BALLOON_COLOURS = 8;
const MAIN_GROUP = 265;
const OFFER_LIST = 16;
const CONFIRM = 17;
const CHEST_INV = 91; // partyroom_dropinv
const ATTRIBUTE = "partyroom:chest-offer";
const LEVER_COST = 1000; // Wiki: Party chest
const BALLOONS = 200; // Wiki: Party chest
const BALLOON_TICKS = 200; // Wiki: Party balloon, two minutes on the ground
const MAX_ODDS = 0.5; // ours: the chance of one balloon at a full chest; the Wiki gives none
/** Ours: balloons land on tiles a player can walk to from the chest, inside this box around the room. */
const ROOM = { minX: 3037, maxX: 3055, minY: 3370, maxY: 3383 };
const LEAGUE_TASK = "use-the-falador-party-room";
const NO_DONATIONS = "The chest can't take donations right now.";
const MIN_FREE_PLAYTIME = 20 * 60 * 60 * 1000;
const MEMBERSHIP_ATTRIBUTE = "bond-membership-expiry";
const QUEST_POINTS_ATTRIBUTE = "quest.points";

let api = null;
let core = null;
let screen = null;
const balloons = new Map();

function ironman(player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return query.mode ?? "none";
}

const accountOf = (player) => player.getUsername().toLowerCase();

/** Chosen on first use: the world's profile isn't set until the league plugin has registered. */
function profileFile() {
  const profile = core.GameConstants.WORLD_PROFILE;
  const name = !profile || profile === "main" ? "party-room.json" : `party-room.${profile}.json`;
  return path.join(process.env.TSPS_PARTY_ROOM_DIR || path.join(process.cwd(), "data", "saves"), name);
}

function canOpen(player) {
  if (ironman(player) !== "none") {
    player.sendMessage("As an Ironman, you stand alone.");
    return false;
  }
  // A save that is never written can't be the guard that keeps an offer from being lost or doubled.
  if (player.getAttribute?.("bot-skip-persistence") === true || !Store.available()) {
    player.sendMessage(NO_DONATIONS);
    return false;
  }
  return true;
}

/** New free accounts need the trade requirements, unless they have redeemed membership. */
function canDeposit(player) {
  if (!canOpen(player)) return false;
  if (core.WorldDefinition.isMembersWorld()) return true;
  const expiry = Number(player.getAttribute(MEMBERSHIP_ATTRIBUTE));
  if (Number.isFinite(expiry) && expiry > 0) return true;
  const time = { player, milliseconds: null };
  api.emitCustomEvent("account:play-time", time);
  if (Number.isFinite(time.milliseconds) && time.milliseconds > MIN_FREE_PLAYTIME &&
      Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) >= 10 &&
      player.getSkillManager().getTotalLevel() >= 100) return true;
  player.sendMessage("Your account is not yet eligible to donate to the party chest.");
  return false;
}

/** What a login does with a saved offer, by the chest's own record of it. */
function settleRestore(player, raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (items.length === 0) return [];
  if (!Store.available()) {
    console.error(`[party-room] Keeping ${player.getUsername()}'s saved offer: the chest file can't be read`, Store.error());
    return PartyChest.HOLD;
  }
  // The chest took it and the save never learned: the items are in the chest, not here.
  if (raw.id && Store.confirmedId(accountOf(player)) === raw.id) return [];
  return items;
}

/**
 * After a login settled a saved offer and cleared it in the player: the chest's record of it can go
 * once the cleared save is on the disk, not before (a crash in between would return the items again).
 */
function restored(player, raw) {
  const account = accountOf(player);
  if (!raw?.id || Store.confirmedId(account) !== raw.id) return;
  forgetOnceSaved(player, raw.id);
}

function forgetOnceSaved(player, confirmId) {
  const persistence = core.GameConstants.PLAYER_PERSISTENCE;
  try {
    persistence.requestSave(player, "party-chest");
    persistence.flush().then(() => Store.forget(accountOf(player), confirmId)).catch(() => undefined);
  } catch {
    // The record stays: a later login finds the same answer.
  }
}

/**
 * Confirm: the save that holds the offer and its id reaches the disk first, then, in one step with
 * nothing awaited, the offer is checked again and the chest file written. The save is what a crash or
 * a rollback is judged by, so the chest never takes what the save doesn't also know of.
 */
async function confirm(player, state, tools) {
  if (!tools.beginPending(player, state)) return;
  const confirmId = state.confirmId;
  const snapshot = state.items.map(({ id, amount }) => ({ id, amount }));
  try {
    const persistence = core.GameConstants.PLAYER_PERSISTENCE;
    let saved = false;
    try {
      persistence.requestSave(player, "party-chest");
      await persistence.flush();
      saved = true;
    } catch (error) {
      // flush() fails for any player's failed write, so this says nothing about the depositor.
      console.error(`[party-room] Not taking ${player.getUsername()}'s offer: a player save failed`, error);
    }
    if (!saved) {
      player.sendMessage(NO_DONATIONS);
      return;
    }
    if (!tools.isCurrent(player, state, confirmId, snapshot) || !canDeposit(player)) return;
    const result = Store.deposit(accountOf(player), confirmId, snapshot);
    if (!result.ok) {
      player.sendMessage(result.reason === "full" ? "The chest is full." : NO_DONATIONS);
      if (result.reason === "write") console.error("[party-room] Could not write the chest file", result.cause);
      return;
    }
    tools.settle(player, state, true);
    api.emitCustomEvent("league:complete-task", { player, id: LEAGUE_TASK });
    forgetOnceSaved(player, confirmId);
  } catch (error) {
    console.error("[party-room] A confirm failed", error);
    player.sendMessage(NO_DONATIONS);
  } finally {
    // Whatever happened, the offer is not left pending: settled already if the chest took it.
    if (state.pending) tools.settle(player, state, false);
  }
}

function schedule(ticks, action) {
  core.TaskManager.submit(
    new (class extends core.Task {
      constructor() {
        super(ticks, false);
      }
      execute() {
        this.stop();
        action();
      }
    })(),
  );
}

// ---------------------------------------------------------------- the chest

function openChest({ player }) {
  screen.open(player, {});
  return true;
}

function shutChest({ player }) {
  player.sendMessage("You shut the chest.");
  return true;
}

// ---------------------------------------------------------------- the lever and balloons

/** Tiles in the room box a player can walk to from beside the chest, wall edges included. */
function landingTiles() {
  const key = (x, y) => `${x},${y}`;
  const inBox = (x, y) => x >= ROOM.minX && x <= ROOM.maxX && y >= ROOM.minY && y <= ROOM.maxY;
  const { x: cx, y: cy, z } = CHEST_TILE;
  const start = [[-1, 0], [0, 1], [0, -1], [1, 0]]
    .map(([dx, dy]) => [cx + dx, cy + dy])
    .find(([x, y]) => inBox(x, y) && !core.RegionManager.blocked(new core.Location(x, y, z), null));
  if (!start) return [];
  const seen = new Set([key(start[0], start[1])]);
  const queue = [start];
  for (let at = 0; at < queue.length; at++) {
    const [x, y] = queue[at];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBox(nx, ny) || seen.has(key(nx, ny))) continue;
      if (core.RegionManager.blocked(new core.Location(nx, ny, z), null)) continue;
      if (!core.RegionManager.canMove(x, y, nx, ny, z, 1, 1, null)) continue;
      seen.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }
  return queue;
}

function removeBalloon(balloon) {
  if (balloons.get(balloon.key) !== balloon) return false;
  balloons.delete(balloon.key);
  core.ObjectManager.deregister(balloon.object, true);
  return true;
}

function placeBalloon(key, tile, colour = Math.floor(Math.random() * BALLOON_COLOURS)) {
  const object = new core.GameObject(FIRST_BALLOON + colour, tile, 10, 0, null);
  const balloon = { key, object };
  balloons.set(key, balloon);
  core.ObjectManager.register(object, true);
  schedule(BALLOON_TICKS, () => removeBalloon(balloon));
  return balloon;
}

/** Up to BALLOONS balloons on distinct tiles the chest can be reached from; how many landed. */
function releaseBalloons() {
  const tiles = landingTiles().filter(([x, y]) => core.ObjectManager.objectsAt(new core.Location(x, y, CHEST_TILE.z)).length === 0);
  for (let index = tiles.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
  }
  let placed = 0;
  for (const [x, y] of tiles) {
    if (placed >= BALLOONS) break;
    const key = `${x},${y}`;
    if (balloons.has(key)) continue;
    placeBalloon(key, new core.Location(x, y, CHEST_TILE.z));
    placed++;
  }
  return placed;
}

function pullLever({ player }) {
  // Ours: one drop at a time, and nothing to drop for an empty chest.
  if (balloons.size > 0) {
    player.sendMessage("The balloons are still falling.");
    return true;
  }
  if (!Store.available()) {
    player.sendMessage(NO_DONATIONS);
    return true;
  }
  if (Store.chest().length === 0) {
    player.sendMessage("The chest is empty.");
    return true;
  }
  const { COINS } = core.ItemIdentifiers;
  if (player.getInventory().getAmount(COINS) < LEVER_COST) {
    player.sendMessage(`You need ${LEVER_COST.toLocaleString("en-GB")} coins to pull the lever.`);
    return true;
  }
  // The coins are taken once balloons are down, so a lever that drops none costs nothing.
  if (releaseBalloons() === 0) {
    player.sendMessage("Nothing happens.");
    return true;
  }
  player.getInventory().delete(COINS, LEVER_COST);
  player.sendMessage("Balloons float down around the room.");
  return true;
}

/** The lever offers balloons or a knight dance; opening or cancelling costs nothing. */
function leverMenu({ player }) {
  api.sendMultiChatboxPrompt(player, "Select an option",
    "Balloon Bonanza (1,000 coins)", () => pullLever({ player }),
    "Nightly Dance (500 coins)", () => Knights.start(player),
    "No action", () => {});
  return true;
}

/** One balloon in `used` items of 216 pays with this chance: a full chest is MAX_ODDS, one item is rare. */
function oddsOf(used) {
  return (MAX_ODDS * used) / Store.CAPACITY;
}

function burst({ player, location }) {
  const balloon = balloons.get(`${location.x},${location.y}`);
  if (!balloon) return false;
  // The balloon goes first, so a second player on the same tick finds nothing.
  if (!removeBalloon(balloon)) return true;
  if (ironman(player) !== "none") return true;
  if (!Store.available() || Math.random() >= oddsOf(Store.used())) return true;
  const stack = Store.take();
  if (!stack) return true;
  // Owned by who popped it and seen by everyone: the Wiki's Ironman page bars receiving balloon items,
  // and Loot.Ironman turns away an Ironman from anything another player owns.
  const drop = new core.ItemOnGround(
    core.GroundItemState.SEEN_BY_EVERYONE, player.getUsername(),
    new core.Location(location.x, location.y, location.z ?? 0), new core.Item(stack.id, stack.amount),
    false, -1, null,
  );
  core.ItemOnGroundManager.register(drop);
  screen.refreshViewers(Store.chest());
  return true;
}

function reset() {
  Knights.reset();
  balloons.clear();
  screen?.reset();
  Store.reset();
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  Knights.init(pluginApi);
  Store.configure({ file: profileFile, isStackable: (id) => new core.Item(id, 1).getDefinition().isStackable() });
  screen = PartyChest.create({
    mainGroup: MAIN_GROUP,
    offerList: OFFER_LIST,
    confirmComponent: CONFIRM,
    chestInv: CHEST_INV,
    chestSize: Store.CAPACITY,
    offerAttribute: ATTRIBUTE,
    chestOf: () => Store.chest(),
    welcome: "Whatever you put in stays in the chest until a balloon takes it.",
    canOpen,
    canDeposit,
    confirm,
    newConfirmId: () => crypto.randomUUID(),
    serialize: (state) => (state.items.length === 0 ? null : { id: state.confirmId ?? null, items: state.items }),
    settleRestore,
    restored,
  });
  screen.init(pluginApi, core);
  api.onObjectFirstClick([CLOSED_CHEST], openChest);
  api.onObjectSecondClick([OPEN_CHEST], openChest);
  api.onObjectThirdClick([OPEN_CHEST], shutChest);
  api.onObjectFirstClick(LEVERS, leverMenu);
  api.onObjectFirstClick(Array.from({ length: BALLOON_COLOURS }, (_, index) => FIRST_BALLOON + index), burst);
  api.onCustomEvent("player:bootstrap-complete", ({ player }) => screen.restoreOffer(player));
  api.onPlayerLogout(({ player }) => screen.playerGone(player));
  api.onInterfaceActionClick(screen.click);
  api.onCustomEvent("player:varp-transmit", screen.varpTransmitted);
  api.onCustomEvent("interface:closed", screen.interfaceClosed);
  api.onCustomEvent("interface:opened", screen.interfaceOpened);
}

/** What the tests use: the balloons by tile, and the chest screen. */
const balloonCount = () => balloons.size;
const expireBalloon = (key) => {
  const balloon = balloons.get(key);
  return balloon ? removeBalloon(balloon) : false;
};
const balloonKeys = () => [...balloons.keys()];

module.exports = {
  attach, balloonCount, balloonKeys, burst, confirm, expireBalloon, landingTiles, oddsOf, placeBalloon,
  leverMenu, pullLever, releaseBalloons, reset, screenOf: () => screen,
};
