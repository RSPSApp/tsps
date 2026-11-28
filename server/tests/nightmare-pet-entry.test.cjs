// Run after `yarn build`: node --test tests/nightmare-pet-entry.test.cjs
//
// Disturb on the sleeping Nightmare with a pet following is refused in a message box, before any
// warning (rsprox_transcripts/227/01757.txt:128888, tick 3914). Real Player and dialogue classes;
// only the network is stubbed.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const Common = require("../plugins/bosses/nightmare/Common.Nightmare");
const Dream = require("../plugins/bosses/nightmare/Dream.Nightmare");

const LINE = "This doesn't seem like a suitable place to take a pet.";
const npcs = {};
const emitted = [];

before(async () => {
  await CachePipeline.initialize(process.cwd());
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onNpcInteraction: (name, actions) => { npcs[name] = actions; },
    emitCustomEvent: (name, payload) => emitted.push([name, payload]),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Common.init(api);
  Dream.attachDream(api);
});

function player(t, pet, { introduced = true } = {}) {
  const p = new Player(null);
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  if (introduced) p.setAttribute(Common.SHURA_INTRO_ATTRIBUTE, true);
  if (pet) p.setAttribute("pets:current", { isRegistered: () => true });
  const chains = [];
  t.mock.method(p.getDialogueManager(), "startDialogues", (chain) => chains.push(chain));
  return { p, chains };
}

/** The text of the first dialogue a chain shows (a StatementDialogue's). */
function firstText(chain) {
  return String(chain.getDialogues().get(0)?.text);
}

test("a following pet: Disturb is refused in a message box, before the warning", (t) => {
  const { p, chains } = player(t, true);
  assert.equal(npcs["The Nightmare"].Disturb({ player: p, npc: {} }), true);
  assert.equal(chains.length, 1, "one message box");
  assert.equal(firstText(chains[0]), LINE);
  assert.ok(!Dream.dreamOf(p), "not pulled in");
});

test("no pet: Disturb goes on to the encounter warning", (t) => {
  const { p, chains } = player(t, false);
  assert.equal(npcs["The Nightmare"].Disturb({ player: p, npc: {} }), true);
  assert.equal(chains.length, 1);
  assert.doesNotMatch(firstText(chains[0]), /suitable place/);
  assert.match(firstText(chains[0]), /begin an encounter with the Nightmare/);
});

test("a pet that is no longer out does not count", (t) => {
  const { p, chains } = player(t, false);
  p.setAttribute("pets:current", { isRegistered: () => false });
  npcs["The Nightmare"].Disturb({ player: p, npc: {} });
  assert.notEqual(firstText(chains[0]), LINE);
});

test("before talking to Shura, Disturb and Inspect play her 'Come talk to me first' (rsprox 1148 2905)", (t) => {
  for (const option of ["Disturb", "Inspect"]) {
    const { p, chains } = player(t, false, { introduced: false });
    emitted.length = 0;
    assert.equal(npcs["The Nightmare"][option]({ player: p, npc: {} }), true);
    assert.equal(chains.length, 0, "no warning or inspection");
    const [name, request] = emitted.find(([event]) => event === "npc-dialogue:start") ?? [];
    assert.equal(name, "npc-dialogue:start");
    assert.equal(request.variant, Common.data.entry.shura.gateVariant);
    assert.equal(p.getAttribute(Common.SHURA_INTRO_ATTRIBUTE), true, "heard once");
    assert.ok(!Dream.dreamOf(p));
  }
});

test("Inspect with nobody in the dream says so (rsprox 3284 1383)", (t) => {
  const { p, chains } = player(t, false);
  assert.equal(npcs["The Nightmare"].Inspect({ player: p, npc: {} }), true);
  assert.equal(chains.length, 1);
  assert.match(firstText(chains[0]), /There are no adventurers in the dream\. The fight has not yet started\./);
});
