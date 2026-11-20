// Fossil Island's Museum Camp improvements (Wiki "Museum Camp"; rsprox captures 73, local 1000187,
// 1000189 and 1000410, rev 227). The camp's tents start with chest pieces, a ring of stones, a fire
// pit, a broken spinning wheel and a half-built loom; Build (or Build on) with a hammer, the
// Construction level and the materials makes the bank chest, well, cooking pot, spinning wheel and
// loom, each for its own Construction XP. Each improvement is a multiloc on its own varbit, so the
// player sees the built form from then on, and its built option (Use, Cook, Spin, Weave) is the
// plain bank chest / range / spinning wheel / loom handler. The cleaning bench, the sixth, is built
// in FossilStorage.
//
// Recorded: the level and missing-items lines (a game message and the same line in a message box),
// the cooking pot's tinderbox line, the build animation on the arrival tick and the materials,
// success line and varbit the tick after. Ours: the hammer line and "Nails" in the missing list.
const DATA = require("./data/museum-camp.json");
const Hammers = require("../items/Hammers");

const BUILT_ATTRIBUTE = "museum-camp:built";

let api;
const building = new WeakSet();

const core = () => api.core;
const cache = () => core().CacheDefinitions;
const objId = (name) => cache().getObjId(name);
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]);

const builtKeys = (player) => {
  const value = player.getAttribute(BUILT_ATTRIBUTE);
  return Array.isArray(value) ? value : [];
};
const isBuilt = (player, build) => builtKeys(player).includes(build.key);

function sendBuilt(player, build) {
  const varbit = cache().getVarbitId(build.varbit);
  if (varbit != null) player.getPacketSender().sendVarbit(varbit, isBuilt(player, build) ? 1 : 0);
}

/** A refusal: the game message and the same line in a message box, as recorded. */
function refuse(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core();
  player.sendMessage(text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  return false;
}

const nailsHeld = (player, build) =>
  DATA.nailTypes.map(objId).find((id) => player.getInventory().getAmount(id) >= build.nails);

/** What the build still lacks, in the recorded "N x Item" order; nails last (ours). */
function missing(player, build) {
  const inventory = player.getInventory();
  const lacking = build.materials
    .filter(([name, amount]) => inventory.getAmount(objId(name)) < amount)
    .map(([name, amount]) => `${amount} x ${core().ItemDefinition.forId(objId(name)).getName()}`);
  if (build.nails > 0 && nailsHeld(player, build) == null) lacking.push(`${build.nails} x ${DATA.messages.nailsName}`);
  return lacking;
}

/** The level, tools and materials a build needs; the first refusal's line unless quiet. */
function canBuild(player, build, quiet = false) {
  const no = (text) => (quiet ? false : refuse(player, text));
  if (player.getSkillManager().getCurrentLevel(core().Skill.CONSTRUCTION) < build.level) {
    return no(fill(DATA.messages.level, { level: build.level }));
  }
  for (const [tool, line] of build.tools) {
    if (player.getInventory().getAmount(objId(tool)) <= 0) return no(line);
  }
  if (!Hammers.holdsHammer(core(), player)) return no(DATA.messages.noHammer);
  const lacking = missing(player, build);
  if (lacking.length) return no(fill(DATA.messages.missing, { items: lacking.join(", ") }));
  return true;
}

function finishBuild(player, build) {
  const inventory = player.getInventory();
  const nails = build.nails > 0 ? nailsHeld(player, build) : null;
  for (const [name, amount] of build.materials) inventory.deleteNumber(objId(name), amount);
  if (nails != null) inventory.deleteNumber(nails, build.nails);
  inventory.refreshItems();
  player.setAttribute(BUILT_ATTRIBUTE, [...builtKeys(player), build.key]);
  sendBuilt(player, build);
  player.sendMessage(build.built);
  player.getSkillManager().addExperiences(core().Skill.CONSTRUCTION, build.xp);
}

/** Build / Build on: the animation now, the improvement the tick after (recorded). */
function buildImprovement(player, object, build) {
  if (object?.getId?.() !== cache().getLocId(build.loc)) return false;
  if (building.has(player) || isBuilt(player, build)) return true;
  if (!canBuild(player, build)) return true;
  building.add(player);
  const { Animation, CountdownTask, TaskManager } = core();
  player.performAnimation(new Animation(cache().getSeqId(DATA.animation)));
  TaskManager.submit(new CountdownTask(player, DATA.buildTicks, () => {
    building.delete(player);
    // Ours: materials or tools gone by the next tick build nothing.
    if (player.isRegistered?.() === false || isBuilt(player, build) || !canBuild(player, build, true)) return;
    finishBuild(player, build);
  }));
  return true;
}

const BUILD_BY_NAME = new Map(DATA.builds.map((build) => [build.name, build]));

function buildBankChest({ player, object }) { return buildImprovement(player, object, BUILD_BY_NAME.get("Chest pieces")); }
function buildWell({ player, object }) { return buildImprovement(player, object, BUILD_BY_NAME.get("Ring of Stones")); }
function buildCookingPot({ player, object }) { return buildImprovement(player, object, BUILD_BY_NAME.get("Fire pit")); }
function buildSpinningWheel({ player, object }) { return buildImprovement(player, object, BUILD_BY_NAME.get("Broken Spinning Wheel")); }
function buildLoom({ player, object }) { return buildImprovement(player, object, BUILD_BY_NAME.get("Half-built Loom")); }

function login({ player }) {
  for (const build of DATA.builds) if (isBuilt(player, build)) sendBuilt(player, build);
}

module.exports = {
  name: "MuseumCamp",
  description: "Fossil Island Museum Camp's improvements: building the bank chest, well, cooking pot, spinning wheel and loom with Construction.",
  members: true,
  DATA,
  BUILT_ATTRIBUTE,
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(BUILT_ATTRIBUTE, []);
    api.onObjectInteraction("Chest pieces", { Build: buildBankChest });
    api.onObjectInteraction("Ring of Stones", { "Build on": buildWell });
    api.onObjectInteraction("Fire pit", { "Build on": buildCookingPot });
    api.onObjectInteraction("Broken Spinning Wheel", { "Build on": buildSpinningWheel });
    api.onObjectInteraction("Half-built Loom", { "Build on": buildLoom });
    api.onPlayerLogin(login);
  },
};
