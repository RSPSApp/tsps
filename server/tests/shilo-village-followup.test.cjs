// Run after `yarn build`: node --test tests/shilo-village-followup.test.cjs
//
// #2643, Shilo Village followup. What each case rests on:
//  - broken cart (cache: multiloc 2216 on varp zombiequeen, "Climb over" only after the quest; rsprox 1102 ticks 13657-13659
//    road side to village: oploc2 on 2216, sequence 828 delay 15, sounds 4035, 4033 (delay 13), 4034 (delay 19), then the next
//    tick the line "You nimbly jump from one side of the cart to the other, and climb down again." and the teleport to
//    2876,2952). The way back to 2880,2952 (agent/data/transports.json, Wiki-derived) has no capture: the same sequence.
//  - the village gate (rsprox 1102 ticks 13663-13666): oploc1 on metal gate 2259 at 2875,2952 from 2876,2952, steps to 2875 and
//    2874, "You open the gates and make your way through into the village." and sound 71 on the second step. 2876,2952, where
//    the cart lands, is outside the gate. Leaving is the same walk back (inferred).
//  - Mosol Rei (cache: 8695 -> 8696 mosol_rei_complete, op1 Follow; Wiki Transcript:Mosol Rei "Standard dialogue after
//    Shilo Village": "Mosol leads you into the village." / "Mosol leaves you by the gate and walks back out into the
//    jungle."): the player ends inside the gate, on 2874,2952 (the exact tile is inferred).
//  - Yanni Salika (Wiki: Yanni Salika, Black prism, Shilo Village rewards, Transcript:Yanni Salika; generated npc-dialogues.json
//    "using-antiques-on-yanni-*"): after Shilo Village he pays 100 (bone key, scrolls, notes, stone-plaque), 500 (locating
//    crystal), 1000 (Beads of the Dead); the black prism, 5000 after Yes, only after Zogre Flesh Eaters, refused a second
//    time, and taking every prism owned. Preset copies are not bought. His standard dialogue quotes only what is carried.
//  - Nazastarool drops (generated npc-drops.json gives 5353, 5354 and 5355 the same "Always" corpse row; the Wiki names no
//    form, the transcript has the corpse appear on the dolmen after the third): only the ghost keeps it, through a real NPC death.
//  - Rashiliyia's tomb rocks (#2643: "no animation going down"): a walk, one tile a tick, not a teleport.
//  - Cairn Isle's bridge (Wiki Cairn Isle: Agility 1, 10 XP, chart low 75 high 250, failure three hits of floor(HP/11);
//    rsprox 1102 tick 15955 and 75 and 352: "You manage to keep your balance on the bridge."; 352 has those lines 20 ticks
//    apart, also while shuttling on it). A roll every 20 ticks on the bridge, and only after moving since the last one.
//    OURS: the failure line, the landing, and the move-since-the-last-roll rule (standing still would be an AFK farm).
//  - Cairn Isle's rock slide (Wiki Rock slide (Cairn Isle): level 15, 1 XP, chart low 170 high 253, two hitsplats of
//    floor(Hitpoints * 5%) + 1, "You fall and hurt yourself."; object 2231 in agility-shortcuts.json).
// Not built, with the missing fact: the palm trees that stay (no capture of the search; cache palm 2237 has no multiloc), the
// curse on Nazastarool's death (the transcript marks that line as a plain message, not overhead, like the others, so chat may
// be right), Yanni's sell-back.
// Real packets through ClientConnection.dispatch, the real map for the cart, the gate and the rocks, the bots off.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, afterEach, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const ObstacleRunner = require("../plugins/skills/agility/ObstacleRunner.Agility");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");

