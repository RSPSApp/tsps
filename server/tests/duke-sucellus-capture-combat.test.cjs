const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const Harness = require("./helpers/duke-sucellus.cjs");

before(Harness.initialize);

for(const style of ['melee','magic']) test(`Duke ${style} strike triggers one actual Elysian reaction`,t=>{
  const h=Harness.harness(t);h.enter();h.step(40);h.fight.wake();h.fight.nextAttack=Infinity;
  const graphics=[];
  h.p.getEquipment().set(h.core.Equipment.SHIELD_SLOT,new h.core.Item(h.core.ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD));
  t.mock.method(h.p,'performGraphic',graphic=>{if(graphic.getId()===321)graphics.push(321);});
  t.mock.method(Math,'random',()=>.5);
  h.C.strike(h.fight,style,40);h.step();
  assert.equal(h.p.getHitpoints(),84,'one 25-percent reduction of the rolled 20');
  assert.deepEqual(graphics,[321]);
});

for(const terminal of ['stop','fell']) test(`Duke ${terminal} cancels strike retaliation as well as displayed damage`,t=>{
  const h=Harness.harness(t);h.enter();h.step(40);h.fight.wake();h.fight.nextAttack=Infinity;
  t.mock.method(Math,'random',()=>.999);
  h.p.setHasVengeance(true);
  h.p.getEquipment().set(h.core.Equipment.RING_SLOT,new h.core.Item(h.core.ItemIdentifiers.RING_OF_RECOIL));
  const boss=h.fight.boss,hp=boss.getHitpoints();
  h.C.strike(h.fight,'melee',40);
  h.fight[terminal]();h.step();boss.getCombat().getHitQueue().process(h.core.World.getProcessCycle());
  assert.equal(h.p.getHitpoints(),99);
  assert.equal(h.p.hasVengeanceReturn(),true,'a cancelled zero hit must not consume Vengeance');
  assert.equal(h.p.getAttribute(h.core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE),undefined);
  assert.equal(boss.getHitpoints(),hp);
});

test('a late Duke strike after stop cannot damage the player or consume retaliation',t=>{
  const h=Harness.harness(t);h.enter();h.step(40);h.fight.wake();h.fight.nextAttack=Infinity;
  h.p.setHasVengeance(true);h.fight.stop();
  t.mock.method(Math,'random',()=>.999);
  h.C.strike(h.fight,'melee',40);h.step();
  assert.equal(h.p.getHitpoints(),99);
  assert.equal(h.p.hasVengeanceReturn(),true);
});

test('protected Duke magic keeps its selected range and reflects only damage after Elysian reduction',t=>{
  const h=Harness.harness(t);h.enter();h.step(40);h.fight.wake();h.fight.nextAttack=Infinity;
  h.p.getPrayerActive()[h.core.PrayerHandler.PROTECT_FROM_MAGIC]=true;
  h.p.setHasVengeance(true);
  h.p.getEquipment().set(h.core.Equipment.SHIELD_SLOT,new h.core.Item(h.core.ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD));
  h.p.getEquipment().set(h.core.Equipment.RING_SLOT,new h.core.Item(h.core.ItemIdentifiers.RING_OF_RECOIL));
  t.mock.method(Math,'random',()=>.5);
  const boss=h.fight.boss,hp=boss.getHitpoints(),rolled=Math.floor((h.C.data.normal.protectedMagic+1)*.5),taken=Math.floor(rolled*.75);
  h.C.strike(h.fight,'magic',h.C.data.normal.protectedMagic,{evenZero:true});h.step();
  boss.getCombat().getHitQueue().process(h.core.World.getProcessCycle());
  assert.ok(taken>0);assert.equal(h.p.getHitpoints(),99-taken);
  assert.equal(h.p.hasVengeanceReturn(),false);
  assert.equal(h.p.getAttribute(h.core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE),Math.floor(taken/10)+1);
  assert.equal(boss.getHitpoints(),hp-Math.floor(taken*.75)-Math.floor(taken/10)-1);
  assert.equal(h.fight.perfect,false);
});

