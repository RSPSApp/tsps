// Run after `yarn build`: node --test tests/stack-cap-holders.test.cjs
//
// A stack can't grow past its cap, and add() drops what doesn't fit, so a holder must keep the rest and
// a reward must not take tokens for what won't arrive. Native fixture: real plugins and items. NPCs are
// registered and reached by npc_option through ClientConnection.dispatch. Short of dispatch: Zulrah's collect and Soul Wars' reward buttons through
// their exports. Held items are set on their saved attributes rather than by dying.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MAX_STACK_AMOUNT } = require("../dist/game/model/container/StackType");

const Shrine = require("../plugins/bosses/zulrah/Shrine.Zulrah");
const YamaCommon = require("../plugins/bosses/yama/Common.Yama");
const SoulWarsCommon = require("../plugins/minigames/soulwars/Common.SoulWars");
const Rewards = require("../plugins/minigames/soulwars/Rewards.SoulWars");

const HOME = [3222, 3218];
const STORED = 1000;
const NEAR_CAP = MAX_STACK_AMOUNT - 5;
const ZULRAH_HELD = "zulrah:retrieval";
const NIGHTMARE_HELD = "nightmare:held-items";
const YAMA_HELD = "yama:held-items";
const SHURA = 9414;
const BLIGHTED_SACK = 24613;
const BLIGHTED_SACK_ROW = 3;
const BLIGHTED_SACK_BATCH = 70;

let core;
let I;
let next = 5600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("stackhold" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory() };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 6; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

/** A registered NPC beside the player, and its named option as the client sends it. */
async function npcOption(t, f, id, option) {
  const npc = core.NPC.create(id, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const clickType = npc.getDefinition().getActions().findIndex((action) => action === option) + 1;
  assert.ok(clickType > 0, `NPC ${id} offers ${option}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType });
}

const heldRunes = (f, attribute) => (f.p.getAttribute(attribute)?.items ?? [])
  .reduce((sum, [id, amount]) => sum + (id === I.DEATH_RUNE ? amount : 0), 0);

function holderCases(name, attribute, collect, extra = {}) {
  test(`${name}: what a stack can't hold stays with the holder`, async (t) => {
    const start = (held) => {
      const f = actor(t);
      if (held) f.inv.setItem(0, new core.Item(I.DEATH_RUNE, held));
      f.p.setAttribute(attribute, { ...extra, items: [[I.DEATH_RUNE, STORED]], paid: true });
      return f;
    };
    const control = start(5);
    await collect(t, control);
    assert.equal(control.inv.getAmount(I.DEATH_RUNE), 5 + STORED, "control: collected");
    assert.equal(control.p.getAttribute(attribute) ?? null, null, "control: nothing left");

    const f = start(NEAR_CAP);
    await collect(t, f);
    assert.equal(f.inv.getAmount(I.DEATH_RUNE), MAX_STACK_AMOUNT, "the stack fills");
    assert.equal(heldRunes(f, attribute), STORED - 5, "the holder keeps the rest");

    const capped = start(MAX_STACK_AMOUNT);
    await collect(t, capped);
    assert.equal(heldRunes(capped, attribute), STORED, "a full stack takes nothing");
  });
}

holderCases("Zulrah's priestess", ZULRAH_HELD, (_t, f) => Shrine.collect({ player: f.p }));
holderCases("Nightmare's Shura", NIGHTMARE_HELD, (t, f) => npcOption(t, f, SHURA, "Collect"), { holder: "shura" });
holderCases("the Voice of Yama", YAMA_HELD, (t, f) => npcOption(t, f, YamaCommon.data.npcs.voiceVariants[0], "Talk-to"));

test("Soul Wars rewards: a stack that can't take the batch costs no tokens", (t) => {
  const start = (held) => {
    const f = actor(t);
    if (held) f.inv.setItem(0, new core.Item(BLIGHTED_SACK, held));
    SoulWarsCommon.addVarp(f.p, "zeal_tokens", 3000);
    Rewards.otherList({ player: f.p, slot: BLIGHTED_SACK_ROW * 5 + 3, opId: 1 });
    Rewards.buyOther({ player: f.p, slot: BLIGHTED_SACK_ROW });
    return f;
  };
  const tokens = (f) => SoulWarsCommon.getVarp(f.p, "zeal_tokens");

  const control = start(MAX_STACK_AMOUNT - BLIGHTED_SACK_BATCH);
  assert.equal(control.inv.getAmount(BLIGHTED_SACK), MAX_STACK_AMOUNT, "control: exactly the room");
  assert.ok(tokens(control) < 3000, "control: tokens are paid");

  const f = start(MAX_STACK_AMOUNT - BLIGHTED_SACK_BATCH + 1);
  assert.equal(f.inv.getAmount(BLIGHTED_SACK), MAX_STACK_AMOUNT - BLIGHTED_SACK_BATCH + 1, "the stack is unchanged");
  assert.equal(tokens(f), 3000, "no tokens are taken");
});