const CART = 2216;
const ROAD_SIDE = [2880, 2952];
const AT_THE_GATE = [2876, 2952];
const INSIDE_THE_GATE = [2874, 2952];
const GATE = 2259;
const GATE_TILE = [2875, 2952];
const CART_LINE = "You nimbly jump from one side of the cart to the other, and climb down again.";
const GATE_LINE = "You open the gates and make your way through into the village.";
const ON_THE_BRIDGE = [2780, 2979];
const OFF_THE_BRIDGE = [2790, 2979];
const BRIDGE_LANDING = [2782, 2979];
const BRIDGE_KEEP_BALANCE = "You manage to keep your balance on the bridge.";
const ROCKS = 2257;
const ABOVE_ROCKS = [2929, 9515];
const BELOW_ROCKS = [2928, 9511];
const MIDDLE_OF_THE_ROCKS = [2928, 9513];
const ROCK_ABOVE = [2928, 9515];
const ROCK_BELOW = [2929, 9511];
const STAGE_BEFORE_THE_END = 14;
const STAGE_COMPLETE = 15;
const MOSOL_PARENT = 8695;
const YANNI_ID = 5361;
const NAZASTAROOL = [5353, 5354, 5355];
const RASHILIYIA_CORPSE = 609;
const COINS = 995;
let core;
let I;
let next = 8200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...ROAD_SIDE);
  core.RegionManager.loadMapFiles(...GATE_TILE);
  core.RegionManager.loadMapFiles(2792, 2979);
  core.RegionManager.loadMapFiles(...ABOVE_ROCKS);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const shilo = () => QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "shilo_village");
const favour = () => QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "one_small_favour");

function actor(t, [x, y], stage = STAGE_COMPLETE) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("followup" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  const messages = [];
  const sounds = [];
  const animations = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  t.mock.method(sender, "sendSoundEffect", (id) => { sounds.push(id); return sender; });
  const perform = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { animations.push(animation?.getId?.()); return perform(animation); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  shilo().setStage(p, stage);
  return { p, c, inv: p.getInventory(), messages, sounds, animations, lines: [] };
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];
const coins = (f) => f.inv.getAmount(COINS);

function drain(f, rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    // Player sync clears this each tick; a moveTo leaves the player busy until it does.
    f.p.needsPlacement = false;
    // World's order: the tasks, then movement, then the walk-to handlers.
    core.TaskManager.process();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}

async function send(f, packet, rounds = 8) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  drain(f, rounds);
}

/** Answers the dialogue, picking the option `pick` names, and records every line the player was shown. */
async function playThrough(f, pick) {
  for (let i = 0; i < 40; i++) {
    const shown = f.p.getDialogueManager().getCurrent?.()?.getText?.();
    if (shown) f.lines.push(String(shown));
    const prompt = core.MultiChatboxPrompt.getPending(f.p);
    if (prompt) {
      const index = prompt.options.findIndex((option) => pick?.test(option.text ?? option));
      if (index < 0) return;
      await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
    } else if (f.p.getDialogueManager().isActive()) {
      const group = f.p.getPacketSender().chatboxGroupId;
      if (group < 0) { drain(f); continue; }
      await send(f, { type: "dialogue_continue", widgetId: group << 16, childIndex: -1 });
    } else {
      return;
    }
  }
}

/** The tile the map places the broken cart on (its multiloc id is the one the click carries). */
function cartTile() {
  for (let x = 2870; x <= 2886; x++) {
    for (let y = 2944; y <= 2960; y++) {
      if (core.MapObjects.get(CART, new core.Location(x, y, 0), null)) return [x, y];
    }
  }
  return null;
}

const clickCart = (f, option) => send(f, { type: "object_option", id: CART, x: cartTile()[0], y: cartTile()[1], clickType: option });

// ------------------------------------------------------------------ 7: the broken cart

test("#2643 broken cart: the map places multiloc 2216 and, after the quest, it reads 'Climb over'", (t) => {
  assert.ok(cartTile(), "the cart is on the map");
  const after = actor(t, ROAD_SIDE);
  const actions = core.ObjectDefinition.forPlayer(CART, after.p)?.getActions();
  assert.ok(actions?.includes("Climb over"), `the cart a finished player sees: ${JSON.stringify(actions)}`);
  const before = actor(t, ROAD_SIDE, STAGE_BEFORE_THE_END);
  const earlier = core.ObjectDefinition.forPlayer(CART, before.p)?.getActions();
  assert.ok(!earlier?.includes("Climb over"), `and before it: ${JSON.stringify(earlier)}`);
});

