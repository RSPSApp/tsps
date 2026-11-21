"use strict";

const { api, Animation, CacheDefinitions, CountdownTask, Equipment, ItemIdentifiers, TaskManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Menu = require("./Menu.Construction");

/**
 * The superior garden's topiary bush (furniture TOPIARY_BUSH): Clip sculpts it into a boss.
 *
 * rsprox captures (rec 2884, rev 230, ticks 12577-12725; rec 2581, rev 229, tick 295):
 * - Without secateurs: gamemessage "You'll need some secateurs to clip the topiary bush."
 * - With them, every shape's Clip opens the cache menu (interface 187, script 217) titled
 *   "Choose a shape" with None, Kraken, Zulrah, Kalphite Queen, Cerberus, Abyssal Sire, Skotizo,
 *   Vorkath, Alchemical Hydra, The Nightmare. On a pick the player plays `pruning_all` and synth
 *   2440 plays, the menu closes, and three ticks later the animation resets and the bush's loc
 *   becomes the shape's `poh_topiary_*` (sub 1 Kraken, 8 Alchemical Hydra, 9 The Nightmare).
 *   No message and no experience.
 *
 * Wiki (Topiary bush): clipped with secateurs or magic secateurs; each shape needs that boss
 * killed at least once (Vorkath the post-quest one; Phosani's Nightmare doesn't count for The
 * Nightmare). Kills are Combat Achievements' counts ("combat-achievements:count").
 */
const NO_SECATEURS = "You'll need some secateurs to clip the topiary bush.";
const TITLE = "Choose a shape";
const PRUNING = Ids.seq("pruning_all");
const CLIP_SOUND = 2440;
const SHAPE_DELAY_TICKS = 3;
const SECATEURS = [ItemIdentifiers.SECATEURS, ItemIdentifiers.MAGIC_SECATEURS];

const PLAIN = { label: "None", loc: Ids.loc("poh_topiary_null"), monster: null };
const SHAPES = [
  PLAIN,
  { label: "Kraken", loc: Ids.loc("poh_topiary_kraken"), monster: "Kraken" },
  { label: "Zulrah", loc: Ids.loc("poh_topiary_zulrah"), monster: "Zulrah" },
  { label: "Kalphite Queen", loc: Ids.loc("poh_topiary_kq"), monster: "Kalphite Queen" },
  { label: "Cerberus", loc: Ids.loc("poh_topiary_cerb"), monster: "Cerberus" },
  { label: "Abyssal Sire", loc: Ids.loc("poh_topiary_sire"), monster: "Abyssal Sire" },
  { label: "Skotizo", loc: Ids.loc("poh_topiary_skotizo"), monster: "Skotizo" },
  { label: "Vorkath", loc: Ids.loc("poh_topiary_vorkath"), monster: "Vorkath" },
  { label: "Alchemical Hydra", loc: Ids.loc("poh_topiary_hydra"), monster: "Alchemical Hydra" },
  { label: "The Nightmare", loc: Ids.loc("poh_topiary_nightmare"), monster: "The Nightmare" },
];
// The bush and every shape: "Topiary bush", "Kraken Topiary", ... "Alchemical Topiary".
const TOPIARY_NAMES = [...new Set(SHAPES.map(shape => CacheDefinitions.getObject(shape.loc).name))];

/** Ours: only the owner reshapes their bush (the Wiki is silent; Mounted's Configuration line). */
const NOT_OWNER = "Only the house owner can change that.";
/** Ours: no capture or Wiki line for a shape whose boss the player hasn't killed. */
const notKilled = (shape) => `You need to have killed ${shape.label} to clip that shape.`;

function hasSecateurs(player) {
  if (SECATEURS.some(id => player.getInventory().contains(id))) return true;
  return player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId() === ItemIdentifiers.MAGIC_SECATEURS;
}

function killed(player, monster) {
  const request = { player, monster, total: 0 };
  api.emitCustomEvent("combat-achievements:count", request);
  return Number(request.total) > 0;
}

function clip(event) {
  const { player } = event;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture || furniture.buildableKey !== "TOPIARY_BUSH") return false;
  if (!hasSecateurs(player)) return player.sendMessage(NO_SECATEURS), true;
  if (house.owner !== player) return player.sendMessage(NOT_OWNER), true;
  Menu.openMenu(player, TITLE, SHAPES.map(shape => shape.label), index => {
    const shape = SHAPES[index];
    if (!shape || House.houseFor(player) !== house || !hasSecateurs(player)) return;
    if (shape.monster && !killed(player, shape.monster)) return player.sendMessage(notKilled(shape));
    player.performAnimation(new Animation(PRUNING));
    player.getPacketSender().sendSound(CLIP_SOUND, 0, 0);
    TaskManager.submit(new CountdownTask(player, SHAPE_DELAY_TICKS, () => {
      player.performAnimation(new Animation(-1));
      if (House.houseFor(player) !== house) return;
      if (shape === PLAIN) delete furniture.displayObjectId;
      else furniture.displayObjectId = shape.loc;
      House.saveHouse(house);
      house.redrawFurniture();
    }));
  });
  return true;
}

function attachTopiary(api) {
  for (const name of TOPIARY_NAMES) api.onObjectInteraction(name, { Clip: clip });
}

Object.assign(module.exports, { attachTopiary, SHAPES, NO_SECATEURS, TITLE, CLIP_SOUND, PRUNING });
