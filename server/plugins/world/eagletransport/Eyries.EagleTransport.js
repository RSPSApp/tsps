/**
 * Getting into the three far eyries on foot (Wiki: Eagle_transport_system, Growing_vine):
 * - each has a cave in and a cave out;
 * - Feldip's entrance is up a vine: a garden cane, thatching spar or teasing stick stuck in by the
 *   young vine guides it, and after about 40 minutes it is tall enough to climb ("Those vines
 *   should be worth checking on now."). The cave's exit leads down by it whenever;
 * - Uzer's eagles are behind a boulder: 45 Strength (boosts count) pushes past it, either way.
 *   NPCs don't block players here, so its tiles are clipped;
 * - Rellekka's cliff is an Agility shortcut (plugins/skills/data/agility-shortcuts.json).
 * The vine grows while the player is logged in, counted in game ticks and banked every so often
 * (and at logout), so a server restart loses little of it.
 */
const Common = require("./Common.EagleTransport");

const VINE_ATTRIBUTE = "eagle-transport:vine";
const DESERT_ATTRIBUTE = "eagle-transport:unblocked-desert";

const cycle = () => Common.core.World.getProcessCycle();

// --- Caves

function caveFor(objectId, end) {
  const { ids, data } = Common;
  return Object.values(data.eyries).find((eyrie) => ids.locs[eyrie[end]] === objectId) ?? null;
}

function enterCave({ player, objectId }) {
  const eyrie = caveFor(objectId, "enter");
  if (!eyrie) return false;
  Common.travel(player, eyrie.inside, Common.data.caveTicks);
  return true;
}

function exitCave({ player, objectId }) {
  const eyrie = caveFor(objectId, "exit");
  if (!eyrie) return false;
  Common.travel(player, eyrie.outside, Common.data.caveTicks);
  return true;
}

// --- The Feldip vine

/** { grown, since, notified }: ticks grown before `since` (the cycle it was last counted from). */
function vineState(player) {
  const state = player.getAttribute(VINE_ATTRIBUTE);
  return state && typeof state === "object" && Number.isFinite(state.grown) ? state : null;
}

function vineTicks(player) {
  const state = vineState(player);
  if (!state) return -1;
  return state.grown + Math.max(0, cycle() - (Number(state.since) || cycle()));
}

function vineStage(player) {
  const ticks = vineTicks(player);
  const { vine } = Common.data;
  if (ticks < 0) return 0;
  if (ticks >= vine.tallTicks) return vine.stages.tall;
  if (ticks >= vine.growingTicks) return vine.stages.growing;
  return vine.stages.guided;
}

function sendVine(player) {
  player.getPacketSender().sendVarbit(Common.ids.varbits.vine, vineStage(player));
}

const guideItems = () => {
  const { objs } = Common.ids;
  return [objs.gardenCane, objs.sparLight, objs.sparMedium, objs.sparDense, objs.teasingStick];
};

/** An item used on the young vine: stuck in to guide its growth (used up). */
function guideVine(event) {
  const { player } = event;
  if (event.objectId !== Common.ids.locs.vine || !guideItems().includes(event.itemId)) return;
  event.handled = true;
  if (vineState(player)) {
    player.sendMessage(Common.message("vineAlready"));
    return;
  }
  player.getInventory().delete(event.itemId, 1);
  player.setAttribute(VINE_ATTRIBUTE, { grown: 0, since: cycle(), notified: false });
  sendVine(player);
  const name = Common.core.ItemDefinition.forId(event.itemId)?.getName?.() ?? "stick";
  player.sendMessage(Common.message("vineGuided", { item: name.toLowerCase() }));
}

function climbVine({ player, objectId }) {
  if (objectId !== Common.ids.locs.vine) return false;
  if (vineStage(player) !== Common.data.vine.stages.tall) {
    player.sendMessage(Common.message("vineNotReady"));
    return true;
  }
  Common.travel(player, Common.data.eyries.jungle.inside, Common.data.caveTicks);
  return true;
}

