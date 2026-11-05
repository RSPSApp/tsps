/**
 * Lighting a light source with a tinderbox (https://oldschool.runescape.wiki/w/Light_sources and each
 * item's page): the unlit item becomes its lit version, at the Firemaking level the Wiki gives. Lit by
 * other code: the oil lamp, oil lantern, bullseye lantern and sapphire lantern (OilLights.plugin.js, they
 * need lamp oil first), the black candle (Merlin's Crystal) and the mining helmet (Logs.Firemaking.js,
 * which also credits the Lumbridge diary). Everything else a tinderbox lights is here. The bug lantern is
 * lit the same way (Firemaking 33) though the Wiki notes it is not a light source for darkness.
 *
 * Captured (rsprox 70 tick 1626, 75 tick 11666): lighting a torch says "You light your torch." and plays
 * no sequence and no sound. Nothing else was captured, so no other item gets a message or an animation, and
 * the level refusal reuses OilLights' wording. The lit item replaces the unlit one in its slot (setId), so a
 * preset, untradeable or unbankable copy stays one, and the current level counts, so a boost lights what it
 * should (Wiki).
 *
 * The lit mining helmet can be put out again (Wiki: "You can extinguish it if you want it unlit"): the
 * old click that turned it unlit was the only way back, so a helmet lit outside the Lumbridge basement
 * could never be lit there for the diary. Extinguishing the other lights is not here.
 *
 * Not here: lighting a torch with dry sticks or on a fire or range (Wiki).
 */
let core;
/** Unlit item id -> { lit, level, message? }. */
let lights;

function build(I) {
  return new Map([
    [I.UNLIT_TORCH, { lit: I.LIT_TORCH, level: 1, message: "You light your torch." }],
    [I.CANDLE, { lit: I.LIT_CANDLE, level: 1 }],
    [I.CANDLE_LANTERN, { lit: I.CANDLE_LANTERN_3, level: 4 }], // white
    [I.CANDLE_LANTERN_4, { lit: I.CANDLE_LANTERN_6, level: 4 }], // black
    [I.UNLIT_BUG_LANTERN, { lit: I.LIT_BUG_LANTERN, level: 33 }],
    [I.EMERALD_LANTERN, { lit: I.EMERALD_LANTERN_2, level: 49 }],
  ]);
}

function light(event) {
  const { player } = event;
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(core.ItemIdentifiers.TINDERBOX)) return;
  const id = ids.find((candidate) => candidate !== core.ItemIdentifiers.TINDERBOX);
  const source = lights.get(id);
  if (!source) return;
  event.handled = true;
  const item = [event.usedItem, event.usedWithItem].find((held) => held?.getId() === id);
  if (!item || !player.getInventory().contains(core.ItemIdentifiers.TINDERBOX)) return;
  if (player.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING) < source.level) {
    player.sendMessage(`You need ${source.level} Firemaking to light this.`);
    return;
  }
  item.setId(source.lit);
  player.getInventory().refreshItems();
  if (source.message) player.sendMessage(source.message);
}

/** "Extinguish" on the lit mining helmet (5013): the unlit one (5014), on the same instance. */
function extinguishHelmet({ player, item }) {
  if (item?.getId() !== core.ItemIdentifiers.MINING_HELMET) return false;
  item.setId(core.ItemIdentifiers.MINING_HELMET_2);
  player.getInventory().refreshItems();
  return true;
}

module.exports = {
  name: "LightSources",
  members: true,
  register(api) {
    core = api.core;
    lights = build(core.ItemIdentifiers);
    api.onItemOnItem(light, { noted: false });
    api.onItemAction("Mining helmet", { Extinguish: extinguishHelmet });
  },
  _test: { build },
};
