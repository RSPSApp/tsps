/**
 * Magic carpets (https://oldschool.runescape.wiki/w/Magic_carpet), from
 * plugins/world/data/magic-carpets.json.
 *
 * Rug Merchants fly riders between their stations: Shantay Pass and south Pollnivneach are the
 * hubs, every other station flies to one hub and back. "Travel" opens the destination menu;
 * "Talk-to" plays the Rug Merchant transcript (npc-dialogues.json), whose station lines this
 * plugin picks and whose travel answers start a ride once the player's line is continued.
 *
 * A ride is played back from rsprox captures (docs/magic-carpets.md): the rider walks to the
 * station's take-off tile, the carpet jingle starts, two ticks later they sit down, then rise
 * and follow the captured path one exact move a tick with the captured camera shots, land,
 * and step off east. The carpet is shown in the appearance's weapon slot while aloft, so the
 * rider's equipment never changes.
 *
 * Fares follow the Wiki (200 coins, 100 with a Ring of Charos(a), free after the hard Desert
 * Diary); no capture of a paid ride exists, so the paid menu title and the "not enough coins"
 * message are this server's wording. Rogue Trader's discount (100 coins, 75 with the ring) follows its 914 varbit,
 * asked of plugins/npcs/RogueTrader.plugin.js by the "rogue-trader:cheap-flights" event.
 */
const DATA = require("./data/magic-carpets.json");

const RUG_MERCHANT = "Rug Merchant";
/** How far a merchant may stand from his station's take-off tile. */
const STATION_RANGE = 8;

const SIT_DOWN_ANIMATION = 2266; // carpet_sit_down
const RAISE_ANIMATION = 2262; // carpet_raise
const LAND_ANIMATION = 2263; // carpet_land
const FLYING_ANIMATION = 6936; // carpet_flying, every stand/walk/run sequence while aloft
const RENDER_SLOTS = 7;
const RAISE_SOUND = 1196;
const LAND_SOUND = 1195;
/** magic_carpet_hidecarpets: hides the station's own rug while the rider is aloft. */
const HIDE_CARPETS_VARBIT = 1773;
/** The song live clears before the carpet jingle, as DragonSlayer's voyage does. */
const SILENCE_SONG = 147;
const CARPET_JINGLE = 132;
const CARPET_JINGLE_LENGTH_MS = 45909;
/** Ticks between reaching the take-off tile and sitting down. */
const SIT_DELAY = 2;
const DEFAULT_MOVE_CYCLES = 30;
/**
 * ForceMovement reads directions 0-3 as north, east, south, west (PlayerSession), so the four
 * cardinal client angles go in as those indices; diagonal angles pass through unchanged.
 */
const CARDINAL_DIRECTIONS = { 1024: 0, 1536: 1, 0: 2, 512: 3 };

const TOPLEVEL = 161;
const COMBAT_TAB = 76;
const MAGIC_TAB = 82;
/** Tabs live closes for the flight, with the group each one gets back: stats, journal, inventory, worn, prayer, settings, emotes. */
const HIDDEN_TABS = [[77, 320], [78, 629], [79, 149], [80, 387], [81, 541], [87, 116], [88, 216]];
const COMBAT_INTERFACE = 593;
const SIDEBUTTON_SWITCH_SCRIPT = 915;
/** toplevel_sidebutton_switch arguments live sends on take-off and on landing. */
const TAKEOFF_TAB = 9;
const LANDING_TAB = 1;

const FREE_TITLE = "Carpet rides are free!";
const DESERT_DIARY = "desert";
const FREE_RIDES_TIER = "hard";
const DIARY_TASKS = {
  "shantay-pass>pollnivneach-north": "travel-from-the-shantay-pass-to-pollnivneach-by",
  "shantay-pass>uzer": "travel-to-uzer-via-magic-carpet",
};
const QUEST_CONDITIONS = {
  "If the player has completed The Golem:": "the_golem",
  "If the player has completed Icthlarin's Little Helper:": "ictlharins_little_helper",
  "If the player has completed The Feud:": "the_feud",
};
const FEUD_INCOMPLETE_CONDITION = "If the player hasn't completed The Feud:";
const MONKEYSPEAK_IN_BANK_CONDITION = "If the player has a monkeyspeak amulet in their bank:";
const MONKEYSPEAK_IN_INVENTORY_CONDITION = "If the player has a monkeyspeak amulet in their inventory:";

const RIDE_ATTRIBUTE = "magic-carpets:ride";