/** The vine's stage on the player's tick: the varbit as it changes, and the line once it's tall. */
function tendVine({ player }) {
  const state = vineState(player);
  if (!state || state.notified === true) return;
  if (Number.isFinite(state.since) && cycle() - state.since >= Common.data.vine.bankEveryTicks) {
    player.setAttribute(VINE_ATTRIBUTE, { ...state, grown: vineTicks(player), since: cycle() });
    return tendVine({ player });
  }
  const stage = vineStage(player);
  if (stage === state.sentStage) return;
  state.sentStage = stage;
  sendVine(player);
  if (stage === Common.data.vine.stages.tall) {
    state.notified = true;
    player.setAttribute(VINE_ATTRIBUTE, { ...state });
    player.sendMessage(Common.message("vineGrown"));
  }
}

/** Logging out banks the growth so far; logging in counts on from now. */
function vineLogout({ player }) {
  const state = vineState(player);
  if (!state) return;
  player.setAttribute(VINE_ATTRIBUTE, { grown: vineTicks(player), since: null, notified: state.notified === true });
}

function vineLogin({ player }) {
  const state = vineState(player);
  if (state) player.setAttribute(VINE_ATTRIBUTE, { grown: state.grown, since: cycle(), notified: state.notified === true });
  sendVine(player);
  player.getPacketSender().sendVarbit(Common.ids.varbits.unblockedDesert, player.getAttribute(DESERT_ATTRIBUTE) === true ? 1 : 0);
}

// --- The Uzer boulder

/** Push: 45 Strength (boosts count) takes the player past it, whichever side they're on. */
function pushBoulder({ player, npc }) {
  const { ids, data } = Common;
  if (npc?.getId?.() !== ids.npcs.boulder) return false;
  if (player.getSkillManager().getCurrentLevel(Common.core.Skill.STRENGTH) < data.boulder.strength) {
    player.sendMessage(Common.message("boulderWeak"));
    return true;
  }
  const north = player.getLocation().getY() >= data.boulder.north[1] - 1;
  player.setAttribute(DESERT_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(ids.varbits.unblockedDesert, 1);
  player.sendMessage(Common.message("boulderPush"));
  Common.travel(player, north ? data.boulder.south : data.boulder.north, 1);
  return true;
}

/** The boulder's tiles block the passage, so Push is the way past (the Wiki's rule). */
function clipBoulder() {
  const { RegionManager } = Common.core;
  for (const [x, y] of Common.data.boulder.tiles) RegionManager.addClipping(x, y, 0, RegionManager.BLOCKED_TILE, null);
}

function attach(api) {
  api.onServerStartup(clipBoulder);
  api.onRegionLoaded(({ regionId }) => {
    const [x, y] = Common.data.boulder.tiles[0];
    if (regionId === ((x >> 6) << 8 | (y >> 6))) clipBoulder();
  });
  api.persistAttribute(VINE_ATTRIBUTE, null);
  api.persistAttribute(DESERT_ATTRIBUTE, false);
  api.onObjectInteraction("Cave", { Enter: enterCave, Exit: exitCave });
  for (const name of ["Young vine", "Growing vine", "Tall vine"]) api.onObjectInteraction(name, { Climb: climbVine });
  api.onItemOnObject(guideVine, { noted: false });
  api.onNpcInteraction("Boulder", { Push: pushBoulder });
  api.onPlayerProcess(tendVine);
  api.onPlayerLogout(vineLogout);
  api.onPlayerLogin(vineLogin);
}

module.exports = {
  attach, clipBoulder, enterCave, exitCave, guideVine, climbVine, tendVine, vineStage, vineTicks, vineLogout, vineLogin, pushBoulder,
  VINE_ATTRIBUTE, DESERT_ATTRIBUTE,
};
