// Run after `yarn build`: node --test tests/rite-of-vile-transference.test.cjs
// Rite of vile transference (Wiki; rsprox recording 3285 ticks 6162-6178): Read asks, consumes the
// scroll and upgrades Death Charge to restore special attack energy from two kills per cast.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const { ArceuusSpells } = require("../dist/game/content/combat/magic/ArceuusSpells");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { PluginManager } = require("../dist/plugins/PluginManager");

const plugin = require("../plugins/items/RiteOfVileTransference.plugin");

const RITE = 30806;
const MAN = 3106;
const SCROLL_USED = 16269; // death_charge_scroll_used
const ACTIVE = 12411; // arceuus_death_charge_active
const UPGRADED = ArceuusSpells.DEATH_CHARGE_UPGRADED_ATTRIBUTE;

const itemActions = new Map();
const emitted = [];
let loginHook = null;
let persisted = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  const api = PluginManager.createApi("RiteOfVileTransference");
  plugin.register({
    ...api,
    persistAttribute: (key, value) => { persisted = [key, value]; },
    onPlayerLogin: (handler) => { loginHook = handler; },
    onItemAction: (name, actions) => itemActions.set(name, actions),
    emitCustomEvent: (name, payload) => emitted.push([name, payload]),
  });
});

let next = 9800;
/** A real Player with its varbits, sounds, graphics and dialogues recorded; the rite in its pack. */
function reader(t, { items = [RITE], attributes = {} } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername("rite" + player.getIndex()); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new Location(3222, 3218, 0));
  player.setSpecialPercentage(50);
  for (const [key, value] of Object.entries(attributes)) player.setAttribute(key, value);
  t.after(() => player.setRegistered(false));
  const varbits = [];
  const sent = [];
  const messages = [];
  const chains = [];
  const sender = player.getPacketSender();
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.push([id, value]); return sender; });
  t.mock.method(sender, "sendSoundEffect", (id, loops, delay) => { sent.push(["sound", id, delay]); return sender; });
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  t.mock.method(player, "performAnimation", (animation) => sent.push(["seq", animation.getId()]));
  t.mock.method(player, "performGraphic", (graphic) => sent.push(["spotanim", graphic.getId(), graphic.getDelay()]));
  t.mock.method(player, "getDialogueManager", () => ({ startDialogues: (chain) => chains.push(chain.getDialogues()), reset() {} }));
  // Slots hold ids (null once emptied); the real container needs the cache's item definitions.
  const inventory = items.slice();
  t.mock.method(player, "getInventory", () => ({
    contains: (id) => inventory.includes(id),
    forSlot: (slot) => (inventory[slot] == null ? null : { getId: () => inventory[slot] }),
    deleteAtSlot(slot) { inventory[slot] = null; },
    deleteNumber(id) {
      const index = inventory.indexOf(id);
      if (index !== -1) inventory[index] = null;
    },
  }));
  return { player, varbits, sent, messages, chains, inventory };
}

function dialogues(chain) {
  return [...chain.keys()].sort((a, b) => a - b).map((index) => chain.get(index));
}

test("the plugin saves the upgrade from a false start", () => {
  assert.deepEqual(persisted, [UPGRADED, false]);
});

test("Read asks as recorded, Upgrade consumes the rite and upgrades Death Charge", (t) => {
  const { player, varbits, sent, chains, inventory } = reader(t);
  assert.equal(itemActions.get("Rite of vile transference").Read({ player, itemId: RITE, slot: 0 }), true);
  const [intro, menu] = dialogues(chains[0]);
  assert.ok(intro instanceof ItemStatementDialogue);
  assert.equal(intro.getItemId(), RITE);
  assert.equal(intro.getText(), "You can make out some faded words on the ancient parchment. It appears to be a demonic "
    + "learning on spell efficiency. Would you like to absorb its knowledge?");
  assert.ok(menu instanceof OptionDialogue);
  assert.equal(menu.getTitle(), "This will consume the scroll.");
  assert.deepEqual(menu.getOptions(), ["Upgrade <col=7f0000>Death Charge</col>", "Cancel"]);

  menu.execute(1);
  assert.deepEqual(inventory, [null], "the scroll is consumed");
  assert.equal(player.getAttribute(UPGRADED), true);
  assert.deepEqual(varbits, [[SCROLL_USED, 1]]);
  assert.deepEqual(sent, [
    ["seq", CacheDefinitions.getSeqId("qip_watchtower_read_scroll_and_stop")],
    ["spotanim", 3288, 80],
    ["sound", 5034, 80],
  ]);
  assert.equal(emitted.at(-1)[0], "arceuus:death-charge-upgraded");

  // Recording 3285: the upgraded box six ticks after the choice.
  for (let tick = 0; tick < 5; tick++) TaskManager.process();
  assert.equal(chains.length, 1);
  TaskManager.process();
  const [done] = dialogues(chains[1]);
  assert.equal(done.getItemId(), RITE);
  assert.equal(done.getText(), "You study the scroll and upgrade an Arceuus Spell:<br><col=7f0000>Death Charge</col>");
});

