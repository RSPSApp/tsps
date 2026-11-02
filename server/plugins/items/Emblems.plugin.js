const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");

const EMBLEM_ID_LIST = Object.freeze([
  12746, 12748, 12749, 12750, 12751, 12752, 12753, 12754, 12755, 12756,
]);
const EMBLEM_IDS = new Set(EMBLEM_ID_LIST);

const EMBLEM_TIER_1_ID = EMBLEM_ID_LIST[0];
const EMBLEM_TIER_2_ID = EMBLEM_ID_LIST[1];

function isEmblemItemId(itemId) {
  return Number.isInteger(itemId) && EMBLEM_IDS.has(itemId);
}

function resolveDowngradedEmblemId(itemId) {
  if (!isEmblemItemId(itemId) || itemId === EMBLEM_TIER_1_ID) {
    return null;
  }
  return itemId === EMBLEM_TIER_2_ID ? itemId - 2 : itemId - 1;
}

function toLocation(rawLocation, fallbackLocation) {
  if (rawLocation && typeof rawLocation.getX === "function") {
    return rawLocation;
  }
  if (
    rawLocation &&
    Number.isInteger(rawLocation.x) &&
    Number.isInteger(rawLocation.y)
  ) {
    return new Location(rawLocation.x, rawLocation.y, rawLocation.z ?? 0);
  }
  return fallbackLocation ?? null;
}

let ItemOnGroundManager;

module.exports = {
  name: "Emblems",
  register(api) {
    ItemOnGroundManager = api.getItemOnGroundManager();
    api.onShouldKeepItemOnDeath((event) => {
      const itemId = event.item?.getId?.();
      if (!isEmblemItemId(itemId)) {
        return;
      }
      event.keep = false;
    });

    api.onPlayerDeathItemDrop((event) => {
      const itemId = event.item?.getId?.();
      if (!isEmblemItemId(itemId)) {
        return;
      }

      // Prevent default death-drop flow for emblems; this plugin owns it.
      event.handled = true;

      const downgradedEmblemId = resolveDowngradedEmblemId(itemId);
      if (
        !event.shouldDropItems ||
        !event.killer ||
        !Number.isInteger(downgradedEmblemId)
      ) {
        return;
      }

      const dropLocation = toLocation(
        event.location,
        event.player?.getLocation?.()?.clone?.()
      );
      if (!dropLocation) {
        return;
      }

      ItemOnGroundManager.registerNonGlobals(
        event.killer,
        new Item(downgradedEmblemId),
        dropLocation
      );

      const droppedName =
        ItemDefinition.forId(downgradedEmblemId)?.getName?.() ?? "Mysterious emblem";
      event.killer
        ?.getPacketSender?.()
        ?.sendMessage?.(
          `@red@${event.player?.getDisplayName?.() ?? "A player"} dropped a ${droppedName}!`
        );
    });

    api.log("registered", { emblemCount: EMBLEM_IDS.size });
  },
};
