/**
 * The skill obstacles, shown by the floor layout's *_state varbits (1 out, 2 done). Recorded
 * (rsprox 1862): the F3 grapple pillars, the F1 bridge and the F3 portal; the brazier only refuses.
 * Their moves come from the loc's own place, which reproduces those recordings:
 *
 * - Pillars stand in pairs two tiles apart; the swing crosses between them, from five tiles out on
 *   one side to five on the other (1862: 2413 -> 2408 -> 2403 at y 5868).
 * - A bridge has a loc at each end; the crossing runs from a tile past one end to a tile past the
 *   other (1862: 5981 -> 5975).
 * - A portal frame is five tiles wide; the pass goes through its middle tile, two tiles either side
 *   (1862: x 2386, y 5839 -> 5843).
 *
 * The requirements are the Wiki's; once a floor is sealed they refuse.
 */
const Common = require("./Common.HallowedSepulchre");
const Obstacles = require("./Obstacles.HallowedSepulchre");

const PILLAR_REACH = 5;
const NAILS = [4824, 4823, 4822, 4821, 1539, 4820, 4819];
const BRIDGE_NAILS = 5;
const BRIDGE_PLANKS = 2;

function stateOf(run, name) {
  return run.variant?.varbits?.[name] ? (run.states?.[name] ?? 1) : 0;
}

function setState(run, name, value) {
  run.states = { ...(run.states ?? {}), [name]: value };
  Common.varbit(run.player, name, value);
}

/** Agility XP for the first crossing and the return only (the *_xp_earned varbits). */
function crossingXp(run, skill, amount) {
  const name = `hallowed_${skill}_xp_earned`;
  const earned = run.xpEarned.get(skill) ?? 0;
  if (earned >= 2) return;
  run.xpEarned.set(skill, earned + 1);
  if (Common.data.varbits[name] != null) Common.varbit(run.player, name, earned + 1);
  Common.xp(run.player, "AGILITY", amount);
}

/** A template loc `id` at `tile`, in the run's instance. */
function locAt(run, id, [x, y, z]) {
  return run.area.getTemplateObjects(run.area.at([x, y, z])).some((object) => object.getId() === id);
}

function floorXp(table) {
  return (run) => table[String(run.floorNumber)] ?? 0;
}

// ------------------------------------------------------------------ the grapple

function hasGrapple(player) {
  const { items } = Common.data;
  const inventory = player.getInventory();
  if (inventory.contains(items.grapple)) return true;
  const equipment = player.getEquipment().getItems();
  const weapon = equipment[Common.core.Equipment.WEAPON_SLOT];
  if (weapon?.getId?.() === items.grapple) return true;
  const name = weapon?.getId?.() > 0 ? Common.core.CacheDefinitions.getItem(weapon.getId())?.name ?? "" : "";
  if (!/crossbow/i.test(name)) return false;
  const ammo = equipment[Common.core.Equipment.AMMUNITION_SLOT];
  return ammo?.getId?.() === items.mithGrapple || inventory.contains(items.mithGrapple);
}

/** The swing past a pillar pair, from the player's side: { from, middle, to, side } or null. */
function pillarSwing(run, [x, y, z], here) {
  const partner = [[0, 2], [0, -2], [2, 0], [-2, 0]].find(([dx, dy]) => locAt(run, Common.data.pillar, [x + dx, y + dy, z]));
  if (!partner) return null;
  const middle = [x + partner[0] / 2, y + partner[1] / 2, z];
  // The swing crosses the pair: along x for a pair on a north-south line, along y otherwise.
  const along = partner[0] === 0 ? [1, 0] : [0, 1];
  // Swing from whichever end the player can walk to: the far one is reached only by swinging.
  const ends = [1, -1].map((s) => [middle[0] + s * PILLAR_REACH * along[0], middle[1] + s * PILLAR_REACH * along[1], z]);
  const start = Obstacles.reachableEnd(run, here, ends);
  const side = start === ends[0] ? 1 : -1;
  const from = [middle[0] + side * PILLAR_REACH * along[0], middle[1] + side * PILLAR_REACH * along[1], z];
  const to = [middle[0] - side * PILLAR_REACH * along[0], middle[1] - side * PILLAR_REACH * along[1], z];
  return { from, middle, to, side };
}

