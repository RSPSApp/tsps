/**
 * Imbued heart (https://oldschool.runescape.wiki/w/Imbued_heart).
 *
 * ''Invigorate'' raises the Magic level by 1 + 10% of it, rounded down, off the base level, and
 * the heart is never consumed: it can be activated an unlimited number of times, but only once
 * every seven minutes per player, however many hearts they carry. The wait is per player, so it
 * is kept on them rather than on the item, and it survives logging out. Death resets it (Wiki,
 * 15 August 2019). The boost itself is an ordinary temporary one, so the shared boost cycle in
 * Potions drains it a level a minute, as the Wiki says the imbued heart's does.
 */
const { boostSkill } = require("./ConsumableEffects");

// Wiki: activatable once every seven minutes per player.
const COOLDOWN_MS = 7 * 60 * 1000;
// Wiki's refusal, quoted verbatim: "...it will be ready in around X minutes."
const DRAINED_MESSAGE = (minutes) =>
  `The heart is still drained of its power. Judging by how it feels, it will be ready in around ${minutes} minutes.`;
const READY_AT_ATTRIBUTE = "imbued-heart:ready-at";

// Cache rev 241: spotanim imbued_heart_impact; rsprox recording 1763.
const INVIGORATE_GRAPHIC = 1316;
const INVIGORATE_SOUND = 6847;

/** When the next activation is allowed; 0 (never used, or reset by death) means now. */
function readyAt(player) {
  const saved = Number(player.getAttribute(READY_AT_ATTRIBUTE));
  return Number.isFinite(saved) && saved > 0 ? saved : 0;
}

function invigorate(api, event) {
  const { core } = api;
  const { player } = event;
  const now = Date.now();
  const nextReadyAt = readyAt(player);
  if (nextReadyAt > now) {
    player.sendMessage(DRAINED_MESSAGE(Math.ceil((nextReadyAt - now) / 60_000)));
    return;
  }

  player.setAttribute(READY_AT_ATTRIBUTE, now + COOLDOWN_MS);
  boostSkill(player, core.Skill.MAGIC, 1, 0.1);
  player.performGraphic(new core.Graphic(INVIGORATE_GRAPHIC));
  player.getPacketSender().sendSoundEffect(INVIGORATE_SOUND, 1, 0);
  // "imbued-heart:invigorated" { player, itemId }: the heart activated, its boost given.
  api.emitCustomEvent("imbued-heart:invigorated", { player, itemId: event.itemId });
}

/** Death restores the stats, so the heart's wait goes with them (Wiki). */
function resetOnDeath(event) {
  event.player.setAttribute(READY_AT_ATTRIBUTE, 0);
}

module.exports = {
  name: "ImbuedHeart",
  members: true,
  COOLDOWN_MS,
  _test: { invigorate, readyAt, READY_AT_ATTRIBUTE },
  register(api) {
    api.persistAttribute(READY_AT_ATTRIBUTE, 0);
    api.onItemAction("Imbued heart", { Invigorate: invigorate.bind(null, api) });
    api.onPlayerDeath(resetOnDeath);
  },
};
