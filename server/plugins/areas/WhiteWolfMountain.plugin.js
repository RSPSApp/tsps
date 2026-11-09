/**
 * The rock slide blocking the entrance to the Ice Queen's Lair on White Wolf Mountain (Wiki: Rock slide, Ice Queen's
 * Lair): loc herorockslide at 2838,3517, Investigate and Mine. Mining it needs a pickaxe and 50 Mining, which can be
 * boosted (Wiki: Ice Queen), and gives no XP. "Upon clearing the rock slide, the player will automatically walk to
 * the other side, upon which the rock slide will respawn."
 *
 * Recorded (rsprox_transcripts/234/03278.txt, three clears):
 * - Investigate: "These rocks contain nothing interesting. They are just in the way."
 * - Mine, on the tick of the click: the pickaxe's mining animation, played again two and four ticks later. One tick
 *   after the click the loc becomes rockslide2, three ticks after it rockslide4, five ticks after it invis2x2, and
 *   nine ticks after it the rock slide is back. No message.
 * - The player then walked east through the cleared tiles: 2837,3518 to 2838,3518, 2839,3518 and 2840,3517. In each
 *   recording they had already clicked the ladder beyond, so the walk-through is the Wiki's; the tiles are recorded.
 *
 * Inferred: the cache gives invis2x2 solid collision, yet the recordings walk through it, so the cleared stage removes
 * the loc instead (invis2x2 shows nothing either way). The refusals (no pickaxe, under 50 Mining) have no capture and
 * are the Mining skill's own message boxes. The rock slide isn't put back while a player stands on its tiles.
 */
const ROCK_SLIDE_NAME = "Rock slide";
const LOCS = { slide: "herorockslide", firstStage: "rockslide2", secondStage: "rockslide4" };
const MINING_LEVEL = 50;
const INVESTIGATE_MESSAGE = "These rocks contain nothing interesting. They are just in the way.";
const NO_PICKAXE_MESSAGE = "You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.";
const LEVEL_MESSAGE = `You need a Mining level of ${MINING_LEVEL} to mine this rock.`;
/** Ticks after the Mine click: [what the slide becomes, or null for cleared]. */
const STAGES = [[1, "firstStage"], [3, "secondStage"], [5, null]];
const SWING_TICKS = [2, 4];
const CLEARED_AT = 5;
const RESPAWN_AT = 9;
/** The recorded standing tiles either side: west where the miner stood, east where the walk ended. */
const WEST_SIDE = [2837, 3518];
const EAST_SIDE = [2840, 3517];

let api;
let core;
const ids = {};
/** Rock slides being cleared, by their tile key, so a second click can't start another. */
const clearing = new Set();

function tileKey(location) {
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

function messageBox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function after(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, undefined, false); }
    execute() { this.stop(); action(); }
  })());
}

function investigate({ player }) {
  player.sendMessage(INVESTIGATE_MESSAGE);
  return true;
}

function bestPickaxe(player) {
  const request = { player, pickaxe: null };
  api.emitCustomEvent("mining:best-pickaxe", request);
  return request.pickaxe;
}

/** A copy of the slide's loc as another id, in its place. */
function stageLoc(slide, id) {
  const at = slide.getLocation();
  return new core.GameObject(id, new core.Location(at.getX(), at.getY(), at.getZ()), slide.getType(), slide.getFace(), slide.getPrivateArea?.() ?? null);
}

function onFootprint(location, slide) {
  const at = slide.getLocation();
  const definition = core.ObjectDefinition.forId(slide.getId());
  const width = definition?.getSizeX?.() ?? 2;
  const length = definition?.getSizeY?.() ?? 2;
  return location.getZ() === at.getZ()
    && location.getX() >= at.getX() && location.getX() < at.getX() + width
    && location.getY() >= at.getY() && location.getY() < at.getY() + length;
}

function anyoneOn(slide) {
  return core.World.getPlayers().stream().some((other) => other && other.isRegistered() && onFootprint(other.getLocation(), slide));
}

/** Puts the rock slide back once nobody stands on its tiles. */
function respawn(slide) {
  if (anyoneOn(slide)) {
    after(1, () => respawn(slide));
    return;
  }
  core.ObjectManager.register(slide, true);
  clearing.delete(tileKey(slide.getLocation()));
}

function walkThrough(player, slide, start) {
  if (!player.isRegistered() || !player.getLocation().equals(start)) return;
  const west = start.getX() < slide.getLocation().getX();
  const [x, y] = west ? EAST_SIDE : WEST_SIDE;
  player.getMovementQueue().requestWalk(new core.Location(x, y, start.getZ()));
}

function mine({ player, object }) {
  const slide = object;
  const key = tileKey(slide.getLocation());
  if (clearing.has(key)) return true;
  const pickaxe = bestPickaxe(player);
  if (!pickaxe) {
    messageBox(player, NO_PICKAXE_MESSAGE);
    return true;
  }
  if (player.getSkillManager().getCurrentLevel(core.Skill.MINING) < MINING_LEVEL) {
    messageBox(player, LEVEL_MESSAGE);
    return true;
  }
  clearing.add(key);
  const start = player.getLocation().clone();
  player.getMovementQueue().reset();
  player.setPositionToFace(slide.getLocation());
  player.performAnimation(pickaxe.animation);
  for (const ticks of SWING_TICKS) {
    after(ticks, () => {
      if (player.isRegistered() && player.getLocation().equals(start)) player.performAnimation(pickaxe.animation);
    });
  }
  let shown = slide;
  for (const [ticks, stage] of STAGES) {
    after(ticks, () => {
      if (stage) {
        const next = stageLoc(slide, ids[stage]);
        core.ObjectManager.deregister(shown, true);
        core.ObjectManager.register(next, true);
        shown = next;
        return;
      }
      core.ObjectManager.deregister(shown, true);
      shown = null;
    });
  }
  after(CLEARED_AT, () => walkThrough(player, slide, start));
  after(RESPAWN_AT, () => respawn(slide));
  return true;
}

function resolveIds() {
  for (const [key, name] of Object.entries(LOCS)) ids[key] = core.CacheDefinitions.getLocId(name);
}

function isRockSlide(event) {
  return event.objectId === ids.slide || event.object?.getId?.() === ids.slide;
}

function investigateRockSlide(event) {
  return isRockSlide(event) ? investigate(event) : false;
}

function mineRockSlide(event) {
  return isRockSlide(event) ? mine(event) : false;
}

function bind(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  resolveIds();
}

module.exports = {
  name: "WhiteWolfMountain",
  description: "The rock slide at the Ice Queen's Lair on White Wolf Mountain: Investigate, and Mine with a pickaxe and 50 Mining to clear it and walk through.",
  members: true,
  register(pluginApi) {
    bind(pluginApi);
    pluginApi.onObjectInteraction(ROCK_SLIDE_NAME, { Investigate: investigateRockSlide, Mine: mineRockSlide });
  },
};

module.exports._test = { LOCS, ids, clearing, WEST_SIDE, EAST_SIDE, RESPAWN_AT, CLEARED_AT };
