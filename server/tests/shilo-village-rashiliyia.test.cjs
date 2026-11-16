// Run after `yarn build`: node --test tests/shilo-village-rashiliyia.test.cjs
//
// Shilo Village's hidden doors, Rashiliyia's tomb and Nazastarool (quests/shilovillage/Rashiliyia.ShiloVillage.js)
// against the user's rev 242 capture (RSProx capture ShiloVillage; ticks in docs/quests/shilo-village/README.md):
// the palm trees and carved doors, the hillside entrance, the tomb exit, the ancient gate, the rocks, the bones in
// the tomb doors, the dolmen and the three forms, the curse and the remains. Real packets, plugins, cache and map
// (shilo-village-harness.cjs).
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./shilo-village-harness.cjs");

const PALM = [2916, 3092];
const CARVED = 34673;
const CARVED_TILE = [2916, 3090];
const TOMB_INSIDE = [2929, 9525];
const EXIT = [2243, 2928, 9527];
const GATE = [2256, 2929, 9516];
const ROCK_ABOVE = [2928, 9515];
const ROCK_BELOW = [2929, 9511];
const DOOR = [2246, 2892, 9480];
const DOLMEN = [2258, 2892, 9487];
const BONE_KEY = 605;
const BONES = 526;
const CORPSE = 609;
const VARBIT_DOORS = 8180;
const STAGE = { STARTED_BERVIRIUS: 9, UNLOCKED: 10, BEADS: 11, BONES: 12, CORPSE: 14 };

before(() => h.setup([PALM, TOMB_INSIDE, [2892, 9487]]));
after(() => h.teardown());

const lines = (f) => h.lines(f);
const varbits = (f, id) => f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === id).map((c) => c.args[1]);
const sounds = (f) => f.calls.filter((c) => c.name === "sendSoundEffect").map((c) => c.args[0]);
const unit = () => h.unit("Rashiliyia");
const objectClick = (f, [id, x, y], clickType = 1) => h.dispatch(f, { type: "object_option", id, x, y, clickType });
const itemOn = (f, itemId, [objectId, x, y]) => h.dispatch(f, {
  type: "item_on_object", objectId, x, y, itemId, slot: f.player.getInventory().getSlotForItemId(itemId), widgetId: 149 << 16,
});

/** Records what NPCs and the player shout overhead. */
function overheads(t, f) {
  const said = [];
  const { NPC } = h.core;
  const npcChat = NPC.prototype.forceChat;
  t.mock.method(NPC.prototype, "forceChat", function (text) { said.push({ tick: f.tick, who: this.getId(), text }); return npcChat.call(this, text); });
  const own = f.player.forceChat.bind(f.player);
  f.player.forceChat = (text) => { said.push({ tick: f.tick, who: "player", text }); return own(text); };
  return said;
}

test("palm trees: the two lines with seq 810 and varbit 8180 to 1; again, 'already pulled apart' (t3972, t3984)", async (t) => {
  const f = h.actor(t, { at: [2918, 3091], stage: STAGE.STARTED_BERVIRIUS });
  await objectClick(f, [2237, ...PALM], 2);
  h.ticks(f, 3);
  assert.ok(lines(f).includes("You search the palm trees..."));
  assert.ok(lines(f).includes("...and reveal an ancient doorway set into the side of the hill!"));
  assert.ok(f.animations.some((a) => a.id === 810));
  assert.equal(varbits(f, VARBIT_DOORS).at(-1), 1);
  await objectClick(f, [2237, ...PALM], 2);
  h.ticks(f, 3);
  assert.ok(lines(f).includes("The trees are already pulled apart revealing some doors."));
  assert.equal(f.animations.filter((a) => a.id === 810).length, 2);
});

