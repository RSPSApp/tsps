"use strict";

/**
 * Impetuous Impulses: Puro-Puro, reached through the Zanaris crop circle (Hunter 17, not
 * boostable), Elnock's equipment gift and jar exchanges, and the magical wheat push.
 * Catching implings is already the Hunter plugin's (skills/hunter/Catching.Hunter.js); this
 * plugin adds the entry gate, the exit portal, Elnock and the wheat. Each unit lives in
 * ./impetuousimpulses/.
 */
const Entry = require("./impetuousimpulses/Entry.ImpetuousImpulses");
const Elnock = require("./impetuousimpulses/Elnock.ImpetuousImpulses");
const Wheat = require("./impetuousimpulses/Wheat.ImpetuousImpulses");
const Area = require("./impetuousimpulses/Area.ImpetuousImpulses");

module.exports = {
  name: "ImpetuousImpulses",
  members: true,
  _test: {
    init(api) {
      Entry.init(api);
      Elnock.init(api);
      Wheat.init(api);
      Area.init(api);
    },
    enterCropCircle: Entry.enterCropCircle,
    fieldOf: Entry.fieldOf,
    moveToField: Entry.moveToField,
    portalOption: Entry.portalOption,
    ENTRY_ATTRIBUTE: Entry.ENTRY_ATTRIBUTE,
    DEFAULT_FIELD: Entry.DEFAULT_FIELD,
    gift: Elnock.gift,
    trade: Elnock.trade,
    elnock: Elnock._test,
    GIFT_ATTRIBUTE: Elnock.GIFT_ATTRIBUTE,
    fastChance: Wheat.fastChance,
    mediumChance: Wheat.mediumChance,
    rollTier: Wheat.rollTier,
    pushThrough: Wheat.pushThrough,
    process: Wheat.process,
    cancel: Wheat.cancel,
    TIERS: Wheat.TIERS,
    pushes: Wheat.pushes,
  },
  register(api) {
    Entry(api);
    Elnock(api);
    Wheat(api);
    Area(api);
  },
};
