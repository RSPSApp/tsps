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
// the inventory (or equipped); worn lamps only work while equipped. The firemaking and max
// capes are the group that works from either.
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
  ItemIds.FIREMAKING_CAPE,
  ItemIds.FIREMAKING_CAPE_T_,
  ItemIds.FIREMAKING_CAPE_2,
  ItemIds.FIREMAKING_CAPE_T__2,
  ItemIds.MAX_CAPE,
  ItemIds.MAX_CAPE_2,
  ItemIds.MAX_CAPE_3,
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

let pluginApi;

function containerHasLightSource(container, ids) {
  const items = container?.getItems?.() ?? [];
  for (const item of items) {
    if (item && ids.has(item.getId())) {
      return true;
    }
  }
  return false;
}

function hasLightSource(player) {
  if (containerHasLightSource(player?.getInventory?.(), CARRIED_LIGHT_SOURCE_IDS)) {
    return true;
  }
  const equipment = player?.getEquipment?.();
  return (
    containerHasLightSource(equipment, CARRIED_LIGHT_SOURCE_IDS) ||
    containerHasLightSource(equipment, EQUIPPED_LIGHT_SOURCE_IDS)
  );
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

function processDarkness(player) {
  if (hasLightSource(player)) {
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
function canAttackInDarkness(attacker) {
  if (!attacker?.isPlayer?.() || hasLightSource(attacker)) {
    return null;
  }
  return false;
}

function createDarkArea(api) {
  class DarkArea extends api.core.Area {
    process(mobile) {
      if (mobile.isPlayer()) {
        processDarkness(mobile.getAsPlayer());
      }
    }

    postLeave(mobile) {
      if (mobile.isPlayer()) {
        clearDarknessTimer(mobile);
      }
    }

    canAttack(attacker) {
      return canAttackInDarkness(attacker);
    }
  }

  return new DarkArea(LUMBRIDGE_SWAMP_CAVES_BOUNDS);
}

module.exports = {
  name: "Darkness",
  hasLightSource,
  darknessTickMessage,
  takesDarknessDamage,
  DARKNESS_WARNING_TICKS,
  DARKNESS_SWARM_TICKS,
  LUMBRIDGE_SWAMP_CAVES_BOUNDS,
  register(api) {
    pluginApi = api;
    api.registerArea(createDarkArea(api));
    api.log("registered", {
      carriedLightSources: CARRIED_LIGHT_SOURCE_IDS.size,
      equippedLightSources: EQUIPPED_LIGHT_SOURCE_IDS.size,
      darkAreas: ["Lumbridge Swamp Caves"],
    });
  },
};
