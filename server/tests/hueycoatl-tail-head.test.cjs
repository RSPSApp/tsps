// node --test tests/hueycoatl-tail-head.test.cjs   (no build: the fight is driven with a fake session and clock)
// rsprox.net 4052 (rev 237): the tail is added at the east cave at tick 80 with face_angle 512 (instant) and body
// customisation model -1; at 81 it telejumps west with npc_huey_tail_appear_01, face_angle 1536 and a customisation
// reset; it sinks at 117 and shows east at 119 (face_angle 512, reset); broken, it sinks at 159 and 189 and is
// hidden (three -1 models) at 161 and 191. Each Rain Fire is huey_attack_melee in the shared NPC update and, to the
// player, npc_anim_specific huey_attack_<style> (huey_shield_attack_<style> shielded) and npc_spotanim_specific
// vfx_huey_attack_<style>_spotanim_01 in slot 0 (ticks 51, 73, 88; also 4054 and 3399).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Fight = require("../plugins/bosses/hueycoatl/Fight.Hueycoatl");
const Attacks = require("../plugins/bosses/hueycoatl/Attacks.Hueycoatl");
const Shared = require("../plugins/bosses/hueycoatl/Shared.Hueycoatl");
const Seer = require("../plugins/bosses/hueycoatl/Seer.Hueycoatl");
const Pillars = require("../plugins/bosses/hueycoatl/Pillars.Hueycoatl");
const Hud = require("../plugins/bosses/hueycoatl/Hud.Hueycoatl");
const Kills = require("../plugins/bosses/hueycoatl/Kills.Hueycoatl");

const clock = { now: 1000 };
const core = {
  World: { getProcessCycle: () => clock.now },
  Animation: class { constructor(id) { this.id = id; } getId() { return this.id; } },
  Graphic: class { constructor(id) { this.id = id; } getId() { return this.id; } },
  PrayerHandler: {},
};
Fight.attach({ core, onNpcBeforeDeath() {}, onServerStartup() {} });
Attacks.attach({ core });

for (const name of ["spawn", "runToPillars", "runToBody", "bodyLine", "remove", "defeated", "say", "tailLine"]) Seer[name] = () => null;
for (const name of ["reset", "start", "stop"]) Pillars[name] = () => {};
Hud.killed = () => {};
Hud.retarget = () => {};
Kills.killed = () => {};
Attacks.slam = () => {};

/** An NPC that records what a viewer would see of it: its form, held angle, customisation and sequences. */
function fakeNpc(id) {
  const npc = {
    id, transform: -1, registered: true, at: null, angle: null, custom: undefined, seqs: [],
    isRegistered() { return this.registered; },
    getId() { return this.transform !== -1 ? this.transform : this.id; },
    setNpcTransformationId(next) { this.transform = next; return this; },
    moveTo(tile) { this.at = tile; return this; },
    setFaceAngle(angle) { this.angle = angle; return this; },
    setTypeCustomisation(custom) { this.custom = custom ? custom : {}; return this; },
    performAnimation(animation) { this.seqs.push({ tick: clock.now, id: animation.id }); return this; },
    performGraphic() { return this; },
    getCombat() { return { reset() {} }; },
    getHitpoints() { return 1; },
    getIndex() { return 7; },
  };
  // Anything else the fight calls on a part (flags, combat setup) answers and chains.
  const proxy = new Proxy(npc, { get: (target, key) => (key in target || key === "then" ? target[key] : () => proxy) });
  return proxy;
}

function setup() {
  const queue = [];
  const session = {
    arena: new Set(),
    arenaPlayers() { return [...session.arena]; },
    schedule(ticks, action) { queue.push({ due: clock.now + ticks, action, generation: session.fight.generation }); },
    run(n) {
      for (let i = 0; i < n; i += 1) {
        clock.now += 1;
        const due = queue.filter((entry) => entry.due <= clock.now);
        for (const entry of due) queue.splice(queue.indexOf(entry), 1);
        for (const entry of due) if (entry.generation === session.fight.generation) entry.action();
      }
    },
    setLoc() {}, animateLoc() {}, sound() {}, removeNpc() {},
    spawnNpc: (id) => fakeNpc(id),
    inBounds: () => false,
    tile: (tile) => tile,
  };
  Fight.newFight(session);
  session.fight.head = fakeNpc(Shared.NPC.HEAD);
  return session;
}

