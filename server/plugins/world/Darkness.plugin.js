const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const DARKNESS_TICKS_ATTRIBUTE = "darkness:no-light-ticks";
// OSRS Wiki Light sources: warning after 9 seconds (15 ticks), insects after 18 (30 ticks),
// then 1 damage every tick until the player leaves or lights a source.
const DARKNESS_WARNING_TICKS = 15;
const DARKNESS_SWARM_TICKS = 30;
const DARKNESS_WARNING_MESSAGE = "You hear tiny insects skittering over the ground...";
const DARKNESS_SWARM_MESSAGE = "Tiny biting insects swarm all over you!";

// OSRS Wiki Light sources table, lit variants only. Carried sources light a dark area from
// the inventory (or equipped); worn lamps only work while equipped. The Firemaking cape (and
// the max capes that keep its perk) works from either, asked of the Skillcapes plugin.
const CARRIED_LIGHT_SOURCE_IDS = new Set([
  ItemIds.LIT_TORCH,
  ItemIds.LIT_CANDLE,
  ItemIds.LIT_BLACK_CANDLE,
  ItemIds.CANDLE_LANTERN_3, // lit white candle lantern
  ItemIds.CANDLE_LANTERN_6, // lit black candle lantern
  ItemIds.OIL_LAMP_3, // lit oil lamp
  ItemIds.OIL_LANTERN_3, // lit oil lantern
  ItemIds.BULLSEYE_LANTERN_3, // lit bullseye lantern
  ItemIds.SAPPHIRE_LANTERN_3, // lit sapphire lantern
  ItemIds.EMERALD_LANTERN_2, // lit emerald lantern
]);

const EQUIPPED_LIGHT_SOURCE_IDS = new Set([
  ItemIds.MINING_HELMET, // lit mining helmet
  ItemIds.KANDARIN_HEADGEAR_1,
  ItemIds.KANDARIN_HEADGEAR_2,
  ItemIds.KANDARIN_HEADGEAR_3,
  ItemIds.KANDARIN_HEADGEAR_4,
  ItemIds.BRUMA_TORCH,
  ItemIds.BRUMA_TORCH_2,
  // Charged abyssal lanterns (every log colour/type; unlit 26822 has no light).
  ItemIds.ABYSSAL_LANTERN_NORMAL_LOGS_,
  ItemIds.ABYSSAL_LANTERN_NORMAL_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_BLUE_LOGS_,
  ItemIds.ABYSSAL_LANTERN_BLUE_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_RED_LOGS_,
  ItemIds.ABYSSAL_LANTERN_RED_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_WHITE_LOGS_,
  ItemIds.ABYSSAL_LANTERN_WHITE_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_PURPLE_LOGS_,
  ItemIds.ABYSSAL_LANTERN_PURPLE_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_GREEN_LOGS_,
  ItemIds.ABYSSAL_LANTERN_GREEN_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_OAK_LOGS_,
  ItemIds.ABYSSAL_LANTERN_OAK_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_WILLOW_LOGS_,
  ItemIds.ABYSSAL_LANTERN_WILLOW_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_MAPLE_LOGS_,
  ItemIds.ABYSSAL_LANTERN_MAPLE_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_YEW_LOGS_,
  ItemIds.ABYSSAL_LANTERN_YEW_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_BLISTERWOOD_LOGS_,
  ItemIds.ABYSSAL_LANTERN_BLISTERWOOD_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_MAGIC_LOGS_,
  ItemIds.ABYSSAL_LANTERN_MAGIC_LOGS__2,
  ItemIds.ABYSSAL_LANTERN_REDWOOD_LOGS_,
  ItemIds.ABYSSAL_LANTERN_REDWOOD_LOGS__2,
]);

// Lumbridge Swamp Caves, excluding the light-optional Chasm of Tears to the north (Juna and
// the light creatures sit at y~9516) and Dorgesh-Kaan to the south.
const LUMBRIDGE_SWAMP_CAVES_BOUNDS = [new Boundary(3136, 3264, 9536, 9600, 0)];
// The Mole Hole under Falador Park (Wiki, Light source: "Light source required"; Mole Hole: a
// light source is not required after the player has built a Fire of Eternal Light there,
// my2arm_fire_mole). The bounds are GiantMole's Look-inside lair.
const MOLE_HOLE_BOUNDS = [new Boundary(1720, 1795, 5120, 5250, 0)];

