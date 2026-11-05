/**
 * Kharazi Jungle's Leafy Palm Trees (2975, Shake).
 *
 * Shaking drops one palm leaf on the ground by the tree, with the Wiki's 35-second cooldown per
 * tree and the transcript's (mis-named "bamboo") lines. Palm leaves are untradeable, so the
 * diary's "collect 5" is counted from ground pickups. OSRS Wiki: Leafy Palm Tree, Palm leaf.
 */
const LEAFY_PALM_TREE = "Leafy Palm Tree";
const PALM_LEAF = 2339; // ItemIdentifiers.PALM_LEAF
const COOLDOWN_MS = 35_000;
const SHAKE_MESSAGE = "You give the bamboo tree a good shake.";
const FALL_MESSAGE = "A palm leaf appears on the ground near the tree.";

let core;
let api;
/** "x,y,z" -> when that tree may be shaken again. */
const used = new Map();

function treeKey(object) {
  const at = object.getLocation();
  return `${at.getX()},${at.getY()},${at.getZ()}`;
}

function shake(event) {
  const { player, object } = event;
  if (!object) return false;
  const key = treeKey(object);
  const now = Date.now();
  if ((used.get(key) ?? 0) > now) return true;
  used.set(key, now + COOLDOWN_MS);
  player.sendMessage(SHAKE_MESSAGE);
  const item = new core.Item(PALM_LEAF, 1);
  api.getItemOnGroundManager().registerLocation(player, item, object.getLocation().clone());
  player.sendMessage(FALL_MESSAGE);
  return true;
}

module.exports = {
  name: "LeafyPalmTree",
  members: true,
  _test: { shake, treeKey, used, COOLDOWN_MS, PALM_LEAF },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onObjectInteraction(LEAFY_PALM_TREE, { Shake: shake });
  },
};
