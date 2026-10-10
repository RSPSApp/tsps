"use strict";

/**
 * Praying at the god statues (https://oldschool.runescape.wiki/w/Mage_Arena), as rsprox
 * captures (rev 235) show it. "You kneel and chant to <god>..." opens without a continue
 * button, the player prays (645) a tick later, and a tick after that:
 *
 * - the first cape an account gets lands on the floor at the statue's own tile, with a large
 *   smoke puff (188, height 60) and sound 1930 there, and a tick later the full message
 *   "...Suddenly a cape appears before you." (OSRS moves the Mage Arena varp from 6 to 7 here;
 *   tsps has no Kolodion fight, so a persisted attribute stands in for it);
 * - every later prayer asks "How many would you like to take?" (skillmulti mode 23, opening on
 *   1, at most the free inventory slots) and puts the capes straight in the pack with
 *   "...Suddenly a cape appears in your pack.", the puff one tile south of the statue.
 *
 * Cape ids: 2412 Saradomin, 2413 Guthix, 2414 Zamorak.
 */
const CAPE_RECEIVED_ATTRIBUTE = "mage-arena:cape-received";

const STATUES = Object.freeze({
  2873: Object.freeze({ name: "Saradomin", capeId: 2412, x: 2500, y: 4720 }),
  2874: Object.freeze({ name: "Zamorak", capeId: 2414, x: 2516, y: 4720 }),
  2875: Object.freeze({ name: "Guthix", capeId: 2413, x: 2507, y: 4723 }),
});

const PRAY_ANIMATION = 645;
const SMOKE_GRAPHIC = 188;
const SMOKE_HEIGHT = 60;
const CAPE_SOUND = 1930;
const TAKE_MENU_MODE = 23;
const CHANTED = "You feel a rush of energy charge through your veins.";

let api;
let core;

function statueFor(objectId) {
  return STATUES[objectId] ?? null;
}

const chantLine = (statue) => `You kneel and chant to ${statue.name}...`;
const floorLine = (statue) => `${chantLine(statue)} ${CHANTED} Suddenly a cape appears before you.`;
const packLine = (statue) => `${chantLine(statue)} ${CHANTED} Suddenly a cape appears in your pack.`;

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  const { Task } = core;
  api.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function smoke(player, statue, dy) {
  player.getPacketSender().sendGraphic(
    new core.Graphic(SMOKE_GRAPHIC, 0, SMOKE_HEIGHT),
    new core.Location(statue.x, statue.y + dy, 0)
  );
  player.getPacketSender().sendSoundEffect(CAPE_SOUND, 1, 0);
}

function capeOnFloor(player, statue) {
  smoke(player, statue, 0);
  later(1, () => {
    core.ItemOnGroundManager.registerLocation(
      player,
      new core.Item(statue.capeId, 1),
      new core.Location(statue.x, statue.y, 0)
    );
    player.setAttribute(CAPE_RECEIVED_ATTRIBUTE, true);
    core.StatementDialogue.send(player, floorLine(statue));
  });
}

function capesToPack(player, statue, amount) {
  const count = Math.min(amount, player.getInventory().getFreeSlots());
  if (count <= 0) return;
  player.getInventory().adds(statue.capeId, count);
  smoke(player, statue, -1);
  core.StatementDialogue.send(player, packLine(statue));
}

function askHowMany(player, statue) {
  const free = player.getInventory().getFreeSlots();
  if (free <= 0) {
    player.getPacketSender().sendInterfaceRemoval();
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  player.getPacketSender().sendCreationMenu(new core.CreationMenu(
    "How many would you like to take?",
    [statue.capeId],
    { execute: (_itemId, amount) => capesToPack(player, statue, amount) },
    { mode: TAKE_MENU_MODE, maxAmount: free, lastAmount: 1 }
  ));
}

function prayAt(event) {
  const statue = statueFor(event.objectId);
  if (!statue) return;
  const { player } = event;
  core.StatementDialogue.send(player, chantLine(statue), false);
  later(1, () => {
    player.performAnimation(new core.Animation(PRAY_ANIMATION, 10));
    later(1, () => {
      if (player.getAttribute(CAPE_RECEIVED_ATTRIBUTE)) {
        later(1, () => askHowMany(player, statue));
      } else {
        capeOnFloor(player, statue);
      }
    });
  });
}

module.exports = function registerStatues(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.persistAttribute(CAPE_RECEIVED_ATTRIBUTE);
  api.onObjectInteraction("Statue of Saradomin", { "Pray-at": prayAt });
  api.onObjectInteraction("Statue of Zamorak", { "Pray-at": prayAt });
  api.onObjectInteraction("Statue of Guthix", { "Pray-at": prayAt });
};

Object.assign(module.exports, {
  _test: {
    STATUES,
    CAPE_RECEIVED_ATTRIBUTE,
    statueFor,
    floorLine,
    packLine,
    capeOnFloor,
    capesToPack,
    askHowMany,
    prayAt,
    setApi(value) { api = value; },
    setCore(value) { core = value; },
  },
});