/** Dispatches the click, then lets the game run a tick at a time, noting where the player stands after each. */
async function ticksAfter(f, packet, count = 10) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  const seen = [];
  f.trace = [];
  for (let i = 0; i < count; i++) {
    drain(f, 1);
    seen.push(at(f));
    f.trace.push(`${at(f)} busy=${ObstacleRunner.isBusy(f.p)} queued=${f.p.getMovementQueue().size()} msgs=${f.messages.length} sounds=${f.sounds.length}`);
  }
  return seen;
}

const cartPacket = () => ({ type: "object_option", id: CART, x: cartTile()[0], y: cartTile()[1], clickType: 2 });
const gatePacket = () => ({ type: "object_option", id: GATE, x: GATE_TILE[0], y: GATE_TILE[1], clickType: 1 });

test("#2643 broken cart: Climb over from the road side plays the captured sequence and lands at the gate (2876,2952)", async (t) => {
  const f = actor(t, ROAD_SIDE);
  const seen = await ticksAfter(f, cartPacket());
  assert.notDeepEqual(seen[0], AT_THE_GATE, `the jump takes a tick, not a teleport: ${JSON.stringify(seen)}`);
  assert.deepEqual(seen.at(-1), AT_THE_GATE);
  assert.ok(f.animations.includes(828), `the reach animation: ${JSON.stringify(f.animations)}`);
  assert.deepEqual([4035, 4033, 4034].filter((id) => f.sounds.includes(id)), [4035, 4033, 4034], `the three sounds: ${f.sounds}`);
  assert.ok(f.messages.includes(CART_LINE), `the one line: ${JSON.stringify(f.messages)}`);
  assert.equal(f.messages.some((message) => /climb up onto the cart/.test(message)), false, "and no other server's lines");
});

test("#2643 broken cart: Climb over from the village side is the same sequence back to the road (inferred)", async (t) => {
  const f = actor(t, AT_THE_GATE);
  const seen = await ticksAfter(f, cartPacket());
  assert.deepEqual(seen.at(-1), ROAD_SIDE);
  assert.ok(f.messages.includes(CART_LINE));
});

// ------------------------------------------------------------------ 1102's gate

test("#2643 village gate: through it after the quest is the captured walk, line and sound 71, ending inside at 2874,2952", async (t) => {
  const f = actor(t, AT_THE_GATE);
  const seen = await ticksAfter(f, gatePacket());
  assert.deepEqual(seen.at(-1), INSIDE_THE_GATE, f.trace.join(" | "));
  assert.ok(seen.some((tile) => tile[0] === GATE_TILE[0] && tile[1] === GATE_TILE[1]), `through the gate tile: ${JSON.stringify(seen)}`);
  assert.ok(f.messages.includes(GATE_LINE));
  assert.ok(f.sounds.includes(71));
});

test("#2643 village gate: out again is the same walk back (inferred), without the line", async (t) => {
  const f = actor(t, INSIDE_THE_GATE);
  const seen = await ticksAfter(f, gatePacket());
  assert.deepEqual(seen.at(-1), AT_THE_GATE);
  assert.equal(f.messages.includes(GATE_LINE), false);
});

test("#2643 village gate: from further inside the way out is the same walk, and the player is not mistaken for being at the road", async (t) => {
  const f = actor(t, [2871, 2952]);
  const seen = await ticksAfter(f, gatePacket(), 14);
  assert.deepEqual(seen.at(-1), AT_THE_GATE, f.trace.join(" | "));
  assert.equal(f.messages.includes(GATE_LINE), false, "no 'through into the village' line on the way out");
});

