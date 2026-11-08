// Run after `yarn build`: node --test tests/royal-titans-pet-at-claim.test.cjs
// A Royal Titan's death roll is stashed for its corpse's claim, Bran (the pet) with it. Pets took Bran out of the death
// roll first and gave it to the last hitter at the death, before the stash; whoever claimed (or sacrificed) never saw
// it, and two titans rolled twice. The claim's roll (the corpse's) pays it. Real engine: every plugin loaded, the real
// npc-drops:roll listeners, a real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const BRAN = 30622;
const BRANDA = 12596;
const BRANDA_CORPSE = 14148;
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core = PM.getCoreApi();
});
after(() => PM.emitServerShutdown({}));

function npcIn(id, session) {
  const attributes = new Map([["royal-titans:encounter", session]]);
  return { getId: () => id, getAttribute: (key) => attributes.get(key) };
}

test("a titan's death roll keeps Bran for the stash; the corpse's claim roll pays it", () => {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("titan-slayer");
  const session = { players: new Set([p]) };
  const death = [{ itemId: BRAN, amount: 1 }];
  PM.emitCustomEvent("npc-drops:roll", { player: p, npc: npcIn(BRANDA, session), npcId: BRANDA, drops: death });
  assert.deepEqual(death.map((drop) => drop.itemId), [BRAN], "the death roll still holds Bran, for the stash");

  const claim = [{ itemId: BRAN, amount: 1 }];
  PM.emitCustomEvent("npc-drops:roll", { player: p, npc: npcIn(BRANDA_CORPSE, session), npcId: BRANDA, drops: claim });
  assert.deepEqual(claim, [], "the claim's roll gives the pet out");
});