function pillar(event) {
  const found = Obstacles.runAt(event);
  if (!found) return false;
  const { run, tile } = found;
  const { player } = run;
  if (!stateOf(run, "hallowed_ranged_state")) return false;
  if (run.expired) {
    player.sendMessage(Common.message("grappleExpired"));
    return true;
  }
  if (Common.level(player, "RANGED") < Common.data.requirements.ranged) {
    player.sendMessage(Common.message("skillLevel", { skill: "Ranged", level: Common.data.requirements.ranged }));
    return true;
  }
  if (!hasGrapple(player)) {
    player.sendMessage(Common.message("noGrapple"));
    return true;
  }
  const swing = pillarSwing(run, tile, run.area.templateOf(player.getLocation()));
  if (!swing) return false;
  if (!run.act(9, { agility: true })) return true;
  const { from, middle, to, side } = swing;
  const facing = Obstacles.facingOf(to[0] - from[0], to[1] - from[1]);
  player.getMovementQueue().reset();
  run.schedule(3, () => Common.spam(player, Common.message("grappleFire")));
  run.schedule(4, () => {
    Common.animate(player, "grapple", 6);
    Common.graphic(player, "grapple", 82, 6);
    const pillarObject = event.object;
    if (pillarObject) player.getPacketSender().sendObjectAnimation(pillarObject, new Common.core.Animation(Common.seq(side > 0 ? "pillarSwing" : "pillarSwingReverse")));
  });
  run.schedule(7, () => Obstacles.exactMove(run, from, middle, [15, 29], facing));
  run.schedule(8, () => {
    Obstacles.exactMove(run, middle, to, [0, 21], facing);
    player.getPacketSender().sendSound(Common.data.sounds.grappleSwing, 1, 0);
  });
  run.schedule(9, () => {
    Common.spam(player, Common.message("grappleSwing"));
    crossingXp(run, "ranged", floorXp(Common.data.xp.pillar)(run));
  });
  return true;
}

// ------------------------------------------------------------------ the bridge

function bridgeMaterials(player) {
  const inventory = player.getInventory();
  const plank = Common.data.xp.bridgeConstruction.find(([id]) => inventory.getAmount(id) >= BRIDGE_PLANKS);
  const nails = NAILS.find((id) => inventory.getAmount(id) >= BRIDGE_NAILS);
  const saw = inventory.contains(Common.data.items.saw) || inventory.contains(Common.data.items.crystalSaw);
  const hammer = inventory.contains(Common.data.items.hammerTool) || inventory.contains(Common.data.items.hammer);
  return plank && nails && saw && hammer ? { plank, nails } : null;
}

/** The crossing from the bridge end `tile` to its other end: { from, to } or null. */
function bridgeCrossing(run, [x, y, z]) {
  let partner = null;
  for (let distance = 1; distance <= 8 && !partner; distance++) {
    partner = [[0, distance], [0, -distance], [distance, 0], [-distance, 0]]
      .find(([dx, dy]) => locAt(run, Common.data.bridge, [x + dx, y + dy, z])) ?? null;
  }
  if (!partner) return null;
  const out = [-Math.sign(partner[0]), -Math.sign(partner[1])];
  return { from: [x + out[0], y + out[1], z], to: [x + partner[0] - out[0], y + partner[1] - out[1], z] };
}