test("#2643 the route in: the road side, over the cart, through the gate, and the player is inside the village", async (t) => {
  const f = actor(t, ROAD_SIDE);
  await ticksAfter(f, cartPacket());
  assert.deepEqual(at(f), AT_THE_GATE, "the cart leaves the player outside the gate");
  await ticksAfter(f, gatePacket());
  assert.deepEqual(at(f), INSIDE_THE_GATE);
});

test("#2643 broken cart: before the quest is finished the cart does not carry the player over", async (t) => {
  const f = actor(t, ROAD_SIDE, STAGE_BEFORE_THE_END);
  await clickCart(f, 2);
  assert.deepEqual(at(f), ROAD_SIDE);
});

// ------------------------------------------------------------------ 6: Mosol Rei

function mosol(f) {
  const npc = core.NPC.create(MOSOL_PARENT, new core.Location(ROAD_SIDE[0] + 1, ROAD_SIDE[1], 0));
  core.World.getNpcs().add(npc);
  const actions = npc.getCurrentDefinition(f.p).getActions();
  return { npc, actions };
}

test("#2643 Mosol Rei: after the quest the cache offers Follow, and Follow leaves the player inside the village", async (t) => {
  const f = actor(t, [ROAD_SIDE[0] + 2, ROAD_SIDE[1]]);
  const { npc, actions } = mosol(f);
  const follow = actions.findIndex((action) => action === "Follow");
  assert.ok(follow >= 0, `Follow is offered: ${JSON.stringify(actions)}`);
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: follow + 1 });
  assert.deepEqual(at(f), INSIDE_THE_GATE);
  assert.ok(f.messages.includes("Mosol leads you into the village."));
});

test("#2643 Mosol Rei: the dialogue's 'Yes, Ok, I'll go into the village!' leaves the player inside, 'some other time' does not", async (t) => {
  const yes = actor(t, [ROAD_SIDE[0] + 2, ROAD_SIDE[1]]);
  const { npc, actions } = mosol(yes);
  const talk = actions.findIndex((action) => action === "Talk-to");
  assert.ok(talk >= 0, `Talk-to is offered: ${JSON.stringify(actions)}`);
  await send(yes, { type: "npc_option", index: npc.getIndex(), clickType: talk + 1 });
  await playThrough(yes, /Yes, Ok/);
  assert.deepEqual(at(yes), INSIDE_THE_GATE);

  const no = actor(t, [ROAD_SIDE[0] + 2, ROAD_SIDE[1]]);
  await send(no, { type: "npc_option", index: npc.getIndex(), clickType: talk + 1 });
  await playThrough(no, /some other time/);
  assert.deepEqual(at(no), [ROAD_SIDE[0] + 2, ROAD_SIDE[1]]);
});

// ------------------------------------------------------------------ 8: Yanni Salika

function yanni(f) {
  const npc = core.NPC.create(YANNI_ID, new core.Location(f.p.getLocation().getX() + 1, f.p.getLocation().getY(), 0));
  core.World.getNpcs().add(npc);
  return npc;
}

function show(f, npc, itemId) {
  const slot = f.inv.getSlotForItemId(itemId);
  return send(f, { type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: 3214 });
}

const SALES = [
  ["bone key", () => I.BONE_KEY, 100],
  ["crumpled scroll", () => I.CRUMPLED_SCROLL, 100],
  ["tattered scroll", () => I.TATTERED_SCROLL, 100],
  ["Bervirius notes", () => I.BERVIRIUS_NOTES, 100],
  ["stone-plaque", () => I.STONE_PLAQUE, 100],
  ["locating crystal", () => I.LOCATING_CRYSTAL, 500],
  ["Beads of the Dead", () => I.BEADS_OF_THE_DEAD, 1000],
];

