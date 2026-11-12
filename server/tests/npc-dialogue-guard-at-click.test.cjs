// Run after `yarn build`: node --test tests/npc-dialogue-guard-at-click.test.cjs
// A transcript menu's guarded option ("If the player is wearing the Ring of Charos(a):") was answered when the menu
// was drawn only. Taking the ring off natively leaves the menu open, so the [Charm] option still worked: the Blast
// Furnace foreman's permit for 1,250 coins instead of 2,500. Real engine: every plugin loaded, a real Player, the
// foreman's real transcript driven by native dialogue_continue packets, and a native worn-equipment Remove.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core, I;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi(); I = core.ItemIdentifiers; PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
async function resume(f, choice) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  const widgetId = choice == null ? (group << 16) | ([231, 217].includes(group) ? 5 : 0) : core.OptionDialogue.OPTIONS_WIDGET_ID;
  await f.c.dispatch([{ type: "dialogue_continue", widgetId, childIndex: choice ?? -1 }]); f.c.processTurnPackets();
}
async function menu(f) {
  for (let i = 0; i < 40; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.p); if (pending) return pending.options;
    const cur = f.p.getDialogueManager().getCurrent(); if (!cur) return [];
    await resume(f);
  }
}
async function toCharmMenu(f) {
  let opts = await menu(f);
  for (let hop = 0; hop < 6 && !opts.some((o) => /^\[Charm\]/.test(o)); hop++) {
    const i = opts.findIndex((o) => /Can I use the furnace|don't have level 60/i.test(o));
    await resume(f, (i >= 0 ? i : 0) + 1);
    opts = await menu(f);
  }
  return opts;
}

function actor(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9400 + name.length); p.setUsername(name); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  p.setLocation(new core.Location(1940, 4958, 0));
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => p.setRegistered(false));
  p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_CHAROS_A_, 1));
  p.getInventory().setItem(0, new core.Item(I.COINS, 5000));
  const npc = core.NPC.create(core.NpcIdentifiers.BLAST_FURNACE_FOREMAN, new core.Location(1942, 4958, 0));
  PM.emitCustomEvent("npc-dialogue:start", { player: p, npc, npcId: core.NpcIdentifiers.BLAST_FURNACE_FOREMAN, handled: false });
  return { p, c };
}

const CHARM = /^\[Charm\] How about I give you 1250 coins/;

test("taking the ring off while the foreman's menu is open withdraws its [Charm] option", async (t) => {
  const f = actor(t, "charmoff");
  const opts = await toCharmMenu(f);
  const charm = opts.findIndex((o) => CHARM.test(o));
  assert.ok(charm >= 0, "the [Charm] option is offered while the ring is worn");
  await f.c.dispatch([{ type: "widget_action", widgetId: (387 << 16) | 24, groupId: 387, childId: 24, buttonNum: 1 }]);
  f.c.processTurnPackets();
  assert.equal(f.p.getEquipment().getItems()[core.Equipment.RING_SLOT]?.getId(), -1, "the ring is off");
  assert.ok(core.MultiChatboxPrompt.getPending(f.p), "the menu is still open");
  await resume(f, charm + 1);
  assert.equal(f.p.getInventory().getAmount(I.COINS), 5000, "no half-price permit");
  const again = core.MultiChatboxPrompt.getPending(f.p)?.options ?? [];
  assert.ok(again.length > 0 && !again.some((o) => CHARM.test(o)), "the menu comes back without the [Charm] option");
});

test("with the ring still on, the [Charm] option pays 1,250", async (t) => {
  const f = actor(t, "charmon");
  const opts = await toCharmMenu(f);
  await resume(f, opts.findIndex((o) => CHARM.test(o)) + 1);
  for (let i = 0; i < 10 && f.p.getDialogueManager().getCurrent(); i++) await resume(f);
  assert.equal(f.p.getInventory().getAmount(I.COINS), 3750);
});