const HIDDEN = { models: [-1] };
const SHOWN = {};

test("the tail spawns hidden facing west in the east cave, then shows west facing east a tick later", () => {
  const session = setup();
  Fight.shield(session);
  const { tail } = session.fight;
  assert.deepEqual(tail.custom, HIDDEN, "added with its model replaced by -1, as live's add");
  assert.equal(tail.angle, Shared.TAIL_FACE.east);
  assert.equal(Shared.TAIL_FACE.east, 512);
  session.run(1);
  assert.deepEqual(tail.at, Shared.TAIL_WEST);
  assert.equal(tail.angle, 1536, "out of the west cave it faces east");
  assert.deepEqual(tail.custom, SHOWN, "the customisation is reset as it shows");
  assert.deepEqual(tail.seqs.at(-1), { tick: clock.now, id: Shared.SEQ.TAIL_APPEAR });
});

test("the whole tail swaps sides in 2 ticks without being hidden, and faces the arena from each side", () => {
  const session = setup();
  Fight.shield(session);
  const { tail } = session.fight;
  session.run(1 + 36);
  assert.deepEqual(tail.seqs.at(-1).id, Shared.SEQ.TAIL_DISAPPEAR);
  session.run(2);
  assert.deepEqual(tail.at, Shared.TAIL_EAST);
  assert.equal(tail.angle, 512);
  assert.deepEqual(tail.custom, SHOWN, "it shows on the tick it would be hidden");
  session.run(38);
  assert.deepEqual(tail.at, Shared.TAIL_WEST);
  assert.equal(tail.angle, 1536);
  assert.deepEqual(tail.custom, SHOWN);
});

test("the broken tail is hidden with its three models 2 ticks after each sink, until it shows again", () => {
  const session = setup();
  Fight.shield(session);
  const { tail } = session.fight;
  session.run(5);
  Fight.breakTail(session);
  assert.equal(tail.getId(), Shared.NPC.TAIL_BROKEN);
  session.run(4);
  assert.equal(tail.seqs.at(-1).id, Shared.SEQ.TAIL_DISAPPEAR, "the broken tail sinks 4 ticks after breaking");
  session.run(1);
  assert.deepEqual(tail.custom, SHOWN, "still drawn while the sinking plays");
  session.run(1);
  assert.deepEqual(tail.custom, { models: [-1, -1, -1] }, "hidden 2 ticks after the sink");
  session.run(12);
  assert.deepEqual(tail.custom, SHOWN, "shown again 18 ticks after breaking");
  assert.deepEqual(tail.at, Shared.TAIL_EAST, "on the other side");
  assert.equal(tail.angle, 512);
  session.run(6 + 2);
  assert.deepEqual(tail.custom, { models: [-1, -1, -1] });
});

function fakePlayer() {
  const sent = [];
  const sender = {
    sendNpcAnimationSpecific(npc, animation) { sent.push({ kind: "anim", npc, id: animation.getId() }); return sender; },
    sendNpcSpotAnimationSpecific(npc, graphic, slot) { sent.push({ kind: "spot", npc, id: graphic.getId(), slot }); return sender; },
  };
  return { sent, isRegistered: () => true, getPacketSender: () => sender };
}

test("every Rain Fire is huey_attack_melee for everyone, the style's own rear and charge for each target", (t) => {
  const pick = Shared.pick;
  t.after(() => { Shared.pick = pick; });
  for (const shielded of [false, true]) {
    const session = setup();
    const { head } = session.fight;
    const players = [fakePlayer(), fakePlayer()];
    Shared.pick = (list) => list[2];
    Attacks.rainFire(session, players, shielded);
    assert.deepEqual(head.seqs.map((seq) => seq.id), [11669], "the shared update is huey_attack_melee, shielded or not");
    const own = shielded ? 11675 : 11671;
    for (const player of players) {
      assert.deepEqual(player.sent, [
        { kind: "anim", npc: head, id: own },
        { kind: "spot", npc: head, id: Shared.GFX.CHARGE.magic, slot: 0 },
      ]);
    }
  }
});