for (const [name, id, price] of SALES) {
  test(`#2643 Yanni Salika buys a ${name} for ${price} coins`, async (t) => {
    const f = actor(t, [2835, 2985]);
    const npc = yanni(f);
    f.inv.adds(id(), 1);
    await show(f, npc, id());
    assert.equal(coins(f), price, "paid");
    assert.equal(f.inv.getAmount(id()), 0, "the item is his");
  });
}

const zogre = () => QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "zogre_flesh_eaters");

test("#2643 Yanni Salika asks about the black prism: Yes pays 5000 once and takes every prism owned, No keeps it", async (t) => {
  const yes = actor(t, [2835, 2985]);
  zogre().setStage(yes.p, 14);
  const npc = yanni(yes);
  yes.inv.adds(I.BLACK_PRISM, 1);
  yes.p.getBank(0).add(new core.Item(I.BLACK_PRISM, 1), false);
  await show(yes, npc, I.BLACK_PRISM);
  assert.equal(coins(yes), 0, "nothing before the answer");
  await playThrough(yes, /Yes, I'll sell it/);
  assert.equal(coins(yes), 5000);
  assert.equal(yes.inv.getAmount(I.BLACK_PRISM), 0);
  assert.equal(yes.p.getBank(0).getAmount(I.BLACK_PRISM), 0, "the banked one goes too");

  yes.inv.adds(I.BLACK_PRISM, 1);
  await show(yes, npc, I.BLACK_PRISM);
  assert.equal(coins(yes), 5000, "a second prism is refused");
  assert.equal(yes.inv.getAmount(I.BLACK_PRISM), 1);
  assert.equal(core.MultiChatboxPrompt.getPending(yes.p), null, "without a question");

  const no = actor(t, [2835, 2985]);
  zogre().setStage(no.p, 14);
  const other = yanni(no);
  no.inv.adds(I.BLACK_PRISM, 1);
  await show(no, other, I.BLACK_PRISM);
  await playThrough(no, /No, I think I'll hold on it/);
  assert.equal(coins(no), 0);
  assert.equal(no.inv.getAmount(I.BLACK_PRISM), 1);
});

test("#2643 Yanni Salika buys nothing before Shilo Village, and no prism before Zogre Flesh Eaters", async (t) => {
  const early = actor(t, [2835, 2985], STAGE_BEFORE_THE_END);
  const npc = yanni(early);
  early.inv.adds(I.BONE_KEY, 1);
  await show(early, npc, I.BONE_KEY);
  assert.equal(coins(early), 0);
  assert.equal(early.inv.getAmount(I.BONE_KEY), 1);

  const noZogre = actor(t, [2835, 2985]);
  const other = yanni(noZogre);
  noZogre.inv.adds(I.BLACK_PRISM, 1);
  await show(noZogre, other, I.BLACK_PRISM);
  assert.equal(noZogre.inv.getAmount(I.BLACK_PRISM), 1, "the prism is kept for Zogre Flesh Eaters");
  assert.equal(core.MultiChatboxPrompt.getPending(noZogre.p), null);
});

test("#2643 Yanni Salika does not buy a preset copy", async (t) => {
  const f = actor(t, [2835, 2985]);
  const npc = yanni(f);
  f.inv.adds(I.BONE_KEY, 1);
  f.inv.getItems()[f.inv.getSlotForItemId(I.BONE_KEY)].setMetaValue(core.Item.PRESET_META, true);
  await show(f, npc, I.BONE_KEY);
  assert.equal(coins(f), 0);
  assert.equal(f.inv.getAmount(I.BONE_KEY), 1);
});

test("#2643 Yanni Salika pays nothing for what he does not buy", async (t) => {
  const f = actor(t, [2835, 2985]);
  const npc = yanni(f);
  f.inv.adds(I.LOGS, 1);
  await show(f, npc, I.LOGS);
  assert.equal(coins(f), 0);
  assert.equal(f.inv.getAmount(I.LOGS), 1);
});

async function quoteFor(t, carry, { shilo = true } = {}) {
  const f = actor(t, [2835, 2985], shilo ? STAGE_COMPLETE : STAGE_BEFORE_THE_END);
  favour().setStage(f.p, 285);
  carry(f);
  const npc = yanni(f);
  const index = npc.getCurrentDefinition(f.p).getActions().findIndex((action) => action === "Talk-to");
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
  await playThrough(f, /Tell me about this antiques business|Yes please/);
  return f.lines.join(" | ");
}

test("#2643 Yanni Salika's antiques dialogue quotes only what the player carries", async (t) => {
  const quoted = await quoteFor(t, (f) => f.inv.adds(I.BONE_KEY, 1));
  assert.ok(quoted.includes("100 coins for the Bone Key"), quoted);
  assert.ok(quoted.includes("the only item I am interested in"), quoted);
  assert.ok(!quoted.includes("Stone Plaque"), quoted);
  assert.ok(!quoted.includes("nothing I am interested in"), quoted);
  const none = await quoteFor(t, () => {});
  assert.ok(none.includes("you have nothing I am interested in"), none);
});

test("#2643 Yanni Salika quotes nothing, and says so, for what he would not buy: a prism before Zogre Flesh Eaters, Bervirius' notes, a preset copy", async (t) => {
  const prism = await quoteFor(t, (f) => f.inv.adds(I.BLACK_PRISM, 1));
  assert.ok(prism.includes("you have nothing I am interested in"), `a prism before Zogre Flesh Eaters: ${prism}`);
  const notes = await quoteFor(t, (f) => f.inv.adds(I.BERVIRIUS_NOTES, 1));
  assert.ok(notes.includes("you have nothing I am interested in"), `notes, which the transcript does not quote: ${notes}`);
  const preset = await quoteFor(t, (f) => {
    f.inv.adds(I.BONE_KEY, 1);
    f.inv.getItems()[f.inv.getSlotForItemId(I.BONE_KEY)].setMetaValue(core.Item.PRESET_META, true);
  });
  assert.ok(preset.includes("you have nothing I am interested in"), `a preset bone key: ${preset}`);
  assert.ok(!preset.includes("Bone Key"), preset);
  const early = await quoteFor(t, (f) => f.inv.adds(I.BONE_KEY, 1), { shilo: false });
  assert.ok(early.includes("you have nothing I am interested in"), `before Shilo Village: ${early}`);
});

// ------------------------------------------------------------------ 3: Nazastarool's drops

test("#2643 Nazastarool: through a real death only the ghost form's rolled drops hold Rashiliyia's corpse", (t) => {
  const f = actor(t, [2929, 9525]);
  const generated = [];
  const original = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, "emitCustomEvent", (name, payload) => {
    const result = original(name, payload);
    if (name === "npc-drops:generated") generated.push({ npcId: payload.npcId, items: payload.drops.map((drop) => drop.itemId) });
    return result;
  });
  for (const npcId of NAZASTAROOL) {
    const npc = core.NPC.create(npcId, new core.Location(2930, 9525, 0));
    PM.emitNpcDeath({ npc, killer: f.p, npcId, damagers: [f.p] });
  }
  const held = (npcId) => generated.find((entry) => entry.npcId === npcId)?.items.includes(RASHILIYIA_CORPSE);
  assert.equal(generated.length, 3, `three rolls: ${JSON.stringify(generated)}`);
  assert.equal(held(NAZASTAROOL[0]), false, "the zombie");
  assert.equal(held(NAZASTAROOL[1]), false, "the skeleton");
  assert.equal(held(NAZASTAROOL[2]), true, "the ghost keeps it");
});

// ------------------------------------------------------------------ 2: the rocks

async function walkRocks(f, rock) {
  await f.c.dispatch([{ type: "object_option", id: ROCKS, x: rock[0], y: rock[1], clickType: 1 }]);
  f.c.processTurnPackets();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    drain(f, 1);
    seen.push(at(f));
  }
  return seen;
}

