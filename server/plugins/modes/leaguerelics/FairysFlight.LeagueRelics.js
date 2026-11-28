/**
 * Fairy's Flight (https://oldschool.runescape.wiki/w/Fairy's_Flight_(Raging_Echoes_League)),
 * Trailblazer Reloaded's tier 2 and Raging Echoes' tier 3 relic, and Demonic Pacts' Nature's Accord
 * (alias `nature-s-accord`): the fairy mushroom teleports to any fairy ring, spirit tree (those the
 * character could travel to by tree) or tool leprechaun, in unlocked areas, from the Wilderness too
 * except to a spirit tree (Wiki, Fairy mushroom). The cache's options: Teleport and Last-destination
 * carried; Fairy-Ring, Spirit-tree, Tool-leprechauns and Last-destination worn.
 *
 * As live (rsprox 234/3275): Teleport asks in the chat ("Fairy mushroom teleports": "Fairy rings.",
 * "Spirit trees.", "Tool Leprechauns."), and each opens the real thing:
 * - Fairy rings: the fairy ring dials and travel log (FairyRings), with no staff or quest asked; its
 *   Confirm teleports as a ring does, within the relic's areas and from any Wilderness level.
 * - Spirit trees: the spirit trees' own menu (SpiritTrees, greyed as a tree greys them); a pick
 *   teleports as the mushroom does: human_fairy_vanish and the flower ring with synth 1098, the move
 *   3 ticks later.
 * - Tool Leprechauns: no recording; they are listed in the menu interface (187), as the trees are.
 * Last-destination repeats the last, with the mushroom's cast. Unlocking it completes Tree Gnome Village
 * (Wiki: "Unlocking this relic will autocomplete the Tree Gnome Village quest").
 */
const Common = require("./Common.LeagueRelics");
const Teleports = require("./Teleports.LeagueRelics");

const KEY = "fairy-mushroom";
/** Spirit trees keep their own Wilderness rule (Wiki: "except spirit tree locations"). */
const SPIRIT_TREE_WILDERNESS_LEVEL = 20;

let effect;
let leprechauns = null;
let cast = null;

function active(player) {
  return Common.effectActive(player, effect);
}

/** The mushroom's own teleport, as recorded (data `cast`). */
function mushroomCast() {
  cast ??= Teleports.itemCast(effect.cast);
  return cast;
}

/** Its destination remembered for Last-destination, as go remembers its own. */
function remember(player, label, location, wildernessLevel) {
  player.setAttribute(Teleports.lastAttribute(KEY), { label, x: location.getX(), y: location.getY(), z: location.getZ(), wildernessLevel });
}

/** The fairy ring dials, as a ring opens them, under the relic's rules. */
function rings(player) {
  Common.api.emitCustomEvent("fairy-rings:configure", {
    player,
    location: null,
    relic: {
      active: () => active(player),
      wildernessLevel: Teleports.ANY_WILDERNESS_LEVEL,
      refuse: (destination) => (Teleports.areaOpen(player, destination) ? null : Common.message("areaLocked")),
      chosen: (ring) => remember(player, ring.code, ring.destination, Teleports.ANY_WILDERNESS_LEVEL),
    },
  });
}

/** The spirit trees' own menu; a pick teleports with the mushroom's cast. */
function trees(player) {
  Common.api.emitCustomEvent("spirit-trees:menu", {
    player,
    relic: {
      choose: ({ name, to }) => {
        if (!Array.isArray(to)) {
          player.sendMessage(Common.message("spiritTreeUnavailable"));
          return;
        }
        const location = new Common.core.Location(to[0], to[1], to[2] ?? 0);
        Teleports.go(player, KEY, { label: name, location, wildernessLevel: SPIRIT_TREE_WILDERNESS_LEVEL }, { cast: mushroomCast() });
      },
    },
  });
}

/** The tool leprechauns, each named after the nearest fairy ring (ours: they have no names of their own). */
function leprechaunList() {
  if (leprechauns) return leprechauns;
  const { Location } = Common.core;
  const ringList = Teleports.ask("fairy-rings:destinations");
  leprechauns = Teleports.spawnsNamed("Tool Leprechaun").map((spawn) => {
    const location = new Location(spawn.x, spawn.y, spawn.level ?? 0);
    const nearest = ringList.reduce((best, ring) => {
      const distance = Math.hypot(ring.location.getX() - spawn.x, ring.location.getY() - spawn.y);
      return !best || distance < best.distance ? { ring, distance } : best;
    }, null);
    const place = nearest?.ring.name.split(":").pop().trim() || `${spawn.x}, ${spawn.y}`;
    return { label: Common.message("leprechaunNear", { place }), location };
  }).sort((a, b) => a.label.localeCompare(b.label));
  return leprechauns;
}

/** The leprechauns in the menu interface; one in a locked area is struck through. */
function tools(player) {
  Teleports.listMenu(player, Common.message("leprechaunsTitle"), leprechaunList().map((leprechaun) => ({
    label: leprechaun.label,
    locked: !Teleports.areaOpen(player, leprechaun.location),
    choose: () => Teleports.go(player, KEY, leprechaun, { cast: mushroomCast() }),
  })));
}

function teleport(player) {
  Teleports.menu(player, Common.message("fairyMushroomTitle"), [
    [Common.message("fairyRingsOption"), () => rings(player)],
    [Common.message("spiritTreesOption"), () => trees(player)],
    [Common.message("leprechaunsOption"), () => tools(player)],
  ]);
}

/** An option's handler for the relic's owner; anyone else's click goes on to the game's own (false). */
function only(fn) {
  return (event) => {
    if (!active(event.player)) return false;
    event.handled = true;
    fn(event.player);
  };
}

/** `league:relic-unlocked`: Fairy's Flight (or Nature's Accord) completes its quest (data `completes`). */
function unlocked({ player, relic }) {
  if (!player || ![effect.key, ...(effect.aliases ?? [])].includes(relic) || !effect.completes?.length) return;
  Common.api.emitCustomEvent("league:complete-quests", { player, quests: effect.completes });
}

module.exports = function attach(api) {
  effect = Common.data.effects.fairysFlight;
  api.persistAttribute(Teleports.lastAttribute(KEY), null);
  Teleports.attachMenu(api);
  api.onItemAction(effect.toolName, {
    Teleport: only(teleport),
    "Last-destination": only((player) => Teleports.goLast(player, KEY, { cast: mushroomCast() })),
    "Fairy-Ring": only(rings),
    "Spirit-tree": only(trees),
    "Tool-leprechauns": only(tools),
  });
  api.onCustomEvent("league:relic-unlocked", unlocked);
};

module.exports._test = { leprechaunList, unlocked };
