// node --test tests/hueycoatl-camera-reset.test.cjs   (no build: the fight module is driven with a fake session, sender and clock)
// RSProx 3399 (rev 235.1, sha256 959e3599168b16f6e63502226c821062c287764fbff036e5b77529c8acac99e8): each path opening's
// CamShake (lines 14090-14092 at tick 630; 19333 at tick 895; 25136 at tick 1190) is followed by one CamReset 4 ticks
// later (14140 at 634; 19398 at 899; 25191 at 1194), and the barrier retracts 9 ticks after the shake. Only 3399 is
// verified for the reset tick. Our shake still sends three axes every time, which is not retail-exact.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Fight = require("../plugins/bosses/hueycoatl/Fight.Hueycoatl");
const Shared = require("../plugins/bosses/hueycoatl/Shared.Hueycoatl");
const Seer = require("../plugins/bosses/hueycoatl/Seer.Hueycoatl");
const Pillars = require("../plugins/bosses/hueycoatl/Pillars.Hueycoatl");
const Hud = require("../plugins/bosses/hueycoatl/Hud.Hueycoatl");
const Kills = require("../plugins/bosses/hueycoatl/Kills.Hueycoatl");

const clock = { now: 1000 };
const core = {
  World: { getProcessCycle: () => clock.now },
  Animation: class { constructor(id) { this.id = id; } },
};
Fight.attach({ core, onNpcBeforeDeath() {}, onServerStartup() {} });

// Stubs for the parts of the fight that are not under test.
Seer.spawn = () => null;
Seer.runToPillars = () => {};
Seer.runToBody = () => {};
Seer.bodyLine = () => {};
Seer.remove = () => {};
Seer.defeated = () => {};
Pillars.reset = () => {};
Pillars.start = () => {};
Pillars.stop = () => {};
Hud.killed = () => {};
Kills.killed = () => {};

/** Any call chain on a fake NPC or object answers without error. */
function anything() {
  return new Proxy(function () {}, {
    get: (_t, key) => (key === "then" ? undefined : key === "isRegistered" ? () => true : anything()),
    apply: () => anything(),
  });
}

function makePlayer(name) {
  const sends = { shakes: [], resets: 0 };
  const sender = {
    sendCameraShake: (...shake) => { sends.shakes.push(shake); },
    sendCameraReset: () => { sends.resets += 1; },
    getVarbit: () => 0,
    sendSound() {},
  };
  return {
    name,
    online: true,
    sends,
    isRegistered() { return this.online; },
    getPacketSender() { return sender; },
    sendMessage() {},
  };
}

/**
 * A fake arena session: `arena` holds the players currently in it; scheduled actions run on `run(n)` ticks.
 * Like the real Session.schedule, each event is stamped with the fight's generation and dropped if the generation
 * has moved on (defeat() and reset() bump it) before it is due.
 */
function setup(players) {
  const queue = [];
  const locs = [];
  const session = {
    arena: new Set(players),
    locs,
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
    setLoc(...args) { locs.push({ tick: clock.now, args }); },
    animateLoc() {},
    sound() {},
    spawnNpc: () => anything(),
    removeNpc() {},
    inBounds: () => false,
    tile: () => anything(),
  };
  Fight.newFight(session);
  return session;
}

test("the path shake is followed by exactly one camera reset per shaken player, 4 ticks after the shake", () => {
  const a = makePlayer("a");
  const b = makePlayer("b");
  const s = setup([a, b]);
  Fight.openPath(s);
  assert.equal(a.sends.shakes.length, 3, "the path shake is sent on each axis, as before");
  s.run(3);
  assert.equal(a.sends.resets, 0, "no reset before +4 ticks");
  s.run(1);
  assert.equal(a.sends.resets, 1, "one reset for a at +4 ticks");
  assert.equal(b.sends.resets, 1, "one reset for b at +4 ticks");
  s.run(20);
  assert.equal(a.sends.resets, 1, "never a second reset");
  assert.equal(b.sends.resets, 1, "never a second reset");
  assert.equal(s.fight.pendingCameraResets?.size ?? 0, 0, "nothing still tracked after the reset");
});

test("a fight reset between the shake and +4 ticks still resets the tracked players, once", () => {
  const a = makePlayer("a");
  const s = setup([a]);
  Fight.openPath(s);
  s.run(2);
  Fight.reset(s);
  assert.equal(a.sends.resets, 1, "the fight reset sends the pending reset");
  s.run(10);
  assert.equal(a.sends.resets, 1, "the scheduled +4 action does not send it again");
});

test("a player who is offline before +4 ticks is skipped without error; the others are still reset", () => {
  const a = makePlayer("a");
  const b = makePlayer("b");
  const s = setup([a, b]);
  Fight.openPath(s);
  s.run(2);
  a.online = false;
  assert.doesNotThrow(() => s.run(3));
  assert.equal(a.sends.resets, 0, "no reset is sent to an offline player");
  assert.equal(b.sends.resets, 1, "the online player is still reset");
});

test("a player who left the arena but is still online gets the reset", () => {
  const a = makePlayer("a");
  const s = setup([a]);
  Fight.openPath(s);
  s.run(2);
  s.arena.delete(a);
  s.run(3);
  assert.equal(a.sends.resets, 1, "the client still holds the shake, so the reset is sent");
});

test("the barrier retracts 9 ticks after the path shake, unchanged", () => {
  const a = makePlayer("a");
  const s = setup([a]);
  const shakeAt = clock.now;
  Fight.openPath(s);
  s.run(8);
  assert.equal(s.locs.filter((loc) => loc.args[3] === Shared.LOC.BARRIER_RETRACTED).length, 0, "not yet at +8");
  s.run(1);
  const retract = s.locs.filter((loc) => loc.args[3] === Shared.LOC.BARRIER_RETRACTED);
  assert.equal(retract.length, 1, "retracted at +9");
  assert.equal(retract[0].tick - shakeAt, 9);
});

test("a player who leaves the arena online gets the reset at once; the instance's destroy then sends nothing more", () => {
  const a = makePlayer("a");
  const s = setup([a]);
  Fight.openPath(s);
  s.run(2);
  Fight.releaseCameraReset(s, a, false); // leftArena: a departure that is not a logout
  assert.equal(a.sends.resets, 1, "reset immediately on leaving, before +4");
  Fight.sendAllCameraResets(s); // destroy(): the backstop before the session is disposed
  s.run(10);
  assert.equal(a.sends.resets, 1, "exactly once");
});

test("a player who leaves offline, or by logout, is not sent a reset; destroy sends nothing to them", () => {
  const a = makePlayer("a");
  const b = makePlayer("b");
  const s = setup([a, b]);
  Fight.openPath(s);
  s.run(2);
  a.online = false;
  assert.doesNotThrow(() => Fight.releaseCameraReset(s, a, false));
  Fight.releaseCameraReset(s, b, true); // logout: the client is gone, even though the object is still registered
  Fight.sendAllCameraResets(s);
  s.run(10);
  assert.equal(a.sends.resets, 0, "offline player: no reset");
  assert.equal(b.sends.resets, 0, "logout: no reset");
});
