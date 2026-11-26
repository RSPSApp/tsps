// From server/: node --test tests/edgeville-trapdoor.test.cjs (after yarn build).
// Live (rsprox.net #320, #365, #426): Open on the closed trapdoor only swaps it for the open one
// ("The trapdoor opens..."); Climb-down on the open one sends "You climb down through the
// trapdoor..." and lands the player at 3096,9867.
const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const core = PluginManager.getCoreApi();
const O = core.ObjectIdentifiers;

function harness() {
  const objectHandlers = [];
  const custom = new Map();
  const api = new Proxy({
    core,
    onObjectInteraction: (name, options) => objectHandlers.push([name, options]),
    onCustomEvent: (key, fn) => custom.set(key, [...(custom.get(key) ?? []), fn]),
    emitCustomEvent: (key, event) => (custom.get(key) ?? []).forEach((fn) => fn(event)),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require("../plugins/areas/Misthalin.plugin").register(api);
  const messages = [];
  const player = { getPacketSender: () => ({ sendTypedMessage: (type, text) => messages.push([type, text]) }) };
  const climb = (objectId, x, y) => {
    const request = { player, objectId, object: { getLocation: () => new core.Location(x, y, 0) }, handled: false };
    for (const handler of custom.get("ladders:climb") ?? []) handler(request);
    return request.handled;
  };
  return { objectHandlers, custom, messages, climb };
}

test("Open on the Edgeville trapdoor is left to the captured loc swap", () => {
  const { objectHandlers } = harness();
  assert.equal(objectHandlers.some(([name, options]) => name === "Trapdoor" && "Open" in options), false);
  const swaps = require("../plugins/world/data/loc-swaps.json").swaps;
  const open = swaps.find((swap) => swap.id === O.TRAPDOOR_4 && swap.option === "Open");
  assert.equal(open.becomes, O.TRAPDOOR_6);
  assert.equal(open.message, "The trapdoor opens...");
  assert.ok(swaps.some((swap) => swap.id === O.TRAPDOOR_6 && swap.option === "Close" && swap.becomes === O.TRAPDOOR_4));
});

test("Climb-down on the open Edgeville trapdoor sends the spam line and lands at 3096,9867", () => {
  const h = harness();
  const landings = [];
  h.custom.set("ladders:climbDown", [({ destination }) => landings.push([destination.getX(), destination.getY(), destination.getZ()])]);
  assert.equal(h.climb(O.TRAPDOOR_6, 3097, 3468), true);
  assert.deepEqual(landings, [[3096, 9867, 0]]);
  assert.deepEqual(h.messages, [[core.ChatType.SPAM, "You climb down through the trapdoor..."]]);
});

test("other trapdoors and the closed one are not claimed", () => {
  const h = harness();
  h.custom.set("ladders:climbDown", [() => assert.fail("no climb")]);
  assert.equal(h.climb(O.TRAPDOOR_4, 3097, 3468), false, "the closed trapdoor has no Climb-down");
  assert.equal(h.climb(O.TRAPDOOR_6, 3405, 3507), false, "Paterdomus' open trapdoor is Priest in Peril's");
  assert.deepEqual(h.messages, []);
});
