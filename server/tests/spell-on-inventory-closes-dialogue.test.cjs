// Run after `yarn build`: node --test tests/spell-on-inventory-closes-dialogue.test.cjs
// A spell cast on an inventory item (the client's IF_BUTTONT, decoded as widget_target) didn't close the open dialogue,
// so an item a dialogue had just checked ("has an iron bar") could be high-alched while its menu stayed open, and the
// menu's action then paid anyway. It now closes the dialogue as an inventory click does. Native input: a real Player,
// a real ClientConnection and the widget_target packet.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PluginManager.emitServerStartup({});
  core = PluginManager.getCoreApi();
});
after(() => PluginManager.emitServerShutdown({}));

function connected(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session, new core.Location(3222, 3218, 0));
  p.setUsername("alch-mid-dialogue");
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  session.setPlayer(p);
  t.after(() => p.setRegistered(false));
  const connection = new ClientConnection(channel);
  connection.player = p;
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  return { p, send };
}

test("a spell cast on an inventory item closes the open dialogue", async (t) => {
  const { p, send } = connected(t);
  p.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.IRON_BAR, 1));
  p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, "Craft a scarab emblem?")));
  assert.equal(p.getDialogueManager().isActive(), true, "a dialogue is open");
  await send({ type: "widget_target", targetWidgetId: (149 << 16), targetSlot: 0, targetItemId: core.ItemIdentifiers.IRON_BAR,
    sourceWidgetId: (218 << 16) | 44, sourceSlot: -1, sourceItemId: -1 });
  assert.equal(p.getDialogueManager().isActive(), false, "casting on the inventory closed it");
});

// The spell-on-item routes act on the inventory's slot whatever the target names, so a target outside the inventory
// (a bank, the chatbox) cast High Alchemy on the item under the open dialogue, without closing it, and its action
// still paid. Only a target in the inventory (149) runs them now.
test("High Alchemy aimed at another interface's slot alches nothing and leaves the dialogue open; at the inventory it alches", async (t) => {
  const spell = core.CacheDefinitions.getSpellByName("High Level Alchemy");
  assert.ok(spell, "High Level Alchemy is in the cache");
  for (const group of [15, 0, 467, 149]) {
    const { p, send } = connected(t);
    const skills = p.getSkillManager();
    skills.setMaxLevel(core.Skill.MAGIC, 99).setCurrentLevel(core.Skill.MAGIC, 99, false);
    const inv = p.getInventory();
    inv.setItem(0, new core.Item(core.ItemIdentifiers.IRON_BAR, 1));
    inv.setItem(1, new core.Item(core.ItemIdentifiers.NATURE_RUNE, 1));
    inv.setItem(2, new core.Item(core.ItemIdentifiers.FIRE_RUNE, 5));
    p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, "Craft a scarab emblem?")));
    await send({ type: "widget_target", targetWidgetId: group << 16, targetSlot: 0, targetItemId: core.ItemIdentifiers.IRON_BAR,
      sourceWidgetId: spell.widgetId, sourceSlot: -1, sourceItemId: spell.itemId });
    for (let i = 0; i < 6; i++) core.TaskManager.process();
    const alched = inv.getAmount(core.ItemIdentifiers.IRON_BAR) === 0;
    if (group === 149) {
      assert.equal(alched, true, "control: on the inventory the bar is alched");
      assert.equal(p.getDialogueManager().isActive(), false, "and the dialogue closed");
    } else {
      assert.equal(alched, false, `target group ${group}: the bar is not alched`);
      assert.equal(inv.getAmount(core.ItemIdentifiers.NATURE_RUNE), 1, `target group ${group}: no rune taken`);
      assert.equal(p.getDialogueManager().isActive(), true, `target group ${group}: the dialogue is still open`);
    }
  }
});

// A second alch clicked during the 5-tick cast delay waits as a task. Opened after it was queued, a dialogue (the
// "Craft a scarab emblem?" hand-in) was still open when it fired, so the checked item was alched under it and the
// menu still paid. The waiting cast is dropped when a dialogue or prompt is open as it fires.
test("an alch queued before a dialogue opens doesn't fire under it", async (t) => {
  const spell = core.CacheDefinitions.getSpellByName("High Level Alchemy");
  for (const dialogue of [false, true]) {
    const { p, send } = connected(t);
    p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99).setCurrentLevel(core.Skill.MAGIC, 99, false);
    const inv = p.getInventory();
    inv.setItem(0, new core.Item(core.ItemIdentifiers.BRONZE_DAGGER, 1));
    inv.setItem(1, new core.Item(core.ItemIdentifiers.IRON_BAR, 1));
    inv.setItem(2, new core.Item(core.ItemIdentifiers.NATURE_RUNE, 2));
    inv.setItem(3, new core.Item(core.ItemIdentifiers.FIRE_RUNE, 10));
    const cast = (slot, itemId) => send({ type: "widget_target", targetWidgetId: 149 << 16, targetSlot: slot, targetItemId: itemId,
      sourceWidgetId: spell.widgetId, sourceSlot: -1, sourceItemId: spell.itemId });
    await cast(0, core.ItemIdentifiers.BRONZE_DAGGER);
    assert.equal(inv.getAmount(core.ItemIdentifiers.BRONZE_DAGGER), 0, "the first alch is cast");
    await cast(1, core.ItemIdentifiers.IRON_BAR);
    assert.equal(inv.getAmount(core.ItemIdentifiers.IRON_BAR), 1, "the second waits for the cast delay");
    if (dialogue) p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, "Craft a scarab emblem?")));
    for (let i = 0; i < 6; i++) { core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff; core.TaskManager.process(); }
    if (dialogue) {
      assert.equal(inv.getAmount(core.ItemIdentifiers.IRON_BAR), 1, "the bar is not alched under the dialogue");
      assert.equal(inv.getAmount(core.ItemIdentifiers.NATURE_RUNE), 1, "and no second rune is taken");
      assert.equal(p.getDialogueManager().isActive(), true, "the dialogue stays open");
      assert.equal(p.getAttribute("magic:alchemy-queued") ?? null, null, "nothing is left waiting");
    } else {
      assert.equal(inv.getAmount(core.ItemIdentifiers.IRON_BAR), 0, "control: without a dialogue the queued alch casts");
    }
  }
});