/**
 * Each dark area, with the varbit of a Fire of Eternal Light that lights it for good, if any (Wiki: Fire of
 * Eternal Light, an inextinguishable light source in its area; FireOfEternalLight builds them).
 */
const DARK_AREAS = [
  { name: "Lumbridge Swamp Caves", bounds: LUMBRIDGE_SWAMP_CAVES_BOUNDS, fireVarbit: "my2arm_fire_lumb" },
  { name: "Mole Hole", bounds: MOLE_HOLE_BOUNDS, fireVarbit: "my2arm_fire_mole" },
];

let pluginApi;

function containerHasLightSource(container, ids, excludedItem) {
  const items = container?.getItems?.() ?? [];
  for (const item of items) {
    if (item && item !== excludedItem && ids.has(item.getId())) {
      return true;
    }
  }
  return false;
}

function carriesFiremakingCape(player) {
  const request = { player, skill: "FIREMAKING", inventory: true, result: false };
  pluginApi?.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

function hasLightSource(player, excludedInventoryItem) {
  if (containerHasLightSource(player?.getInventory?.(), CARRIED_LIGHT_SOURCE_IDS, excludedInventoryItem) || carriesFiremakingCape(player)) {
    return true;
  }
  const equipment = player?.getEquipment?.();
  return (
    containerHasLightSource(equipment, CARRIED_LIGHT_SOURCE_IDS) ||
    containerHasLightSource(equipment, EQUIPPED_LIGHT_SOURCE_IDS)
  );
}

/** The dark area at `location`, or null where it is not dark. */
function darkAreaAt(location) {
  if (!location) return null;
  return DARK_AREAS.find((area) => area.bounds.some((bounds) => bounds.inside(location))) ?? null;
}

/** Whether the player has built the Fire of Eternal Light that lights `area` for good. */
function fireLit(player, area) {
  if (!area?.fireVarbit || !pluginApi) return false;
  const id = pluginApi.core.CacheDefinitions.getVarbitId(area.fireVarbit);
  return id != null && Number(player?.getPacketSender?.()?.getVarbit?.(id) ?? 0) === 1;
}

/** Whether the player can see in `area`: a light source of their own, or its fire built. */
function canSee(player, area, excludedInventoryItem) {
  return hasLightSource(player, excludedInventoryItem) || fireLit(player, area);
}

/** Whether the player can see at `location`; anywhere not dark always. */
function canSeeAt(player, location, excludedInventoryItem) {
  const area = darkAreaAt(location);
  return area == null || canSee(player, area, excludedInventoryItem);
}

/**
 * Whether giving up `item` (putting it out or dropping it) would leave the player unable to see where they stand:
 * they can see now, and could not without it.
 */
function wouldLeaveInDark(player, item) {
  const location = player?.getLocation?.();
  return canSeeAt(player, location) && !canSeeAt(player, location, item);
}

/**
 * Refuses giving up the last light in a dark area with `message`, as a game message (rsprox captures, local 1000134
 * ticks 341 and 370 in Lumbridge Swamp Caves: "Extinguishing the lantern/candle would leave you without a light
 * source."). Returns whether it refused.
 */
function refuseLastLight(player, item, message) {
  if (!wouldLeaveInDark(player, item)) return false;
  player.sendMessage(message);
  return true;
}

// rsprox captures, local 1000134 tick 372: Drop on the only lit candle in Lumbridge Swamp Caves keeps it, with this game
// message and no drop sound.
const LAST_LIGHT_DROP_MESSAGE = "Dropping that would leave you without a light source.";

/** Drop policy: the last carried light in a dark area stays in the inventory. */
function dropLastLight(event) {
  if (!CARRIED_LIGHT_SOURCE_IDS.has(event.itemId)) return;
  if (refuseLastLight(event.player, event.item, LAST_LIGHT_DROP_MESSAGE)) event.handled = true;
}

function darknessTickMessage(ticks) {
  if (ticks === DARKNESS_WARNING_TICKS) {
    return DARKNESS_WARNING_MESSAGE;
  }
  if (ticks === DARKNESS_SWARM_TICKS) {
    return DARKNESS_SWARM_MESSAGE;
  }
  return null;
}

function takesDarknessDamage(ticks) {
  return ticks >= DARKNESS_SWARM_TICKS;
}

function clearDarknessTimer(player) {
  if (player.getAttribute(DARKNESS_TICKS_ATTRIBUTE) !== undefined) {
    player.setAttribute(DARKNESS_TICKS_ATTRIBUTE, undefined);
  }
}

function processDarkness(player, area) {
  if (canSee(player, area)) {
    clearDarknessTimer(player);
    return;
  }

  const ticks = (player.getAttribute(DARKNESS_TICKS_ATTRIBUTE) ?? 0) + 1;
  player.setAttribute(DARKNESS_TICKS_ATTRIBUTE, ticks);

  const message = darknessTickMessage(ticks);
  if (message) {
    player.sendMessage(message);
  }
  if (takesDarknessDamage(ticks)) {
    player
      .getCombat()
      .getHitQueue()
      .addPendingDamage([new pluginApi.core.HitDamage(1, pluginApi.core.HitMask.RED)]);
  }
}

// OSRS Wiki: players cannot attack without a light source in a dark area, but can be attacked.
function canAttackInDarkness(attacker, area) {
  if (!attacker?.isPlayer?.() || canSee(attacker, area)) {
    return null;
  }
  return false;
}

/**
 * The dark-area tick and attack rule for a private copy of a dark area (an instance is a
 * PrivateArea over the same tiles, so the registered dark area never sees its players).
 */
function processDarknessAt(player) {
  const area = darkAreaAt(player.getLocation());
  if (area) processDarkness(player, area);
  else clearDarknessTimer(player);
}

function canAttackInDarknessAt(attacker) {
  const area = darkAreaAt(attacker?.getLocation?.());
  return area ? canAttackInDarkness(attacker, area) : null;
}

function createDarkArea(api, dark) {
  class DarkArea extends api.core.Area {
    constructor() {
      super(dark.bounds);
      this.dark = dark;
    }

    getName() {
      return dark.name;
    }

    process(mobile) {
      if (mobile.isPlayer()) {
        processDarkness(mobile.getAsPlayer(), dark);
      }
    }

    postLeave(mobile) {
      if (mobile.isPlayer()) {
        clearDarknessTimer(mobile);
      }
    }

    canAttack(attacker) {
      return canAttackInDarkness(attacker, dark);
    }
  }

  return new DarkArea();
}

module.exports = {
  name: "Darkness",
  description: "Makes Lumbridge Swamp Caves and the Mole Hole dark: without a lit light source you are warned, then bitten by insects every tick, and cannot attack; your last light cannot be dropped there.",
  hasLightSource,
  darkAreaAt,
  canSee,
  canSeeAt,
  wouldLeaveInDark,
  refuseLastLight,
  LAST_LIGHT_DROP_MESSAGE,
  processDarknessAt,
  canAttackInDarknessAt,
  clearDarknessTimer,
  darknessTickMessage,
  takesDarknessDamage,
  DARKNESS_WARNING_TICKS,
  DARKNESS_SWARM_TICKS,
  LUMBRIDGE_SWAMP_CAVES_BOUNDS,
  MOLE_HOLE_BOUNDS,
  register(api) {
    pluginApi = api;
    for (const dark of DARK_AREAS) api.registerArea(createDarkArea(api, dark));
    api.onItemDropPolicy(dropLastLight);
    api.log("registered", {
      carriedLightSources: CARRIED_LIGHT_SOURCE_IDS.size,
      equippedLightSources: EQUIPPED_LIGHT_SOURCE_IDS.size,
      darkAreas: DARK_AREAS.map((dark) => dark.name),
    });
  },
};