test("#2643 Rashiliyia's rocks: the way down is walked, not a teleport", async (t) => {
  const f = actor(t, ABOVE_ROCKS);
  const seen = await walkRocks(f, ROCK_ABOVE);
  assert.notDeepEqual(seen[0], BELOW_ROCKS, "not at the bottom on the first tick");
  assert.ok(seen.some((tile) => tile[0] === MIDDLE_OF_THE_ROCKS[0] && tile[1] === MIDDLE_OF_THE_ROCKS[1]), `on the way: ${JSON.stringify(seen)}`);
  assert.deepEqual(seen.at(-1), BELOW_ROCKS);
});

test("#2643 Rashiliyia's rocks: the way up is walked too", async (t) => {
  const f = actor(t, BELOW_ROCKS);
  const seen = await walkRocks(f, ROCK_BELOW);
  assert.notDeepEqual(seen[0], ABOVE_ROCKS, "not at the top on the first tick");
  assert.ok(seen.some((tile) => tile[0] === MIDDLE_OF_THE_ROCKS[0] && tile[1] === MIDDLE_OF_THE_ROCKS[1]), `on the way: ${JSON.stringify(seen)}`);
  assert.deepEqual(seen.at(-1), ABOVE_ROCKS);
});

// ------------------------------------------------------------------ 5: Cairn Isle's bridge

