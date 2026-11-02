"use strict";

// Live timeline (1625, 127, 91): the plant appears with sequence 348 and the smoke; ignored, it
// plays 350 at +110 ticks and goes 21 ticks later in smoke. Picking (or dismissing) plays 350 at
// once and also leaves 21 ticks on. See SOURCES.md.
// The picking refusal text and the growth time are from LostCity's macro_event_triffid.rs2,
// the only source there is; no capture picks early, and the Wiki only says the plant must be
// fully grown.
const GROW_ANIMATION = 348;
const WITHER_ANIMATION = 350;
const WITHER_TICKS = 21;
const LIFETIME_TICKS = 110;
const TICK_MS = 600;
const GROWTH_MS = 45 * TICK_MS;
const PICK_SOUND = 2581; // 1625 tick 1608.
const SPAM_CHAT_TYPE = 105;

function addDefinition(api, { definitions }) {
  definitions.push({ id: api.core.NpcIdentifiers.STRANGE_PLANT, kind: "plant", stationary: true,
    lifetimeMs: LIFETIME_TICKS * TICK_MS, witherAnimation: WITHER_ANIMATION, witherTicks: WITHER_TICKS,
    otherPlayerMessage: "It's not here for you.", // 3275 tick 25657.
    onSpawn: grow.bind(null, api), talk: pick.bind(null, api) });
}

function grow(api, active) {
  active.npc.performAnimation(new api.core.Animation(GROW_ANIMATION));
}

function pick(api, active, { valid, serve }) {
  const player = active.player;
  if (!valid(active, player)) return;
  if (Date.now() - active.startedAt < GROWTH_MS) {
    player.sendMessage("The fruit isn't ready to be picked yet...");
    return;
  }
  // The Wiki keeps a dropped fruit visible only to its picker, though it is tradeable.
  if (serve(active, [api.core.ItemIdentifiers.STRANGE_FRUIT], null, { alwaysPrivate: true })) {
    const sender = player.getPacketSender();
    sender.sendTypedMessage(SPAM_CHAT_TYPE, "You pick the fruit from the plant.");
    sender.sendSound(PICK_SOUND, 1, 0);
  }
}

module.exports = { addDefinition };