test('Duke raw hazards retain their non-reflecting damage path',t=>{
  const h=Harness.harness(t);h.enter();h.step(40);h.fight.wake();h.fight.nextAttack=Infinity;
  h.p.setHasVengeance(true);
  h.p.getEquipment().set(h.core.Equipment.RING_SLOT,new h.core.Item(h.core.ItemIdentifiers.RING_OF_RECOIL));
  const boss=h.fight.boss,hp=boss.getHitpoints();
  h.C.hurt(h.fight,20,{min:20});h.step();boss.getCombat().getHitQueue().process(h.core.World.getProcessCycle());
  assert.equal(h.p.getHitpoints(),79);assert.equal(boss.getHitpoints(),hp);
  assert.equal(h.p.hasVengeanceReturn(),true);
  assert.equal(h.p.getAttribute(h.core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE),undefined);
});

test("gaze warning and successful avoidance use the rev 227+ colours and resolve four ticks later", (t) => {
  const h = Harness.harness(t);
  h.enter();
  h.move([3035, 6451]);
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  h.fight.gaze();
  assert.ok(h.messages.includes("<col=a53fff>Duke Sucellus turns his gaze upon you..."));
  const synths = () => h.packets.filter(([name]) => name === "sendSoundEffect").map(([, id]) => id);
  assert.ok(synths().includes(7215), "gaze start sound");
  h.step(3);
  assert.equal(h.spam.length, 0);
  h.step();
  assert.ok(h.spam.includes("<col=229628>You manage to avoid Duke Sucellus' gaze."));
  assert.ok(synths().includes(168), "gaze resolved sound");
  assert.equal(h.p.getHitpoints(), 99);
});

test("magic sends its delayed impact with the cast and applies the hit four ticks later", (t) => {
  const h = Harness.harness(t);
  h.enter();
  h.move([3039, 6440]);
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  const impacts = [], strikes = [];
  t.mock.method(h.p, "performGraphicInSlot", (slot, graphic) => impacts.push({ slot, graphic }));
  t.mock.method(h.C, "strike", (...args) => strikes.push({ tick: h.session.tick, args }));
  h.fight.auto();
  const projectile = h.packets.find(([name]) => name === "sendProjectile");
  assert.equal(projectile[4], 120, "projectile end cycle");
  assert.equal(projectile[6], 87.5, "projectile start height");
  assert.equal(projectile[7], 25, "projectile end height");
  assert.equal(projectile[9], 50, "projectile start cycle");
  assert.equal(impacts.length, 1, "the impact is scheduled at cast time");
  assert.equal(impacts[0].slot, 2);
  assert.equal(impacts[0].graphic.getId(), 2435);
  assert.equal(impacts[0].graphic.getDelay(), 120);
  h.step(3);
  assert.equal(strikes.length, 0);
  h.step();
  assert.equal(strikes.length, 1);
  assert.equal(strikes[0].args[1], "magic");
  assert.equal(impacts.length, 1, "the delayed impact is not re-sent when damage applies");
});

test("melee uses the seven front-row tile visuals without invented chip and main effects", (t) => {
  const h = Harness.harness(t);
  h.enter();
  h.move([3039, 6451]);
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  h.fight.auto();
  assert.equal(h.session.boss.getGraphic().getId(), 2439);
  const graphics = h.packets.filter(([name]) => name === "sendGraphic");
  assert.equal(graphics.length, 7);
  assert.deepEqual(graphics.map(([, graphic]) => graphic.getId()), [2440, 2441, 2442, 2443, 2442, 2441, 2440]);
  assert.deepEqual(graphics.map(([, , tile]) => h.C.source(h.session, tile)).sort((a, b) => a[0] - b[0]),
    Array.from({ length: 7 }, (_, offset) => [3036 + offset, 6451]));
});

test("prison eyes animate their original locs instead of replacing them with awake locs", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  h.move([3039, 6437]);
  h.packets.length = 0;
  const placements = [];
  const place = session.place.bind(session);
  t.mock.method(session, "place", (...args) => { placements.push(args); return place(...args); });
  h.step(h.C.data.timing.eyeCycle);
  const animations = h.packets.filter(([name]) => name === "sendObjectAnimation");
  assert.ok(animations.length >= 2);
  const eyeIds = new Set(h.C.data.extremities.map((eye) => eye.id));
  assert.ok(animations.every(([, object]) => eyeIds.has(object.getId())));
  assert.ok(!placements.some(([id]) => h.C.data.extremities.some((eye) => id === eye.id + 3)));
});

