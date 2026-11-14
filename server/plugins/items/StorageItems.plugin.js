"use strict";

/**
 * Storage items (docs/storage-items.md): the coal bag, gem bag, gem pouch, fish barrel, log basket, Forestry
 * kit, plank sack, tackle box, the Hunters' Guild meat and fur pouches and the Mastering Mixology reagent pouch. Their contents are kept on the player; gathering skills fill the open
 * ones through `storage:gather`, and smelting, Construction and fishing bait use them through
 * `storage:amount` / `storage:take`. Each container lives in ./storage/.
 */
const Storage = require("./storage/Common.StorageItems");

module.exports = {
  name: "StorageItems",
  description: "Adds the coal bag, gem bag, gem pouch, fish barrel, log basket, Forestry kit, plank sack, tackle box, meat and fur pouches and reagent pouch, filled by gathering skills.",
  members: true,
  register(api) {
    Storage.init(api);
    require("./storage/Events.StorageItems")(api);
    require("./storage/CoalBag.StorageItems")(api);
    require("./storage/GemBag.StorageItems")(api);
    require("./storage/GemSack.StorageItems")(api);
    require("./storage/GemPouch.StorageItems")(api);
    require("./storage/FishBarrel.StorageItems")(api);
    require("./storage/LogBasket.StorageItems")(api);
    // After the log basket: a forestry basket is the log basket's container, and holds a kit.
    require("./storage/ForestryKit.StorageItems")(api);
    require("./storage/PlankSack.StorageItems")(api);
    require("./storage/TackleBox.StorageItems")(api);
    require("./storage/HuntsmansKit.StorageItems")(api);
    require("./storage/HunterPouches.StorageItems")(api);
    require("./storage/ReagentPouch.StorageItems")(api);
  },
};
