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
 * The torch's other two lights (Wiki: "may be used with a tinderbox or dry sticks, or used on a fire
 * or range"): dry sticks light the torch and nothing else, and the torch used on a fire or range
 * lights it. The second needs a handler of its own because Cooking registers a `fallback` that
 * otherwise answers "You can't cook that." for every item used on a range.
 */
const { COOKABLE_OBJECT_NAMES } = require("../skills/cooking/Cookers.Cooking");

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

/** A tinderbox lights anything; dry sticks light only the torch (Wiki: its required tool). */
function toolFor(ids, id) {
  if (ids.includes(core.ItemIdentifiers.TINDERBOX)) return core.ItemIdentifiers.TINDERBOX;
  if (id === core.ItemIdentifiers.UNLIT_TORCH && ids.includes(core.ItemIdentifiers.DRY_STICKS)) {
    return core.ItemIdentifiers.DRY_STICKS;
  }
  return null;
}

/** Lights `item` from `source`, or refuses on the level. Shared by both ways of lighting. */
function applyLight(player, item, source) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING) < source.level) {
    player.sendMessage(`You need ${source.level} Firemaking to light this.`);
    return;
  }
  item.setId(source.lit);
  player.getInventory().refreshItems();
  if (source.message) player.sendMessage(source.message);
}

function light(event) {
  const { player } = event;
  const ids = [event.usedItemId, event.usedWithItemId];
  const id = ids.find((candidate) => lights.has(candidate));
  if (id === undefined) return;
  const tool = toolFor(ids, id);
  if (tool === null) return;
  const source = lights.get(id);
  event.handled = true;
  const item = [event.usedItem, event.usedWithItem].find((held) => held?.getId() === id);
  if (!item || !player.getInventory().contains(tool)) return;
  applyLight(player, item, source);
}

/** The torch used on a fire or range (Wiki). Cooking's fallback would otherwise refuse it. */
function lightOnObject(event) {
  const { player } = event;
  if (event.itemId !== core.ItemIdentifiers.UNLIT_TORCH) return;
  const name = event.object?.getDefinition?.()?.getName?.();
  if (!COOKABLE_OBJECT_NAMES.has(name)) return;
  event.handled = true;
  applyLight(player, event.item, lights.get(core.ItemIdentifiers.UNLIT_TORCH));
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
    api.onItemOnObject(lightOnObject, { noted: false });
    api.onItemAction("Mining helmet", { Extinguish: extinguishHelmet });
  },
  _test: { build, lightOnObject },
};