const agility = (f) => f.p.getSkillManager().getExperience(core.Skill.AGILITY);

function crossBridge(f, roll) {
  t_random(roll);
  AreaManager.process(f.p);
  drain(f, 6);
}

let restoreRandom = null;
function t_random(value) {
  restoreRandom?.();
  const original = Math.random;
  Math.random = () => value;
  restoreRandom = () => { Math.random = original; };
}
afterEach(() => { restoreRandom?.(); restoreRandom = null; });

test("#2643 Cairn Isle bridge: a success keeps the captured line and pays 10 Agility XP", (t) => {
  const f = actor(t, ON_THE_BRIDGE);
  const before = agility(f);
  crossBridge(f, 0);
  assert.ok(f.messages.includes(BRIDGE_KEEP_BALANCE), JSON.stringify(f.messages));
  assert.equal(agility(f) - before, 10);
  assert.deepEqual(at(f), ON_THE_BRIDGE);
});

test("#2643 Cairn Isle bridge: the chart at Agility 1 is 76/256, so 0.29 holds and 0.31 falls into the river and ashore", (t) => {
  const holds = actor(t, ON_THE_BRIDGE);
  crossBridge(holds, 0.29);
  assert.ok(holds.messages.includes(BRIDGE_KEEP_BALANCE));
  const falls = actor(t, ON_THE_BRIDGE);
  const before = agility(falls);
  crossBridge(falls, 0.31);
  assert.equal(falls.messages.includes(BRIDGE_KEEP_BALANCE), false);
  assert.deepEqual(at(falls), BRIDGE_LANDING, "ashore (the landing is ours)");
  assert.equal(agility(falls), before, "no XP for a fall");
});

const at_ = (f, [x, y]) => f.p.setLocation(new core.Location(x, y, 0));

test("#2643 Cairn Isle bridge: a roll every 20 ticks on it (20 rolls, 19 does not), none for off-and-on inside 20", (t) => {
  const f = actor(t, ON_THE_BRIDGE);
  const balanced = () => f.messages.filter((message) => message === BRIDGE_KEEP_BALANCE).length;
  t_random(0);
  core.World.processCycle = 1000;
  AreaManager.process(f.p);
  assert.equal(balanced(), 1, "the first step on it rolls");
  assert.equal(agility(f), 10);
  at_(f, [2779, 2979]);
  core.World.processCycle = 1019;
  AreaManager.process(f.p);
  assert.equal(balanced(), 1, "19 ticks on: no roll");
  core.World.processCycle = 1020;
  AreaManager.process(f.p);
  assert.equal(balanced(), 2, "20 ticks on: a roll");
  assert.equal(agility(f), 20);
  // Off the bridge and back on within 20 ticks of the last roll pays nothing.
  for (let i = 0; i < 10; i++) {
    at_(f, [2782, 2979]);
    core.World.processCycle = 1021 + i;
    AreaManager.process(f.p);
    at_(f, [2781, 2979]);
    AreaManager.process(f.p);
  }
  assert.equal(balanced(), 2, "off and on inside 20 ticks");
  assert.equal(agility(f), 20);
  const off = actor(t, OFF_THE_BRIDGE);
  AreaManager.process(off.p);
  assert.equal(off.messages.length, 0, "none off the bridge");
});