test("a failed gaze shows its line and spotanim, then freezes and hurts a tick later (1751)", (t) => {
  const h = Harness.harness(t);
  h.enter();
  h.move([3039, 6451]);
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  t.mock.method(Math, "random", () => 0.5);
  const graphics = [];
  t.mock.method(h.p, "performGraphicInSlot", (slot, graphic) => graphics.push([slot, graphic.getId()]));
  h.fight.gaze();
  h.step(4);
  assert.ok(h.spam.includes("<col=ff3045>You failed to avoid Duke Sucellus' gaze."));
  assert.deepEqual(graphics, [[2, 369]]);
  assert.equal(h.p.getHitpoints(), 99);
  assert.equal(h.messages.includes("<col=ef1020>You have been frozen!</col>"), false);
  h.step();
  assert.ok(h.messages.includes("<col=ef1020>You have been frozen!</col>"));
  assert.ok(h.p.getTimers().has(h.core.TimerKey.FREEZE), "the failed gaze freezes the player");
  h.step();
  assert.ok(h.p.getHitpoints() < 99);
  assert.equal(h.C.data.normal.gaze, 101, "one quest hit of 70 is not the normal-mode maximum");
});

test("gas holder uses the captured visual phases and never hurts before the active phase", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  const spawned = [], damageTicks = [];
  const spawn = h.api.spawnNpc.bind(h.api);
  t.mock.method(h.api, "spawnNpc", (definition) => { const npc = spawn(definition); spawned.push(npc); return npc; });
  t.mock.method(h.C, "hurt", () => damageTicks.push(session.tick));
  h.move(h.C.data.vents[0]);
  t.mock.method(Math, "random", () => 0);
  h.fight.ignite(h.C.data.vents[0]);
  h.step(2);
  const vent = spawned[0];
  assert.deepEqual(h.C.source(session, vent.getLocation()), [3035, 6441], "the 3x3 holder origin surrounds the vent centre");
  assert.equal(vent.getGraphic().getId(), 2431);
  assert.equal(vent.getGraphic().getDelay(), 30);
  h.step();
  assert.deepEqual(damageTicks, []);
  h.step(2);
  assert.equal(vent.getGraphic().getId(), 2432);
  h.step(9);
  assert.equal(vent.getGraphic().getId(), 2433);
  assert.deepEqual(damageTicks, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  h.step(3);
  assert.equal(vent.__removed, undefined);
  h.step();
  assert.equal(vent.__removed, true);
});

test("waking swaps the extremities to their awake locs and frozen feedback uses its captured slots", (t) => {
  const h = Harness.harness(t);
  h.enter();
  h.packets.length = 0;
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  const animations = () => h.packets.filter(([name]) => name === "sendObjectAnimation");
  assert.deepEqual(animations().map(([, , animation]) => animation.getId()), new Array(6).fill(10186));
  const placed = [];
  t.mock.method(h.session, "place", (id) => placed.push(id));
  h.step();
  assert.deepEqual(placed, h.C.data.extremities.map((eye) => eye.id + 3), "1751/3285: locs 47547-47549 a tick after waking");
  const graphics = [];
  t.mock.method(h.p, "performGraphicInSlot", (slot, graphic) => graphics.push({ slot, id: graphic.getId(), height: graphic.getHeight(), delay: graphic.getDelay() }));
  h.fight.freeze(5, true);
  assert.ok(h.messages.includes("<col=ff3045>You've been frozen in place!"));
  assert.ok(h.packets.some(([name, id]) => name === "sendSoundEffect" && id === 7200));
  assert.ok(h.packets.some(([name, id]) => name === "sendSoundEffect" && id === 171));
  assert.deepEqual(graphics, [
    { slot: 4, id: 1575, height: 124, delay: 0 },
    { slot: 2, id: 369, height: 0, delay: 0 },
  ]);
});

