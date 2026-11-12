/**
 * Imbued heart and saturated heart (https://oldschool.runescape.wiki/w/Imbued_heart,
 * https://oldschool.runescape.wiki/w/Saturated_heart).
 *
 * ''Invigorate'' raises the Magic level by 1 + 10% of it (4 + 10% for the saturated heart),
 * rounded down, off the base level, and the heart is never consumed: it can be activated an
 * unlimited number of times, but only once every seven minutes (five for the saturated heart) per
 * player, however many hearts they carry, and the two hearts share that wait. The wait is per
 * player, so it is kept on them rather than on the item, and it survives logging out. Death resets
 * it (Wiki, 15 August 2019). The imbued heart's boost is an ordinary temporary one, so the shared
 * boost cycle in Potions drains it a level a minute, as the Wiki says; the saturated heart's is held
 * for its five minutes and then ends. The clocks, varbits and chat lines are in
 * imbuedheart/Timers.ImbuedHeart.js, the upgrade in imbuedheart/Saturate.ImbuedHeart.js.
 */
const { boostSkill } = require("./ConsumableEffects");
const Timers = require("./imbuedheart/Timers.ImbuedHeart");
const Saturate = require("./imbuedheart/Saturate.ImbuedHeart");

const COOLDOWN_MS = 7 * 60 * 1000;
const SATURATED_COOLDOWN_MS = 5 * 60 * 1000;
const READY_AT_ATTRIBUTE = Timers.READY_AT_ATTRIBUTE;
// Wiki's refusal, quoted verbatim: "...it will be ready in around X minutes."
const DRAINED_MESSAGE = (minutes) =>
  `The heart is still drained of its power. Judging by how it feels, it will be ready in around ${minutes} minutes.`;

// Cache rev 241 spotanims; rsprox recordings 1763 (imbued) and 1696, 1702, 238/04152 (saturated).
const INVIGORATE_GRAPHIC = 1316;
const SATURATED_GRAPHIC = "imbued_heart_impact02";
const INVIGORATE_SOUND = 6847;

const IMBUED = { flat: 1, cooldownMs: COOLDOWN_MS, saturated: false };
const SATURATED = { flat: Timers.SATURATED_FLAT, cooldownMs: SATURATED_COOLDOWN_MS, saturated: true };

function invigorate(api, heart, event) {
  const { core } = api;
  const { player } = event;
  const now = Date.now();
  const nextReadyAt = Timers.readyAt(player);
  if (nextReadyAt > now) {
    player.sendMessage(DRAINED_MESSAGE(Math.ceil((nextReadyAt - now) / 60_000)));
    return;
  }

  player.setAttribute(READY_AT_ATTRIBUTE, now + heart.cooldownMs);
  boostSkill(player, core.Skill.MAGIC, heart.flat, 0.1);
  if (heart.saturated) player.setAttribute(Timers.SATURATED_UNTIL_ATTRIBUTE, now + heart.cooldownMs);
  const graphic = heart.saturated ? core.CacheDefinitions.getSpotanimId(SATURATED_GRAPHIC) : INVIGORATE_GRAPHIC;
  player.performGraphic(new core.Graphic(graphic));
  player.getPacketSender().sendSoundEffect(INVIGORATE_SOUND, 1, 0);
  Timers.process({ player });
  // "imbued-heart:invigorated" { player, itemId }: the heart activated, its boost given.
  api.emitCustomEvent("imbued-heart:invigorated", { player, itemId: event.itemId });
}

function resetOnDeath(event) {
  Timers.reset(event.player);
}

/**
 * Wiki (Imbued heart): "The quickest way a player can reset the cooldown is by travelling back and forth through the
 * ... free-for-all (white) portal, or by drinking from the Pool of Refreshment". The saturated heart shares the timer.
 */
function resetAtFerox(event) {
  if (event?.player) Timers.reset(event.player);
}

module.exports = {
  name: "ImbuedHeart",
  description: "Adds the imbued and saturated hearts' Invigorate Magic boost with its seven-minute (five for saturated) shared cooldown, and the saturated upgrade.",
  members: true,
  COOLDOWN_MS,
  _test: { invigorate, readyAt: Timers.readyAt, READY_AT_ATTRIBUTE, IMBUED, SATURATED },
  register(api) {
    Timers.attach(api);
    Saturate.attach(api);
    api.onItemAction("Imbued heart", { Invigorate: invigorate.bind(null, api, IMBUED) });
    api.onItemAction("Saturated heart", { Invigorate: invigorate.bind(null, api, SATURATED) });
    api.onPlayerDeath(resetOnDeath);
    api.onCustomEvent("pool-of-refreshment:drunk", resetAtFerox);
    api.onCustomEvent("free-for-all-portal:used", resetAtFerox);
  },
};