function bridge(event) {
  const found = Obstacles.runAt(event);
  if (!found) return false;
  const { run, tile } = found;
  const { player } = run;
  const state = stateOf(run, "hallowed_construction_state");
  if (!state) return false;
  if (state === 1) return repairBridge(run);
  const crossing = bridgeCrossing(run, tile);
  if (!crossing) return false;
  if (!run.act(4, { agility: true })) return true;
  const { from, to } = crossing;
  player.getMovementQueue().reset();
  Common.animate(player, "logBalance", 5);
  const ticks = Math.ceil(115 / 30);
  Obstacles.exactMove(run, from, to, [5, 115], Obstacles.facingOf(to[0] - from[0], to[1] - from[1]), ticks);
  run.schedule(ticks, () => {
    player.performAnimation(new Common.core.Animation(-1));
    Common.spam(player, Common.message("bridgeCross"));
    crossingXp(run, "construction", floorXp(Common.data.xp.bridge)(run));
  });
  return true;
}

function repairBridge(run) {
  const { player } = run;
  if (run.expired) {
    player.sendMessage(Common.message("bridgeExpired"));
    return true;
  }
  if (Common.level(player, "CONSTRUCTION") < Common.data.requirements.construction) {
    player.sendMessage(Common.message("skillLevel", { skill: "Construction", level: Common.data.requirements.construction }));
    return true;
  }
  const materials = bridgeMaterials(player);
  if (!materials) {
    player.sendMessage(Common.message("noBridgeMaterials"));
    return true;
  }
  if (!run.act(2)) return true;
  player.getMovementQueue().reset();
  run.schedule(1, () => Common.animate(player, "smith"));
  run.schedule(2, () => {
    const current = bridgeMaterials(player);
    if (!current) return;
    player.getInventory().delete(current.plank[0], BRIDGE_PLANKS);
    player.getInventory().delete(current.nails, BRIDGE_NAILS);
    Common.spam(player, Common.message("bridgeRepair"));
    setState(run, "hallowed_construction_state", 2);
    Common.xp(player, "CONSTRUCTION", current.plank[1]);
  });
  return true;
}

// ------------------------------------------------------------------ the portal

/** The best enchantment spell the player can cast: [level, runes] or null. */
function enchantment(player) {
  const { Item, MagicSpellbook, PluginManager, Spell } = Common.core;
  const magic = Common.level(player, "MAGIC");
  for (const [level, runes] of Common.data.enchants) {
    if (magic < level) continue;
    const costs = runes
      .filter(([id]) => PluginManager.emitSpellRuneBypass(player, MagicSpellbook.NORMAL, -1, id) !== true)
      .map(([id, amount]) => new Item(id, amount));
    const missing = Spell.inventoryShortfall(player, costs);
    if (missing.length === 0 || PluginManager.checkSpellRuneSource(player, missing)) return costs;
  }
  return null;
}

function takeRunes(player, costs) {
  const { PluginManager, Spell } = Common.core;
  const missing = Spell.inventoryShortfall(player, costs);
  for (const rune of costs) {
    player.getInventory().delete(rune.getId(), Math.min(rune.getAmount(), player.getInventory().getAmount(rune.getId())));
  }
  if (missing.length) PluginManager.consumeSpellRuneSource(player, missing);
}

/** The pass through a portal frame from the player's side: { from, to }. */
function portalPass(run, [x, y, z], face, here) {
  // Five tiles wide: through the middle, along y for faces 0/2 and along x for 1/3.
  const alongY = face % 2 === 0;
  const middle = alongY ? [x + 2, y, z] : [x, y + 2, z];
  const ends = [1, -1].map((s) => (alongY ? [middle[0], middle[1] + 2 * s, z] : [middle[0] + 2 * s, middle[1], z]));
  const side = Obstacles.reachableEnd(run, here, ends) === ends[0] ? 1 : -1;
  const from = alongY ? [middle[0], middle[1] + 2 * side, z] : [middle[0] + 2 * side, middle[1], z];
  const to = alongY ? [middle[0], middle[1] - 2 * side, z] : [middle[0] - 2 * side, middle[1], z];
  return { from, to };
}