test("gas visuals belong to private vent NPCs and are cleaned up when the encounter stops", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const spawned = [], removed = [];
  const spawn = h.api.spawnNpc.bind(h.api), remove = h.api.removeNpc.bind(h.api);
  t.mock.method(h.api, "spawnNpc", (definition) => { const npc = spawn(definition); spawned.push(npc); return npc; });
  t.mock.method(h.api, "removeNpc", (npc) => { removed.push(npc); return remove(npc); });
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  h.fight.ignite(h.C.data.vents[0]);
  h.step(2);
  assert.equal(spawned.length, 1);
  const vent = spawned[0];
  assert.equal(vent.getId(), 12198);
  assert.equal(vent.getOwner(), h.p);
  assert.equal(vent.getPrivateArea(), session.area);
  assert.ok(!h.packets.some(([name, graphic]) => name === "sendGraphic" && [2431, 2432, 2433].includes(graphic.getId())));
  h.fight.stop();
  assert.ok(removed.includes(vent));
});

test("the kill closes the extremities, plays its loot effect and music, and the respawn restores them (1751/91/3285)", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  h.move([3035, 6451]);
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  h.step(2);
  const fight = h.fight, placed = [];
  const place = session.place.bind(session);
  t.mock.method(session, "place", (id, ...rest) => { placed.push(id); return place(id, ...rest); });
  h.packets.length = 0;
  const eyeAnimations = () => h.packets.filter(([name]) => name === "sendObjectAnimation").map(([, , animation]) => animation.getId());
  fight.fell();
  assert.deepEqual(eyeAnimations(), new Array(6).fill(10190));
  h.step();
  assert.deepEqual(eyeAnimations(), new Array(12).fill(10190), "10190 is sent on two ticks");
  assert.deepEqual(placed, []);
  h.step();
  assert.deepEqual(placed, h.C.data.extremities.map((eye) => eye.id + 6), "dead locs 47550-47552 two ticks after the lethal hit");
  h.step(2);
  fight.won(h.p);
  assert.ok(h.messages.includes("Fight duration: <col=ff0000>0:03.60</col> (new personal best)"), "six ticks from wake to the kill count message");
  const loot = h.packets.find(([name, graphic]) => name === "sendGraphic" && graphic.getId() === 85);
  assert.ok(loot, "spotanim 85 on the loot tile");
  assert.equal(loot[1].getHeight(), 16);
  assert.deepEqual(h.C.source(session, loot[2]), [3039, 6451]);
  assert.ok(h.packets.some(([name, id]) => name === "sendSong" && id === 759), "Prison Break at the kill");
  placed.length = 0;
  h.packets.length = 0;
  h.step(23 - 4);
  assert.notEqual(h.fight, fight, "respawned 23 ticks after the lethal hit");
  assert.deepEqual(placed.filter((id) => h.C.data.extremities.some((eye) => eye.id === id)), h.C.data.extremities.map((eye) => eye.id));
  assert.equal(session.boss.getAnimation()?.getId(), 10182);
  assert.ok(h.packets.some(([name, id]) => name === "sendSong" && id === 763), "Eye See You again at respawn");
  const shows = h.emitted.filter(([name, event]) => name === "boss-hud:show" && event.npcId === 12167);
  assert.deepEqual(shows.at(-1)[1].maximum, 200, "the HUD shows the sleeping poison meter");
});

test("combat sends its recorded sounds: magic impact, gas spit and the slam area sound", (t) => {
  const h = Harness.harness(t);
  h.enter();
  h.fight.wake();
  h.fight.nextAttack = Infinity;
  h.move([3039, 6440]);
  h.fight.auto();
  assert.ok(h.packets.some(([name, id, , delay]) => name === "sendSoundEffect" && id === 7197 && delay === 120));
  h.move([3039, 6451]);
  h.fight.auto();
  const slam = h.packets.find(([name, id]) => name === "sendAreaSound" && id === 2707);
  assert.ok(slam, "melee slam area sound");
  assert.equal(slam[7], 10, "radius");
  const row = h.session.tile([3039, 6452]);
  assert.deepEqual(slam.slice(2, 4), [row.getX(), row.getY()], "1751/1827/1703: on the boss row, not the slam row");
  h.fight.gas();
  assert.ok(h.packets.some(([name, id]) => name === "sendSoundEffect" && id === 5002));
  h.step(2);
  assert.ok(h.packets.some(([name, id, , , , , , radius]) => name === "sendAreaSound" && id === 2041 && radius === 3), "vent spawn");
});