test("carved doors: Search finds the bone lock; the bone key's first line, then a tick on stage 10, varbit 2, the second line and sound 2410, no teleport (t4000, t4021-4022)", async (t) => {
  const f = h.actor(t, { at: [2916, 3091], stage: STAGE.STARTED_BERVIRIUS, items: [BONE_KEY], attributes: { "quest.shilo_village.mechanisms": 1 << 3 } });
  await objectClick(f, [CARVED, ...CARVED_TILE], 2);
  assert.match(h.shown(f)?.text ?? "", /strange lock/);
  assert.equal(h.shown(f).who, "StatementDialogue");
  f.player.getDialogueManager().reset?.();
  await itemOn(f, BONE_KEY, [CARVED, ...CARVED_TILE]);
  const first = f.messages.find((m) => m.text === "You try the bone key with the lock.");
  assert.ok(first, JSON.stringify(lines(f)));
  assert.notEqual(h.stage(f), STAGE.UNLOCKED);
  h.ticks(f, 3);
  const second = f.messages.find((m) => m.text === "A shimmering light dances over the doors, before you can blink, the doors creak open.");
  assert.equal(second.tick - first.tick, 1);
  assert.equal(h.stage(f), STAGE.UNLOCKED);
  assert.equal(varbits(f, VARBIT_DOORS).at(-1), 2);
  assert.ok(sounds(f).includes(2410));
  assert.deepEqual(h.at(f), [2916, 3091], "no teleport");
  assert.ok(f.player.getInventory().contains?.(BONE_KEY) ?? f.player.getInventory().getAmount(BONE_KEY) === 1, "the key is kept");
});

test("hillside entrance: Enter is the line, the player inside with sound 68, and the 'doors close' box (t4025)", async (t) => {
  const f = h.actor(t, { at: [2916, 3091], stage: STAGE.UNLOCKED });
  await objectClick(f, [CARVED, ...CARVED_TILE], 1);
  h.ticks(f, 2);
  assert.ok(lines(f).includes("You walk into the darkness of the cavern."));
  assert.deepEqual(h.at(f), TOMB_INSIDE);
  assert.ok(sounds(f).includes(68));
  assert.match(h.shown(f)?.text ?? "", /^The doors close behind you/);
});

test("tomb exit: Open is locked even with the key, the line then three overhead lines two ticks apart; the key on it lets the player out (t4902-4911)", async (t) => {
  const f = h.actor(t, { at: [2928, 9526], stage: STAGE.BEADS, items: [BONE_KEY], beads: true });
  const said = overheads(t, f);
  await objectClick(f, EXIT, 1);
  h.ticks(f, 9);
  assert.ok(lines(f).includes("The door seems to be locked!"));
  assert.equal(lines(f).includes("The Beads of the Dead start to glow..."), false);
  const own = said.filter((s) => s.who === "player");
  assert.deepEqual(own.map((s) => s.text), ["Oh no, I'm going to be stuck in here forever!", "How will I ever get out!", "I'm too young to die!"]);
  assert.deepEqual(own.map((s) => s.tick - own[0].tick), [0, 2, 4]);
  assert.deepEqual(h.at(f), [2928, 9526], "still inside");
  await itemOn(f, BONE_KEY, EXIT);
  h.ticks(f, 2);
  assert.deepEqual(h.at(f), [2916, 3093]);
});

test("ancient gate: with the beads, the glow line, stage 11, the open gate for two ticks with sound 69, through to 2929,9515; Search doesn't open it (t4062-4069)", async (t) => {
  const f = h.actor(t, { at: [2929, 9517], stage: STAGE.UNLOCKED, beads: true });
  h.watchLocs(f);
  await objectClick(f, GATE, 2);
  h.ticks(f, 3);
  assert.deepEqual(h.at(f), [2929, 9517], "Search is only a look");
  f.player.getDialogueManager().reset?.();
  await objectClick(f, GATE, 1);
  h.ticks(f, 5);
  assert.ok(lines(f).includes("The Beads of the Dead start to glow..."));
  assert.equal(h.stage(f), STAGE.BEADS);
  assert.deepEqual(h.at(f), [2929, 9515]);
  assert.ok(sounds(f).includes(69));
  const added = f.locs.filter(([, kind]) => kind === "add").map(([, , id, x, y]) => `${id}@${x},${y}`);
  for (const leaf of ["38848@2928,9516", "38848@2929,9516", "1573@2928,9517", "1574@2929,9517"]) assert.ok(added.includes(leaf), `${leaf}: ${added}`);
  const open = f.locs.find(([, kind, id]) => kind === "add" && id === 1573)[0];
  const shut = f.locs.find(([, kind, id]) => kind === "add" && id === 2256)[0];
  assert.equal(shut - open, 2);
});