test("#2643 Cairn Isle bridge: standing still on it never rolls again, however long (ours: no AFK farm)", (t) => {
  const f = actor(t, ON_THE_BRIDGE);
  t_random(0);
  core.World.processCycle = 2000;
  AreaManager.process(f.p);
  for (const tick of [2020, 2100, 2500, 9000]) {
    core.World.processCycle = tick;
    AreaManager.process(f.p);
  }
  assert.equal(agility(f), 10, "one roll, paid once");
  at_(f, [2779, 2979]);
  core.World.processCycle = 9020;
  AreaManager.process(f.p);
  assert.equal(agility(f), 20, "moving on it, 20 ticks later, rolls");
});

test("#2643 Cairn Isle bridge: the bridge is one tile wide, y 2979: the rows beside it across x 2776-2781 are water", (t) => {
  const walkable = [];
  for (let y = 2977; y <= 2980; y++) {
    const open = [];
    for (let x = 2776; x <= 2781; x++) {
      if (!core.RegionManager.blocked(new core.Location(x, y, 0), null)) open.push(x);
    }
    if (open.length > 0) walkable.push([y, open]);
  }
  assert.deepEqual(walkable.map(([y]) => y), [2979], `walkable rows between the banks: ${JSON.stringify(walkable)}`);
});

// ------------------------------------------------------------------ the rock slide (agility-shortcuts.json, object 2231)

function rockSlideTile() {
  for (let x = 2788; x <= 2798; x++) {
    for (let y = 2975; y <= 2983; y++) {
      if (core.MapObjects.get(2231, new core.Location(x, y, 0), null)) return [x, y];
    }
  }
  return null;
}

test("#2643 Cairn Isle rock slide: a failed climb is two hitsplats of floor(HP * 5%) + 1 and 'You fall and hurt yourself.', no XP", async (t) => {
  const slide = rockSlideTile();
  assert.ok(slide, "the slide is on the map");
  const f = actor(t, [2792, 2979]);
  f.p.getSkillManager().setCurrentLevel(core.Skill.AGILITY, 15);
  f.p.getSkillManager().setMaxLevel(core.Skill.AGILITY, 15);
  const before = agility(f);
  t_random(0.999);
  await ticksAfter(f, { type: "object_option", id: 2231, x: slide[0], y: slide[1], clickType: 1 }, 12);
  assert.ok(f.messages.includes("You fall and hurt yourself."), JSON.stringify(f.messages));
  const each = Math.floor((f.p.getHitpoints() * 5) / 100) + 1;
  assert.equal(f.p.getCombat().getHitQueue().getQueuedDamage(), each * 2, `two hits of ${each}`);
  assert.equal(agility(f), before, "a fall pays nothing");
});

test("#2643 Cairn Isle rock slide: a successful climb pays 1 Agility XP", async (t) => {
  const slide = rockSlideTile();
  const f = actor(t, [2792, 2979]);
  f.p.getSkillManager().setCurrentLevel(core.Skill.AGILITY, 15);
  f.p.getSkillManager().setMaxLevel(core.Skill.AGILITY, 15);
  const before = agility(f);
  t_random(0);
  await ticksAfter(f, { type: "object_option", id: 2231, x: slide[0], y: slide[1], clickType: 1 }, 12);
  assert.equal(agility(f) - before, 1);
  assert.equal(f.messages.includes("You fall and hurt yourself."), false);
});