const STATIONS = new Map(DATA.stations.map((station) => [station.key, station]));
const ROUTES = new Map(DATA.routes.map((route) => [`${route.from}>${route.to}`, route]));

let pluginApi;
let core;

function stationOf(npc) {
  const at = npc?.getLocation?.();
  if (!at) return null;
  let nearest = null;
  let nearestDistance = STATION_RANGE + 1;
  for (const station of STATIONS.values()) {
    const distance = Math.max(Math.abs(station.takeoff[0] - at.getX()), Math.abs(station.takeoff[1] - at.getY()));
    if (distance < nearestDistance) {
      nearest = station;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function questComplete(player, key) {
  if (!key) return true;
  const request = { player, key, complete: null };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** A destination whose Rug Merchant the player can't see yet isn't offered. */
function destinations(player, station) {
  return station.travel.filter((key) => questComplete(player, STATIONS.get(key).quest));
}

function fareFor(player) {
  const diary = { player, diary: DESERT_DIARY, tier: FREE_RIDES_TIER, complete: null };
  pluginApi.emitCustomEvent("diary:is-complete", diary);
  if (diary.complete === true) return 0;
  const ring = player.getEquipment().get(core.Equipment.RING_SLOT)?.getId?.() === core.ItemIdentifiers.RING_OF_CHAROS_A_;
  // Rogue Trader's reward (Wiki): 100 instead of 200, and 75 instead of 100 with the ring.
  const cheap = { player, cheap: false };
  pluginApi.emitCustomEvent("rogue-trader:cheap-flights", cheap);
  if (cheap.cheap === true) return ring ? DATA.fare.cheapCharos : DATA.fare.cheap;
  return ring ? DATA.fare.charos : DATA.fare.coins;
}

function riding(player) {
  return player.getAttribute(RIDE_ATTRIBUTE) != null;
}

function depart(player, from, to) {
  const route = ROUTES.get(`${from.key}>${to}`);
  if (!route || riding(player)) return;
  const fare = fareFor(player);
  const inventory = player.getInventory();
  if (fare > 0) {
    if (inventory.getAmount(core.ItemIdentifiers.COINS) < fare) {
      player.getPacketSender().sendInterfaceRemoval();
      player.sendMessage(`You need ${fare} coins to travel on a magic carpet.`);
      return;
    }
    inventory.deleteNumber(core.ItemIdentifiers.COINS, fare);
    inventory.refreshItems();
  }
  const task = new RideTask(player, from, route);
  player.setAttribute(RIDE_ATTRIBUTE, task);
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
  core.TaskManager.submit(task);
}

function openTravelMenu(event) {
  const { player, npc } = event;
  const station = stationOf(npc);
  if (!station) return false;
  if (riding(player)) return true;
  const fare = fareFor(player);
  const title = fare > 0 ? `Carpet rides cost ${fare} coins.` : FREE_TITLE;
  const pairs = destinations(player, station).flatMap((key) => [STATIONS.get(key).label, () => depart(player, station, key)]);
  pluginApi.sendMultiChatboxPrompt(player, title, ...pairs, "Cancel", closeChat);
  return true;
}

function closeChat(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

/** The transcript's station, quest and item conditions for the merchant being talked to. */
function answerCondition({ player, npc, definition, text }) {
  if (definition?.getName?.() !== RUG_MERCHANT) return null;
  const station = stationOf(npc);
  if (station && (text === station.fromCondition || text === station.atCondition)) return true;
  if (DATA.stations.some((entry) => text === entry.fromCondition || text === entry.atCondition)) return false;
  if (Object.hasOwn(QUEST_CONDITIONS, text)) return questComplete(player, QUEST_CONDITIONS[text]);
  if (text === FEUD_INCOMPLETE_CONDITION) return !questComplete(player, QUEST_CONDITIONS["If the player has completed The Feud:"]);
  if (text === MONKEYSPEAK_IN_INVENTORY_CONDITION) return ownsMonkeyspeak([player.getInventory()]);
  if (text === MONKEYSPEAK_IN_BANK_CONDITION) {
    const banks = player.getBanks().filter((_bank, tab) => tab !== core.Bank.BANK_SEARCH_TAB_INDEX);
    return ownsMonkeyspeak(banks);
  }
  return null;
}

function ownsMonkeyspeak(containers) {
  const { MSPEAK_AMULET } = core.ItemIdentifiers;
  return containers.some((container) => container?.contains?.(MSPEAK_AMULET));
}

/** The player's travel answer ("I want to travel to Uzer.") flies them once it's continued. */
function travelLine(request) {
  const { player, npc, definition, step } = request;
  if (definition?.getName?.() !== RUG_MERCHANT || typeof step?.player !== "string") return;
  const station = stationOf(npc);
  const to = station?.talk?.[step.player];
  if (to) request.after = () => depart(player, station, to);
}

function blockTeleport(event) {
  if (riding(event.player)) event.allow = false;
}

function finishOnLogout({ player }) {
  player.getAttribute(RIDE_ATTRIBUTE)?.fastForward();
}

function hideTabs(player) {
  const sender = player.getPacketSender();
  for (const slot of [COMBAT_TAB, MAGIC_TAB, ...HIDDEN_TABS.map(([tab]) => tab)]) {
    sender.closeSubInterface((TOPLEVEL << 16) | slot);
  }
  sender.sendClientScript(SIDEBUTTON_SWITCH_SCRIPT, TAKEOFF_TAB);
}

function restoreTabs(player) {
  const sender = player.getPacketSender();
  sender.sendTabInterface(0, COMBAT_INTERFACE);
  sender.sendTabInterface(6, player.getSpellbook().getInterfaceId());
  for (const [slot, group] of HIDDEN_TABS) sender.sendTabInterface(slot, group);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  sender.sendClientScript(SIDEBUTTON_SWITCH_SCRIPT, LANDING_TAB);
}

/**
 * Aloft, the appearance holds the carpet (obj 5614) in the weapon slot and no shield, as the
 * carpet sequences' own hands do; the worn equipment is untouched. The client draws a
 * sequence's hand items only for the action animation, not for carpet_flying as a movement
 * animation, so without this the carpet vanishes once carpet_raise ends.
 */
function setFlying(player, flying) {
  const { WEAPON_SLOT, SHIELD_SLOT } = core.Equipment;
  player.setRenderAnimations(flying ? new Array(RENDER_SLOTS).fill(FLYING_ANIMATION) : null);
  player.setDisplayedEquipment(flying ? { [WEAPON_SLOT]: core.ItemIdentifiers.MAGIC_CARPET, [SHIELD_SLOT]: -1 } : null);
}

function animate(player, id) {
  player.performAnimation(id < 0 ? core.Animation.DEFAULT_RESET_ANIMATION : new core.Animation(id));
}

function camera(player, shot) {
  const sender = player.getPacketSender();
  const [, kind, x, y, height, rate, rate2] = shot;
  if (kind === "reset") sender.sendCameraReset();
  else if (kind === "moveto") sender.sendCameraMoveTo(x, y, height, { rate, rate2 });
  else if (kind === "lookat") sender.sendCameraLookAt(x, y, height, { rate, rate2 });
}

/** One step towards `tile`; false once the player stands on it. */
function stepTowards(player, tile) {
  const at = player.getLocation();
  const dx = Math.sign(tile[0] - at.getX());
  const dy = Math.sign(tile[1] - at.getY());
  if (dx === 0 && dy === 0) return false;
  player.setLocation(new core.Location(at.getX() + dx, at.getY() + dy, at.getZ()));
  player.setWalkingDirection(core.Direction.fromDeltas(dx, dy));
  player.getMovementQueue().handleRegionChange();
  return true;
}

function toLocation(player, [x, y]) {
  return new core.Location(x, y, player.getLocation().getZ());
}

/** Lazily built: `api.core.Task` only exists once the plugin registers. */
let RideTask;

function createRideTask(Task) {
  /**
   * A ride, tick by tick: the walk to the take-off tile, then the captured flight counted from
   * sitting down. Not keyed to the player: moveTo's teleport listeners must not stop it.
   */
  return class extends Task {
    constructor(player, from, route) {
      super(1);
      this.player = player;
      this.from = from;
      this.route = route;
      this.started = false;
      this.sitAt = null;
      this.flightTick = -1;
      this.pending = null;
      this.finished = false;
    }

    execute() {
      if (this.player.isDyingReturn?.() === true) {
        this.abandon();
        return;
      }
      if (!this.started) this.setOff();
      else if (this.sitAt == null) this.walk();
      if (this.sitAt == null) return;
      if (--this.sitAt > 0) return;
      this.fly(++this.flightTick);
    }

    setOff() {
      this.started = true;
      const { player, route } = this;
      player.getPacketSender().sendInterfaceRemoval();
      // Live stops facing the merchant here; the walk to the carpet then faces the way it goes.
      player.setMobileInteraction(null);
      for (const shot of route.camera) if (shot[0] < 0) camera(player, shot);
      this.walk();
    }

    walk() {
      const { player } = this;
      if (stepTowards(player, this.from.takeoff) && !this.on(this.from.takeoff)) return;
      player.getPacketSender().sendSong(SILENCE_SONG).sendJingle(CARPET_JINGLE, CARPET_JINGLE_LENGTH_MS);
      this.sitAt = SIT_DELAY + 1;
    }

    on([x, y]) {
      const at = this.player.getLocation();
      return at.getX() === x && at.getY() === y;
    }

    fly(tick) {
      const { player, route } = this;
      const sender = player.getPacketSender();
      if (this.pending) {
        player.setForceMovement(null);
        player.moveTo(toLocation(player, this.pending));
        this.pending = null;
      }
      if (tick === 0) {
        animate(player, SIT_DOWN_ANIMATION);
        const first = route.steps[0];
        player.setPositionToFace(toLocation(player, [first[1], first[2]]));
        hideTabs(player);
      } else if (tick === 1) {
        sender.sendVarbit(HIDE_CARPETS_VARBIT, 1);
        animate(player, RAISE_ANIMATION);
        setFlying(player, true);
        sender.sendSound(RAISE_SOUND, 1, 0);
      }
      for (const step of route.steps) {
        if (step[0] === tick) this.move(step);
      }
      for (const shot of route.camera) {
        if (shot[0] === tick) camera(player, shot);
      }
      if (tick === route.land) {
        animate(player, LAND_ANIMATION);
        sender.sendSound(LAND_SOUND, 1, 0);
      } else if (tick === route.land + 1) {
        sender.sendVarbit(HIDE_CARPETS_VARBIT, 0);
        animate(player, -1);
        setFlying(player, false);
        stepTowards(player, route.walkOff);
        restoreTabs(player);
      } else if (tick === route.land + 2) {
        this.arrive();
      }
    }

    move([, x, y, angle, cycles = DEFAULT_MOVE_CYCLES]) {
      const { player } = this;
      const at = player.getLocation();
      player.setForceMovement(new core.ForceMovement(
        at.clone(),
        new core.Location(x - at.getX(), y - at.getY()),
        0,
        cycles,
        CARDINAL_DIRECTIONS[angle] ?? angle,
        -1,
      ));
      this.pending = [x, y];
    }

    /** Death aloft: undoes what the ride changed and moves nothing, as the respawn is the death's. */
    abandon() {
      if (this.finished) return;
      const { player, route, flightTick } = this;
      const sender = player.getPacketSender();
      this.pending = null;
      player.setForceMovement(null);
      if (flightTick >= 1 && flightTick <= route.land) {
        sender.sendVarbit(HIDE_CARPETS_VARBIT, 0);
        setFlying(player, false);
      }
      if (flightTick >= 0 && flightTick <= route.land) restoreTabs(player);
      sender.sendCameraReset();
      this.finish(false);
    }

    /** Lands the rider at once (logout mid-flight). */
    fastForward() {
      if (this.finished) return;
      if (this.player.isDyingReturn?.() === true) {
        this.abandon();
        return;
      }
      const { player, route } = this;
      player.setForceMovement(null);
      if (this.flightTick >= 1) setFlying(player, false);
      player.setLocation(toLocation(player, route.walkOff));
      this.arrive();
    }

    arrive() {
      const { player, route } = this;
      const task = DIARY_TASKS[`${route.from}>${route.to}`];
      if (task) pluginApi.emitCustomEvent("diary:task", { player, diary: DESERT_DIARY, task });
      this.finish();
    }

    /** `free`: false when the movement lock is someone else's, a death's. */
    finish(free = true) {
      if (this.finished) return;
      this.finished = true;
      super.stop();
      const { player } = this;
      player.setAttribute(RIDE_ATTRIBUTE, null);
      if (free) player.getMovementQueue().setBlockMovement(false);
    }

    /** Anything that cancels the task must still free the rider. */
    stop() {
      if (!this.finished) {
        this.fastForward();
        return;
      }
      super.stop();
    }
  };
}

function init(api) {
  pluginApi = api;
  core = api.core;
  RideTask = createRideTask(core.Task);
}

module.exports = {
  name: "MagicCarpets",
  members: true,
  register(api) {
    init(api);
    api.onNpcInteraction(RUG_MERCHANT, { Travel: openTravelMenu });
    api.onNpcDialogueCondition(answerCondition);
    api.onCustomEvent("npc-dialogue:line", travelLine);
    api.onCanTeleport(blockTeleport);
    api.onPlayerLogout(finishOnLogout);
  },
};