test("rocks: without the beads no way down; with them two moves and the lines (t4535-4542); up the other way with its lines (t4891-4897)", async (t) => {
  const bare = h.actor(t, { at: [2929, 9515], stage: STAGE.BEADS });
  await objectClick(bare, [2257, ...ROCK_ABOVE], 1);
  h.ticks(bare, 3);
  assert.deepEqual(h.at(bare), [2929, 9515]);

  const f = h.actor(t, { at: [2929, 9515], stage: STAGE.BEADS, beads: true });
  await objectClick(f, [2257, ...ROCK_ABOVE], 1);
  const seen = [];
  for (let i = 0; i < 10; i++) { h.tick(f); seen.push(h.at(f).join()); }
  assert.deepEqual(h.at(f), [2928, 9511]);
  assert.ok(!seen.includes("2928,9512"), `two-tile moves: ${seen}`);
  const down = ["You carefully try to pick your way down the rocks.", "You manage to carefully clamber down."]
    .map((text) => f.messages.find((m) => m.text === text));
  assert.ok(down.every(Boolean));
  assert.ok(down[1].tick - down[0].tick >= 5, `the second line a few ticks after the landing: ${down.map((m) => m.tick)}`);

  await objectClick(f, [2257, ...ROCK_BELOW], 1);
  h.ticks(f, 10);
  assert.deepEqual(h.at(f), [2929, 9515]);
  assert.ok(lines(f).includes("You carefully pick your way through the rocks."));
  assert.ok(lines(f).includes("You manage to carefully clamber up."));
});

test("tomb doors: each bone seq 832, a tick on the bones box and this player's door look; the third opens them and walks the player in (t4574-4599)", async (t) => {
  const f = h.actor(t, { at: [2893, 9480], stage: STAGE.BEADS, beads: true });
  for (let i = 0; i < 3; i++) f.player.getInventory().add(new h.core.Item(BONES, 1), false);
  h.watchLocs(f);
  for (let bone = 1; bone <= 3; bone++) {
    await itemOn(f, BONES, DOOR);
    for (let i = 0; i < 6 && h.shown(f)?.who !== "ItemStatementDialogue"; i++) h.tick(f);
    assert.ok(f.animations.filter((a) => a.id === 832).length >= bone, `seq 832 for bone ${bone}: ${JSON.stringify(f.animations)} ${JSON.stringify(lines(f))} ${h.at(f)}`);
    assert.equal(h.shown(f)?.who, "ItemStatementDialogue", `bone ${bone}: ${JSON.stringify(h.shown(f))} ${JSON.stringify(lines(f))} bones=${f.player.getInventory().getAmount(BONES)} stage=${h.stage(f)}`);
    assert.equal(f.player.getInventory().getAmount(BONES), 3 - bone);
    await h.converse(f, async () => {});
  }
  const leaves = f.locs.filter(([, kind]) => kind === "add").map(([, , id]) => id);
  for (const id of [2248, 2249, 2250]) assert.ok(leaves.includes(id), `leaf ${id}: ${leaves}`);
  h.ticks(f, 6);
  assert.equal(h.stage(f), STAGE.BONES);
  assert.equal(h.at(f)[1], 9481, `walked in: ${h.at(f)}`);
  assert.ok(f.locs.some(([, kind, id]) => kind === "add" && id === 2251));
  assert.ok(sounds(f).includes(46));
});