test("Upgrade empties the clicked rite's slot, as recorded", (t) => {
  const { player, chains, inventory } = reader(t, { items: [RITE, RITE] });
  itemActions.get("Rite of vile transference").Read({ player, itemId: RITE, slot: 1 });
  dialogues(chains[0])[1].execute(1);
  assert.deepEqual(inventory, [RITE, null]);
});

test("a plain cast still live when the rite is read ends with the plain graphic", (t) => {
  const { player, sent } = reader(t, { items: [] });
  ArceuusSpells.startDeathCharge(player);
  player.setAttribute(UPGRADED, true);
  kill(player);
  assert.equal(ArceuusSpells.hasDeathCharge(player), false, "it was a one-kill cast");
  assert.deepEqual(sent.filter(([kind]) => kind === "spotanim"), [["spotanim", 1855, 0]]);
});

test("Cancel keeps the rite and the plain spell", (t) => {
  const { player, varbits, inventory, chains } = reader(t);
  itemActions.get("Rite of vile transference").Read({ player, itemId: RITE });
  dialogues(chains[0])[1].execute(2);
  assert.deepEqual(inventory, [RITE]);
  assert.notEqual(player.getAttribute(UPGRADED), true);
  assert.deepEqual(varbits, []);
});

test("an upgraded player can't read another rite, and login sends the varbit", (t) => {
  const { player, varbits, messages, chains, inventory } = reader(t, { attributes: { [UPGRADED]: true } });
  itemActions.get("Rite of vile transference").Read({ player, itemId: RITE });
  assert.equal(chains.length, 0);
  assert.match(messages[0], /nothing more for you to learn/);
  assert.deepEqual(inventory, [RITE]);
  loginHook({ player });
  assert.deepEqual(varbits, [[SCROLL_USED, 1]]);
});

function kill(player) {
  const npc = new NPC(MAN, new Location(3223, 3218, 0));
  npc.getCombat().addDamage(player, 1);
  const death = new NPCDeathTask(npc);
  death.remove = () => {};
  death.execute();
  death.execute();
}

test("an upgraded Death Charge restores from two kills, then is spent", (t) => {
  const { player, varbits, sent } = reader(t, { items: [], attributes: { [UPGRADED]: true } });
  ArceuusSpells.startDeathCharge(player);
  kill(player);
  assert.equal(player.getSpecialPercentage(), 65);
  assert.equal(ArceuusSpells.hasDeathCharge(player), true, "the charge stays for a second kill");
  assert.ok(!varbits.some(([id, value]) => id === ACTIVE && value === 0), "the active varbit stays up");
  kill(player);
  assert.equal(player.getSpecialPercentage(), 80);
  assert.equal(ArceuusSpells.hasDeathCharge(player), false);
  assert.deepEqual(varbits.at(-1), [ACTIVE, 0]);
  kill(player);
  assert.equal(player.getSpecialPercentage(), 80, "a third kill restores nothing");
  assert.deepEqual(sent.filter(([kind]) => kind === "spotanim"), [["spotanim", 3289, 0], ["spotanim", 3289, 0]]);
});

test("a plain Death Charge still restores from one kill", (t) => {
  const { player, sent } = reader(t, { items: [] });
  ArceuusSpells.startDeathCharge(player);
  kill(player);
  assert.equal(player.getSpecialPercentage(), 65);
  assert.equal(ArceuusSpells.hasDeathCharge(player), false);
  kill(player);
  assert.equal(player.getSpecialPercentage(), 65);
  assert.deepEqual(sent.filter(([kind]) => kind === "spotanim"), [["spotanim", 1855, 0]]);
});

test("the cast shows the red skull once upgraded", (t) => {
  for (const [upgraded, graphic] of [[false, 1854], [true, 3288]]) {
    const { player, sent } = reader(t, { items: [], attributes: { [UPGRADED]: upgraded } });
    const spell = ArceuusSpells.SELF_SPELLS.get("death charge"); // private in TypeScript only
    t.mock.method(spell, "canCast", () => true);
    spell.cast(player);
    assert.ok(sent.some(([kind, id]) => kind === "spotanim" && id === graphic), `graphic ${graphic}`);
  }
});