function portal(event) {
  const found = Obstacles.runAt(event);
  if (!found) return false;
  const { run, tile } = found;
  const { player } = run;
  const state = stateOf(run, "hallowed_magic_state");
  if (!state) return false;
  if (state === 1) return powerPortal(run);
  if (!run.act(3, { agility: true })) return true;
  const { from, to } = portalPass(run, tile, event.object.getFace?.() ?? 0, run.area.templateOf(player.getLocation()));
  player.getMovementQueue().reset();
  Common.animate(player, "floatUp", 10);
  run.schedule(1, () => {
    Common.spam(player, Common.message("portalPass"));
    Obstacles.exactMove(run, from, to, [10, 60], Obstacles.facingOf(to[0] - from[0], to[1] - from[1]), 2);
  });
  run.schedule(2, () => Common.animate(player, "floatDown"));
  run.schedule(3, () => crossingXp(run, "magic", floorXp(Common.data.xp.portal)(run)));
  return true;
}

function powerPortal(run) {
  const { player } = run;
  if (run.expired) {
    player.sendMessage(Common.message("portalExpired"));
    return true;
  }
  const costs = enchantment(player);
  if (!costs) {
    player.sendMessage(Common.message("portalNoSpell"));
    return true;
  }
  if (!run.act(5)) return true;
  player.getMovementQueue().reset();
  run.schedule(2, () => Common.animate(player, "cast"));
  run.schedule(4, () => {
    const current = enchantment(player);
    if (!current) return;
    takeRunes(player, current);
    Common.spam(player, Common.message("portalPower"));
    setState(run, "hallowed_magic_state", 2);
    Common.xp(player, "MAGIC", Common.data.xp.portalMagic);
  });
  return true;
}

// ------------------------------------------------------------------ the brazier

function brazier(event) {
  const found = Obstacles.runAt(event);
  if (!found) return false;
  const { run } = found;
  const { player } = run;
  const state = stateOf(run, "hallowed_prayer_state");
  if (!state) return false;
  if (state === 2) return true;
  if (run.expired) {
    player.sendMessage(Common.message("brazierExpired"));
    return true;
  }
  if (Common.level(player, "PRAYER") < Common.data.requirements.prayer) {
    player.sendMessage(Common.message("skillLevel", { skill: "Prayer", level: Common.data.requirements.prayer }));
    return true;
  }
  const { items, requirements } = Common.data;
  const dust = player.getInventory().contains(items.symbol) ? 1 : requirements.brazierDust;
  if (player.getInventory().getAmount(items.vampyreDust) < dust) {
    Common.box(player, Common.message("brazierOffering"));
    return true;
  }
  player.getInventory().delete(items.vampyreDust, dust);
  Common.animate(player, "pray");
  player.sendMessage(Common.message("brazierLit"));
  setState(run, "hallowed_prayer_state", 2);
  Common.xp(player, "PRAYER", Common.data.xp.brazierPrayer);
  return true;
}

function attachSkills(api) {
  const { data } = Common;
  Obstacles.registerStart(data.pillar, (run, tile, here) => pillarSwing(run, tile, here)?.from ?? null);
  // Mended or not, a bridge end and a portal frame are used from the tile before them (recorded).
  Obstacles.registerStart(data.bridge, (run, tile) => (
    stateOf(run, "hallowed_construction_state") ? bridgeCrossing(run, tile)?.from ?? null : null));
  Obstacles.registerStart(data.portal, (run, tile, here) => {
    if (!stateOf(run, "hallowed_magic_state")) return null;
    const face = run.area.getTemplateObjects(run.area.at(tile)).find((o) => o.getId() === data.portal)?.getFace?.() ?? 0;
    return portalPass(run, tile, face, here).from;
  });
  api.onObjectClick(data.pillar, 1, pillar);
  api.onObjectClick(data.bridge, 1, bridge);
  api.onObjectClick(data.portal, 1, portal);
  api.onObjectClick(data.brazier, 1, brazier);
}

module.exports = { attachSkills, stateOf };