test("Nazastarool: the dolmen box shakes the camera; six ticks after it the zombie by the dolmen with both shouts; the forms rise in turn; after the ghost the curse and the remains on the ground (t4605-4842)", async (t) => {
  const f = h.actor(t, { at: [2892, 9486], stage: STAGE.BONES, beads: true });
  const said = overheads(t, f);
  const shakes = [];
  const sender = f.player.getPacketSender();
  t.mock.method(sender, "sendCameraShake", (...args) => { shakes.push(args); return sender; });
  await objectClick(f, DOLMEN, 2);
  assert.match(h.shown(f)?.text ?? "", /^You touch the dolmen/);
  assert.deepEqual(shakes[0], [0, 10, 0, 0]);
  assert.ok(sounds(f).includes(1678));
  await h.continueLine(f);
  const continued = f.tick;
  h.ticks(f, 9);
  const forms = unit().forms;
  const first = forms.get(f.player);
  assert.ok(first, "the zombie rose");
  assert.equal(first.npc.getId(), 5353);
  assert.deepEqual([first.npc.getLocation().getX(), first.npc.getLocation().getY()], [2890, 9486]);
  const zombie = said.filter((s) => s.who === 5353);
  assert.deepEqual(zombie.map((s) => s.text), ["Who dares disturb Rashiliyia's rest?", "I am Nazastarool! Prepare to die!"]);
  assert.equal(zombie[0].tick - continued, 6);

  const expected = [[5354, [2895, 9485]], [5355, [2893, 9484]]];
  for (let index = 0; index < 2; index++) {
    const npc = forms.get(f.player).npc;
    h.PM.emitNpcDeath({ killer: f.player, npc, npcId: npc.getId() });
    h.ticks(f, 8);
    assert.match(h.shown(f)?.text ?? "", /^You defeat Nazastarool/);
    await h.continueLine(f);
    h.ticks(f, 2);
    const next = forms.get(f.player);
    assert.equal(next?.npc.getId(), expected[index][0]);
    assert.deepEqual([next.npc.getLocation().getX(), next.npc.getLocation().getY()], expected[index][1]);
  }
  const ghost = forms.get(f.player).npc;
  const before = f.messages.length;
  h.PM.emitNpcDeath({ killer: f.player, npc: ghost, npcId: ghost.getId() });
  h.ticks(f, 5);
  // The boxes' text also goes to the chat as mesbox lines, as live's message_game does: only the chat lines here.
  assert.deepEqual(f.messages.slice(before).map((m) => m.text).filter((text) => !/^You hear a disembodied/.test(text)).slice(0, 3), [
    "You see something appear on the dolmen.",
    "Nazastarool: May you perish in the fires of Zamorak's furnace! Rashiliyia's",
    "Nazastarool: curse is upon you!",
  ]);
  assert.match(h.shown(f)?.text ?? "", /^You hear a disembodied voice/);
  await h.continueLine(f);
  assert.equal(h.shown(f)?.text, "You see something appear on the dolmen.");
  const { ItemOnGroundManager, Location } = h.core;
  const remains = ItemOnGroundManager.getGroundItem(f.player.getUsername(), CORPSE, new Location(2893, 9487, 0), null);
  assert.ok(remains, "the remains lie by the dolmen for this player");
});

test("Nazastarool: no form drops the remains", (t) => {
  for (const npcId of [5353, 5354, 5355]) {
    const event = { npcId, drops: [{ itemId: CORPSE, amount: 1 }, { itemId: 526, amount: 1 }] };
    h.PM.emitCustomEvent("npc-drops:roll", event);
    assert.deepEqual(event.drops.map((d) => d.itemId), [526], `form ${npcId}`);
  }
});

test("the remains taken from the ground: stage 14 and the remains box two ticks on; the dolmen then has nothing new (t4845-4854)", async (t) => {
  const f = h.actor(t, { at: [2892, 9486], stage: STAGE.BONES, beads: true, attributes: { "quest.shilo_village.mechanisms": (1 << 9) | (1 << 10) | (1 << 11) | (3 << 7) } });
  f.player.getInventory().add(new h.core.Item(CORPSE, 1), false);
  h.PM.emitCustomEvent("ground-items:taken", { player: f.player, itemId: CORPSE, amount: 1, source: "pickup" });
  h.tick(f);
  assert.equal(h.stage(f), STAGE.BONES);
  h.ticks(f, 2);
  assert.equal(h.stage(f), STAGE.CORPSE);
  assert.match(h.shown(f)?.text ?? "", /^You take the mummified remains/);
  assert.equal(h.shown(f).who, "ItemStatementDialogue");
  await h.continueLine(f);
  await objectClick(f, DOLMEN, 2);
  h.ticks(f, 2);
  assert.ok(lines(f).includes("You find nothing new on the dolmen."));
});
