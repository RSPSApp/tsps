const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const Common = require('../plugins/bosses/whisperer/Common.Whisperer');
const { Fight, beforeDeath, modifyHit, dropContext, bindingCounter } = require('../plugins/bosses/whisperer/Fight.Whisperer');
const Specials = require('../plugins/bosses/whisperer/Specials.Whisperer');
const Site = require('../plugins/bosses/whisperer/Site.Whisperer');
let core;
const scoreboardFile = path.resolve(__dirname,'../data/saves/whisperer-scoreboard.json');
beforeEach(t => {
    const read = fs.readFileSync, write = fs.writeFileSync, mkdir = fs.mkdirSync;
    const owns = file => typeof file === 'string' && path.resolve(file) === scoreboardFile;
    t.mock.method(fs,'readFileSync',(file,...args)=>owns(file)?'{}':read(file,...args));
    t.mock.method(fs,'writeFileSync',(file,...args)=>{if(!owns(file))return write(file,...args);});
    t.mock.method(fs,'mkdirSync',(directory,...args)=>{if(path.resolve(directory)!==path.dirname(scoreboardFile))return mkdir(directory,...args);});
});
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
    Common.init({ core, emitCustomEvent() { }, removeNpc() { } });
});
function fixture(spellbook) {
    const player = new Player(null);
    player.setUsername('whisperer-test');
    if (spellbook) player.setSpellbook(spellbook);
    player.isRegistered = () => true;
    const sender = new Proxy({}, { get: () => () => sender });
    player.getPacketSender = () => sender;
    player.sendMessage = () => { };
    player.getLocation().setX(2656);
    player.getLocation().setY(6380);
    player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99);
    player.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99, false);
    player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 99);
    const area = new (class extends core.PrivateArea {
    })();
    const session = {
        player, area, ended: false,
        spawn(id, x, y) {
            const npc = core.NPC.create(id, new core.Location(x, y, 0));
            npc.isRegistered = () => true;
            npc.performAnimation = () => { };
            npc.forceChat = () => { };
            npc.setOwner(player);
            area.add(npc);
            return npc;
        },
    };
    area.add(player);
    const boss = session.spawn(Common.data.npcs.boss, 2655, 6369);
    boss.setMaxHitpoints(900);
    boss.setHitpoints(900);
    const fight = session.fight = new Fight(session, boss);
    boss.__whispererFight = fight;
    // Real PendingHits use the absolute World cycle; do not process them on an
    // unrelated test clock after achievement fixtures advance that cycle.
    let cycle = Math.max(100, core.World.getProcessCycle());
    const apply = () => player.getCombat().getHitQueue().process(++cycle);
    return { player, session, boss, fight, apply };
}
function startSpecial(fight,kind) {
    Specials.start(fight,kind);
    const preparation={seeds:6,screech:5,souls:4}[kind];
    for(let tick=0;tick<preparation;tick++) Specials.process(fight);
}

test('the three-tile Whisperer can follow the recorded diagonal pursuit steps with its whole footprint', t => {
    const f = fixture();
    assert.equal(f.boss.getSize(),3);
    f.boss.setNpcTransformationId(Common.data.npcs.melee);
    assert.equal(f.boss.getSize(),3);
    f.boss.setNeedsPlacement(false);
    f.boss.setScriptedMovement(true);
    // RSProx3285, normal actor12205:23066→23067→23068. The player stays
    // at2649,6369; the boss walks2655,6360→2654,6361→2653,6362.
    f.boss.setLocation(new core.Location(2655,6360,0));
    f.player.setLocation(new core.Location(2649,6369,0));
    const queue=f.boss.getMovementQueue();
    queue.reset();
    queue.addStep(2649,6369);
    let cycle=23066;
    t.mock.method(core.World,'getProcessCycle',()=>cycle);
    for(const [x,y] of [[2654,6361],[2653,6362]]) {
        cycle++;
        queue.beginCycle();
        queue.process();
        assert.deepEqual([f.boss.getLocation().getX(),f.boss.getLocation().getY()],[x,y]);
    }
});

test('a blocked outer footprint corner makes the Whisperer square the diagonal instead of clipping through it', () => {
    const f=fixture();
    f.boss.setNeedsPlacement(false);
    f.boss.setScriptedMovement(true);
    f.boss.setLocation(new core.Location(2655,6360,0));
    // This tile is inside the proposed3x3 northwest footprint, outside the
    // starting footprint and outside the safe west-only fallback footprint.
    const corner=new core.Location(2654,6363,0);
    f.session.area.setClip(corner,core.RegionManager.BLOCKED_TILE);
    assert.equal(core.RegionManager.blocked(corner,f.session.area),true);
    const queue=f.boss.getMovementQueue();
    queue.reset();
    queue.addStep(2649,6369);
    queue.beginCycle();
    queue.process();
    assert.deepEqual([f.boss.getLocation().getX(),f.boss.getLocation().getY()],[2654,6360]);
});


function pursuitWorldPasses(t,f) {
    let cycle=0;
    t.mock.method(core.World,'getProcessCycle',()=>cycle);
    f.player.setNeedsPlacement(false);
    f.boss.setNeedsPlacement(false);
    f.boss.setScriptedMovement(true);
    return () => {
        cycle++;
        // World.process runs NPC mechanics before player timers and area.
        f.boss.getTimers().process();
        f.boss.getMovementQueue().beginCycle();
        f.boss.getMovementQueue().process();
        f.player.getTimers().process();
        f.fight.process();
    };
}

test('normal binding takes its first actual pursuit step at cast plus five, not one movement pass later',t=>{
    const f=fixture(),step=pursuitWorldPasses(t,f);
    const origin=f.boss.getLocation().clone();
    f.fight.bind();
    for(let n=0;n<4;n++)step();
    assert.ok(f.boss.getLocation().equals(origin),'no first step through cast+4');
    step();
    assert.equal(f.fight.tick,5);
    assert.equal(f.boss.getLocation().equals(origin),false,'recorded NPC firstWALK+5 must reach the movement queue in time');
});

test('preparing pursuit a movement pass earlier does not advance already-adjacent melee',t=>{
    const f=fixture(),step=pursuitWorldPasses(t,f),melee=[];
    f.player.setLocation(new core.Location(2656,6372,0));
    const original=f.fight.melee.bind(f.fight);
    t.mock.method(f.fight,'melee',()=>{melee.push(f.fight.tick);original();});
    f.fight.bind();
    for(let n=0;n<4;n++)step();
    assert.deepEqual(melee,[]);
    step();
    assert.deepEqual(melee,[5]);
});

test('a real counter between pursuit route preparation and the NPC pass prevents the first step',t=>{
    const f=fixture(),step=pursuitWorldPasses(t,f);
    f.boss.setFlag('combat:freezable',true);
    const origin=f.boss.getLocation().clone();
    f.fight.bind();
    for(let n=0;n<4;n++)step();
    assert.ok(f.boss.getMovementQueue().hasPendingWork(),'next NPC pass has a prepared pursuit route');
    core.CombatFactory.freezeTicks(f.boss,20);
    step();
    step();
    assert.ok(f.boss.getLocation().equals(origin),'the counter cancels prepared movement');
    assert.equal(f.fight.boundUntil,0);
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),false,'the counter also suppresses the in-flight player bind');
});

test('generic pre-rolled hits retain ordinary prayer blocking unless explicit mitigation bypass is requested', () => {
    for(const bypassProtectionPrayer of [false,true]) {
        const f=fixture();
        f.player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE]=true;
        const method=new(class extends core.CombatMethod {type(){return core.CombatType.MELEE;}hits(){return[];}})();
        const hit=new core.PendingHit(f.boss,f.player,method,{damage:28,rollAccuracy:false,bypassProtectionPrayer});
        assert.equal(hit.getTotalDamage(),28,'the roll is made before the overhead is read');
        core.CombatFactory.applyHitTimeDefences(hit);
        assert.equal(hit.getTotalDamage(),bypassProtectionPrayer?28:0,'the overhead is read when the hit lands');
    }
});

for (const protectedMelee of [false, true]) test(`paired melee supports rearmed real Vengeance with protected=${protectedMelee}`, t => {
    const f = fixture();
    t.mock.method(Math, 'random', () => 0.999);
    f.player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE] = protectedMelee;
    const damage = protectedMelee ? 28 : 42, returned = Math.floor(damage * .75);
    f.player.setHasVengeance(true);
    f.fight.melee();
    f.apply();
    assert.equal(f.player.getHitpoints(), 99 - damage);
    assert.equal(f.player.hasVengeanceReturn(), false, 'first impact consumes Vengeance');
    f.boss.getCombat().getHitQueue().process(101);
    assert.equal(f.boss.getHitpoints(), 900 - returned);
    // A second successful cast between impacts must trigger on the second hit.
    f.player.setHasVengeance(true);
    f.fight.process();
    f.apply();
    f.boss.getCombat().getHitQueue().process(102);
    assert.equal(f.player.getHitpoints(), 99 - damage * 2);
    assert.equal(f.player.hasVengeanceReturn(), false);
    assert.equal(f.boss.getHitpoints(), 900 - returned * 2);
    assert.equal(f.fight.perfectKill, protectedMelee);
});

test('both real melee impacts expend recoil according to the applied paired damage', t => {
    const f = fixture();
    t.mock.method(Math, 'random', () => 0.999);
    f.player.getEquipment().set(core.Equipment.RING_SLOT, new core.Item(core.ItemIdentifiers.RING_OF_RECOIL));
    f.fight.melee();
    f.apply();
    f.boss.getCombat().getHitQueue().process(101);
    assert.equal(f.boss.getHitpoints(), 895);
    assert.equal(f.player.getAttribute(core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 5);
    f.fight.process();
    f.apply();
    f.boss.getCombat().getHitQueue().process(102);
    assert.equal(f.boss.getHitpoints(), 890);
    assert.equal(f.player.getAttribute(core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE), 10);
});

test('physical melee applies the actual Elysian reaction only once per impact', t => {
    const f=fixture(),graphics=[];
    f.player.getEquipment().set(core.Equipment.SHIELD_SLOT,new core.Item(core.ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD));
    t.mock.method(Math,'random',()=>0);
    t.mock.method(f.player,'performGraphic',graphic=>graphics.push(graphic.getId()));
    f.fight.melee();f.apply();
    assert.equal(f.player.getHitpoints(),78,'28 reduced by one 25-percent shield reaction');
    assert.deepEqual(graphics,[321]);
    f.fight.process();f.apply();
    assert.equal(f.player.getHitpoints(),57);
    assert.deepEqual(graphics,[321,321]);
});

test('lethal melee reflection follows player HP and cancels the second strike in real NPC-before-player order', t => {
    let cycle=100;
    t.mock.method(core.World,'getProcessCycle',()=>cycle);
    const f=fixture();
    t.mock.method(Math,'random',()=>.999);
    t.mock.method(PluginManager,'emitNpcBeforeDeath',event=>{beforeDeath(event);return event.preventDeath;});
    f.player.getEquipment().set(core.Equipment.RING_SLOT,new core.Item(core.ItemIdentifiers.RING_OF_RECOIL));
    f.fight.enraged=true;f.fight.nextAttack=Infinity;f.fight.startedSpecials=3;
    f.boss.setHitpoints(5);
    // The player's HP pass has already run when its area queues this melee.
    f.player.getCombat().getHitQueue().process(cycle);
    f.fight.melee();
    assert.equal(f.player.getHitpoints(),99);
    cycle++;
    f.boss.getCombat().getHitQueue().process(cycle);
    f.player.getCombat().getHitQueue().process(cycle);
    f.fight.process(); // Queue the second strike after the HP pass.
    assert.equal(f.player.getHitpoints(),57);
    assert.equal(f.boss.getHitpoints(),5,'reflection waits for the next NPC pass');
    assert.equal(f.fight.perfectKill,false);
    assert.equal(f.fight.over,false);
    cycle++;
    f.boss.getCombat().getHitQueue().process(cycle);
    assert.equal(f.boss.getHitpoints(),0);
    assert.equal(f.fight.over,true);
    assert.equal(f.fight.perfectKill,false,'lethal grade includes the actual preceding damage');
    assert.equal(f.fight.elapsedTicks,2);
    f.player.getCombat().getHitQueue().process(cycle);
    assert.equal(f.player.getHitpoints(),57,'the queued second strike cannot land after victory');
});

for(const terminal of ['finish','stop']) test(`queued physical melee does not consume retaliation after ${terminal}`, t=>{
    const f=fixture();
    f.player.setHasVengeance(true);
    f.player.getEquipment().set(core.Equipment.RING_SLOT,new core.Item(core.ItemIdentifiers.RING_OF_RECOIL));
    f.fight.melee();
    assert.equal([...f.fight.pendingDamage][0].getSource(),f.boss);
    f.fight[terminal]();
    f.apply();f.boss.getCombat().getHitQueue().process(101);
    assert.equal(f.player.getHitpoints(),99);
    assert.equal(f.boss.getHitpoints(),900);
    assert.equal(f.player.hasVengeanceReturn(),true);
    assert.equal(f.player.getAttribute(core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE),undefined);
    assert.equal(f.fight.perfectKill,true);
});

test('ordinary hazard damage retains its non-reflecting path', () => {
    const f=fixture();
    f.player.setHasVengeance(true);
    f.player.getEquipment().set(core.Equipment.RING_SLOT,new core.Item(core.ItemIdentifiers.RING_OF_RECOIL));
    Common.damage(f.fight,20,20);
    f.apply();f.boss.getCombat().getHitQueue().process(101);
    assert.equal(f.player.getHitpoints(),79);
    assert.equal(f.boss.getHitpoints(),900);
    assert.equal(f.player.hasVengeanceReturn(),true);
    assert.equal(f.player.getAttribute(core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE),undefined);
    assert.equal(f.fight.sanity,80);
});
test('cache identities distinguish spawn, boss, soul, effect and animation', () => {
    assert.equal(core.CacheDefinitions.getNpc(Common.data.npcs.boss).name, 'The Whisperer');
    assert.equal(core.CacheDefinitions.getNpc(Common.data.npcs.figure).name, 'Odd Figure');
    assert.equal(core.CacheDefinitions.getSeqName(Common.data.animations.tentacleSpawn), 'npc_whisperer_tentacle_01_spawn_01');
    for (const name of ['appear','screech','screechHold','screechBlast','seeds','souls','soulChant','soulResolve'])
        assert.match(core.CacheDefinitions.getSeqName(Common.data.animations[name]), /whisperer/, name);
    assert.equal(core.CacheDefinitions.getInterfaceId('sanity'), 834);
    assert.equal(core.CacheDefinitions.getVarbitId('sanity'), 15064);
});
test('volley patterns progress by completed specials and enrage starts ranged in pairs', () => {
    const { fight } = fixture();
    assert.deepEqual(fight.pattern('magic'), ['magic', 'magic', 'magic']);
    fight.completed = 1;
    assert.deepEqual(fight.pattern('ranged'), ['ranged', 'ranged', 'magic']);
    fight.completed = 3;
    assert.deepEqual(fight.pattern('magic'), ['magic', 'ranged', 'magic']);
    fight.enraged = true;
    assert.deepEqual([0, 1, 2, 3].map(n => { fight.attacks = n; return fight.pattern()[0]; }), ['ranged', 'ranged', 'magic', 'magic']);
});

test('normal volleys animate each handed shot with fixed three-tick flight and captured packet geometry', t => {
    const f = fixture(), animations = [], impacts = [], packets = [], waves = [];
    f.player.moveTo(new core.Location(2656,6378,0));
    t.mock.method(Math, 'random', () => 0);
    t.mock.method(f.boss, 'performAnimation', animation => animations.push([f.fight.tick,animation.getId()]));
    t.mock.method(f.fight, 'impact', style => impacts.push([f.fight.tick,style]));
    t.mock.method(f.fight, 'spawnTentacles', () => waves.push(f.fight.tick));
    const sender = new Proxy({}, { get: (_,key) => key === 'sendProjectile' ? (...args) => packets.push(args) : () => sender });
    f.player.getPacketSender = () => sender;
    f.fight.volley();
    for (let tick = 0; tick < 6; tick++) f.fight.process();
    assert.deepEqual(animations, [[1,10237],[2,10238],[3,10237]]);
    assert.deepEqual(impacts, [[4,'ranged'],[5,'ranged'],[6,'ranged']]);
    assert.deepEqual(waves, [5]);
    assert.equal(packets.length,3);
    for (const packet of packets) assert.deepEqual([packet[3],packet[4],packet[5]*4,packet[6]*4,packet[8],packet[9],packet[10]], [90,2444,350,100,30,254,128]);
});

test('enrage pairs alternate handed animations and launch one tentacle with each shot', t => {
    const f = fixture(), animations = [], waves = [];
    f.player.moveTo(new core.Location(2656,6378,0)); f.fight.enraged = true;
    t.mock.method(f.boss,'performAnimation',animation=>animations.push(animation.getId()));
    t.mock.method(f.fight,'spawnTentacles',()=>waves.push(f.fight.tick));
    t.mock.method(f.fight,'impact',()=>{});
    f.fight.volley();
    for (let tick = 0; tick < 7; tick++) f.fight.process();
    assert.deepEqual(animations,[10237,10238,10243,10244]);
    assert.deepEqual(waves,[1,3,5,7]);
});
test('actual applied damage spoils perfect context; immune and zero hits do not', () => {
    const f = fixture();
    Common.damage(f.fight, 0);
    f.apply();
    assert.equal(f.fight.perfectKill, true);
    Common.damage(f.fight, 5);
    f.apply();
    assert.equal(f.player.getHitpoints(), 94);
    assert.equal(f.fight.perfectKill, false);
    f.fight.over = true;
    f.boss.setHitpoints(0);
    const context = {};
    dropContext({ player: f.player, npc: f.boss, context });
    assert.equal(context.perfectKill, false);
});
test('sanity and prayer change every four ticks, and zero sanity starts escalating damage', () => {
    const f = fixture();
    f.fight.shadow = true;
    f.fight.sanity = 50;
    for (let i = 0; i < 4; i++)
        f.fight.sanityTick();
    assert.equal(f.fight.sanity, 47);
    assert.equal(f.player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 96);
    f.fight.shadow = false;
    for (let i = 0; i < 4; i++)
        f.fight.sanityTick();
    assert.equal(f.fight.sanity, 48);
    f.fight.sanity = 0;
    f.fight.sanityTick();
    f.apply();
    assert.ok(f.player.getHitpoints() < 99);
});
test('normal lethal blow enters 140 HP enrage and only final lethal damage ends fight', () => {
    const f = fixture();
    const event = { npc: f.boss, preventDeath: false };
    beforeDeath(event);
    assert.equal(event.preventDeath, true);
    assert.equal(f.boss.getHitpoints(), 140);
    assert.equal(f.fight.enraged, true);
    assert.equal(f.fight.shadow, false, 'realm transfer waits for the phase transition');
    const end = { npc: f.boss, preventDeath: false };
    beforeDeath(end);
    assert.equal(end.preventDeath, false);
    assert.equal(f.fight.over, true);
    assert.equal(f.fight.sanity, 100);
});
test('special incoming damage reduction uses current realm and soul vulnerability', () => {
    const f = fixture();
    f.fight.special = { kind: 'seeds' };
    const hit = { parts: [new core.HitDamage(100, core.HitMask.RED)], getHits() { return this.parts; }, updateTotalDamage() { } };
    modifyHit({ npc: f.boss, hit });
    assert.equal(hit.parts[0].getDamage(), 30);
    f.fight.shadow = true;
    hit.parts[0].setDamage(100);
    modifyHit({ npc: f.boss, hit });
    assert.equal(hit.parts[0].getDamage(), 40);
});
test('seeds finish on all light tiles; dark tile hurts and timeout deals 75', () => {
    const f = fixture();
    startSpecial(f.fight, 'seeds');
    const seeds = [...f.fight.special.seeds];
    const dark = seeds.find(seed => !seed.light);
    f.player.moveTo(new core.Location(dark.x, dark.y, 0));
    Specials.process(f.fight);
    f.apply();
    assert.ok(f.player.getHitpoints() < 99);
    for (const seed of seeds.filter(seed => seed.light)) {
        f.player.moveTo(new core.Location(seed.x, seed.y, 0));
        Specials.process(f.fight);
    }
    assert.equal(f.fight.special, null);
    assert.equal(f.fight.completed, 1);
    const late = fixture();
    startSpecial(late.fight, 'seeds');
    late.fight.special.left = 1;
    Specials.process(late.fight);
    late.apply();
    assert.equal(late.player.getHitpoints(), 24);
});
test('screech cover is exactly the 2x2 behind a column and each blast weakens all columns', () => {
    const f = fixture();
    startSpecial(f.fight, 'screech');
    assert.equal(f.fight.special.columns.length, 8);
    const column = f.fight.special.columns.find(c => c.hp === 20);
    f.player.moveTo(new core.Location(column.x, column.y + 2, 0));
    f.fight.special.left = 1;
    Specials.process(f.fight);
    Specials.process(f.fight);
    Specials.process(f.fight);
    f.apply();
    assert.equal(f.player.getHitpoints(), 99);
    assert.equal(column.active, false);
    assert.ok(f.fight.special.columns.some(c => c.active && c.hp === 40));
    assert.ok(f.fight.special.columns.every(c => !c.active || [20, 40].includes(c.hp)));
});
test('all four published seed patterns contain their full light and dark layouts', () => {
    assert.deepEqual([0, 1, 2, 3].map(pattern => {
        const seeds = Specials.seedLayout(pattern);
        return [seeds.length, seeds.filter(s => s.light).length];
    }), [[24, 12], [24, 16], [28, 14], [28, 14]]);
});

test('the first two seed layouts use the ordinary-game tile grid rather than the rotated screenshot grid', () => {
    // Wiki alternate-view tile diagram; corroborated by normal level791 capture3285 ticks20931/21824.
    const positions = [[-2,0],[-2,4],[-4,2],[-4,0],[-3,-1],[2,0],[2,4],[4,2],[0,2],[4,0],[0,4],[1,3],[3,3],[3,1],[2,2],[-2,-4],[-4,-2],[-1,-3],[-3,-3],[-2,-2],[2,-4],[4,-2],[0,-2],[0,-4]];
    const lights = [[-2,0],[-2,4],[-4,2],[2,0],[2,4],[4,2],[0,2],[-2,-4],[-4,-2],[2,-4],[4,-2],[0,-2]];
    const sorted = values => values.map(value => value.join(',')).sort();
    for (const pattern of [0, 1]) {
        const seeds = Specials.seedLayout(pattern);
        assert.deepEqual(sorted(seeds.map(s => [s.dx,s.dy])), sorted(positions));
        assert.deepEqual(sorted(seeds.filter(s => s.light).map(s => [s.dx,s.dy])),
            sorted(pattern ? [...lights,[-4,0],[4,0],[0,4],[0,-4]] : lights));
    }
});

test('normal seed centre and all eight screech columns occupy the captured cathedral tiles in both realms', t => {
    const f = fixture(); t.mock.method(Math, 'random', () => 0);
    startSpecial(f.fight, 'seeds');
    assert.deepEqual([f.boss.getLocation().getX(),f.boss.getLocation().getY()], [2655,6368]);
    assert.ok(f.fight.special.seeds.some(s => s.light && s.x === 2654 && s.y === 6369));
    startSpecial(f.fight, 'screech');
    assert.deepEqual([f.boss.getLocation().getX(),f.boss.getLocation().getY()], [2655,6356]);
    const expected = [[2646,6365],[2648,6361],[2651,6363],[2654,6364],[2657,6364],[2660,6363],[2663,6361],[2665,6365]];
    assert.deepEqual(f.fight.special.columns.map(c => [c.x,c.y]), expected);
    f.fight.setShadow(true);
    assert.deepEqual(f.fight.special.columns.map(c => [c.x+256,c.y]), expected);
});

test('normal souls occupy twelve fixed cathedral tiles with independently shuffled chant roles', t => {
    const expected = [[2650,6375],[2650,6373],[2648,6373],[2660,6375],[2662,6373],[2648,6366],[2650,6364],[2652,6362],[2662,6362],[2662,6364],[2664,6364],[2664,6371]];
    const assignments = [];
    for (const random of [0, .99]) {
        const f = fixture(); t.mock.method(Math, 'random', () => random);
        startSpecial(f.fight, 'souls');
        assert.deepEqual(f.fight.special.souls.map(s => [s.npc.getLocation().getX(),s.npc.getLocation().getY()]), expected);
        assert.deepEqual([0,1,2,3].map(group => f.fight.special.souls.filter(s => s.group === group).length), [2,3,3,4]);
        assignments.push(f.fight.special.souls.map(s => s.group));
        f.fight.setShadow(true);
        assert.deepEqual(f.fight.special.souls.map(s => [s.npc.getLocation().getX()+256,s.npc.getLocation().getY()]), expected);
    }
    assert.notDeepEqual(assignments[0], assignments[1]);
});
test('soul sets remain attackable only in shadow and timeout with no full set damages and heals', () => {
    const f = fixture();
    startSpecial(f.fight, 'souls');
    assert.equal(f.fight.special.souls.length, 12);
    const hit = { parts: [new core.HitDamage(10, core.HitMask.RED)], getHits() { return this.parts; }, updateTotalDamage() { } };
    modifyHit({ npc: f.fight.special.souls[0].npc, hit });
    assert.equal(hit.parts[0].getDamage(), 0);
    f.fight.special.left = 1;
    f.boss.setHitpoints(500);
    Specials.process(f.fight);
    f.apply();
    assert.equal(f.player.getHitpoints(), 49);
    assert.equal(f.boss.getHitpoints(), 600);
});
test('final death cancels queued encounter damage instead of hitting after the kill', () => {
    const f = fixture();
    Common.damage(f.fight, 20, 20);
    f.fight.finish();
    f.apply();
    assert.equal(f.player.getHitpoints(), 99);
});
test('projectile prayer is checked at scheduled impact and correct protection prevents recoil too', t => {
    const f = fixture();
    t.mock.method(core.CombatFactory, 'applyStyleDamage', hit => { hit.getHits()[0].setDamage(20); hit.updateTotalDamage(); });
    const hits = [];
    t.mock.method(core.CombatFactory, 'executeHit', hit => {
        hits.push(hit.getTotalDamage());
        f.player.getCombat().getHitQueue().addPendingDamage(hit.getHits());
    });
    f.player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MAGIC] = true;
    f.fight.impact('magic');
    f.apply();
    assert.deepEqual(hits, [0]);
    assert.equal(f.player.getHitpoints(), 99);
    f.player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MAGIC] = false;
    f.fight.impact('magic');
    f.apply();
    assert.deepEqual(hits, [0, 20]);
    assert.equal(f.player.getHitpoints(), 79);
    assert.equal(f.fight.perfectKill, false);
});
test('tentacles remain at their three-tile origins and strike static four-tile rays after three ticks', t => {
    const f = fixture(), graphics = [];
    f.player.moveTo(new core.Location(2656,6376,0));
    t.mock.method(Math,'random',()=>0);
    t.mock.method(f.fight,'validTentacleTile',()=>true);
    const sender = new Proxy({}, {get:(_,key)=>key==='sendGraphic' ? (g,p)=>graphics.push([g.getId(),g.getDelay(),p.getX(),p.getY()]) : ()=>sender});
    f.player.getPacketSender=()=>sender;
    f.fight.spawnTentacles();
    assert.deepEqual(f.fight.tentacles.map(t=>[t.npc.getLocation().getX(),t.npc.getLocation().getY()]),[[2651,6371],[2659,6371],[2659,6379],[2651,6379]]);
    const origin=f.fight.tentacles[0].npc.getLocation();
    const originTile=[origin.getX(),origin.getY()];
    f.player.moveTo(new core.Location(2653,6373,0));
    for(let tick=1;tick<=2;tick++){f.fight.tick=tick;f.fight.processTentacles();f.apply();assert.equal(f.player.getHitpoints(),99);}
    assert.deepEqual(graphics.slice(0,4),[[2447,5,2653,6373],[2448,10,2654,6374],[2449,15,2655,6375],[2450,20,2656,6376]]);
    assert.deepEqual([origin.getX(),origin.getY()],originTile);
    f.fight.setShadow(true);
    f.fight.tick=3;f.fight.processTentacles();f.apply();assert.equal(f.player.getHitpoints(),79);
    f.fight.processTentacles();f.apply();assert.equal(f.player.getHitpoints(),79,'one hit per wave');
    f.fight.tick=4;f.fight.processTentacles();assert.equal(f.fight.tentacles.length,0);
});
test('soul rewards count a lethal hit before its delayed death event', () => {
    const f = fixture();
    startSpecial(f.fight, 'souls');
    const vita = f.fight.special.souls.filter(s => s.group === 0);
    f.player.setHitpoints(50);
    for (const soul of vita)
        beforeDeath({ npc: soul.npc, preventDeath: false });
    assert.ok(f.fight.special.rewarded.has(0));
    assert.equal(f.player.getHitpoints(), 69, '20 percent of the base hitpoints level');
});
test('postquest entry needs a fragment, owns both realms and cleans actors and UI on leave', () => {
    const f = fixture();
    const removed = [];
    let questComplete = false;
    Common.init({ core,
        emitCustomEvent(name, event) {
            if (name === 'quest:is-complete')
                event.complete = questComplete;
        },
        removeNpc(npc) { removed.push(npc); },
        spawnNpc({ id, x, y, z }) { return f.session.spawn(id, x, y); },
    });
    const figure = f.session.spawn(Common.data.npcs.figure, 2655, 6369);
    assert.equal(Site.disturb({ player: f.player, npc: figure }), false);
    questComplete = true;
    assert.equal(Site.disturb({ player: f.player, npc: figure }), true);
    assert.equal(Site.sessionOf(f.player), undefined, 'missing fragment does not allocate an area');
    f.player.getInventory().adds(core.ItemIdentifiers.BLACKSTONE_FRAGMENT, 1);
    Site.disturb({ player: f.player, npc: figure });
    const session = Site.sessionOf(f.player);
    assert.ok(session);
    const fight = session.fight;
    assert.equal(f.player.getInventory().contains(28357), true, 'entry normalizes a stale glowing fragment from the earlier implementation');
    assert.equal(f.player.getInventory().contains(28356), false);
    assert.equal(session.area.canAttack(f.player, fight.boss), false, 'waking Odd Figure is not attackable');
    for(let i=0;i<4;i++)fight.process();
    assert.equal(session.area.canAttack(f.player, fight.boss), true);
    assert.equal(session.area.canAttack(new Player(null), fight.boss), false);
    startSpecial(fight, 'seeds');
    const event = { player: f.player, itemId: core.ItemIdentifiers.BLACKSTONE_FRAGMENT_2, option: 'Activate' };
    assert.equal(Site.fragmentAction(event), true);
    assert.equal(event.handled, true);
    assert.equal(f.player.getLocation().getX(), 2400);
    startSpecial(fight,'screech');
    assert.equal(fight.shadow,true);
    for(let tick=6;tick<=14;tick++)Specials.process(fight);
    assert.equal(f.player.getInventory().contains(28357),true,'screech window normalizes fragment');
    Site.fragmentAction(event);
    assert.equal(fight.shadow,true,'deactivated fragment cannot exit Shadow Realm mid-screech');
    const grave = { player: f.player };
    Site.grave(grave);
    assert.deepEqual(grave.tile, { x: 2922, y: 5826, z: 0 });
    assert.equal(grave.feeMultiplier, .25);
    Site.leave({ player: f.player });
    assert.equal(session.ended, true);
    assert.equal(fight.stopped, true);
    assert.equal(Site.sessionOf(f.player), undefined);
    assert.equal(f.player.getPrivateArea(), null, 'leaving detaches the player from the destroyed private area');
    assert.equal(f.player.getAttribute(Common.INSIDE_ATTRIBUTE), false);
    assert.equal(f.player.getLocation().getX(), 2656);
    assert.equal(f.player.getLocation().getY(), 6386);
});
test('the placeholder fragment is not accepted and a real fragment glows only during specials', () => {
    const f = fixture();
    assert.ok(core.CacheDefinitions.getItem(core.ItemIdentifiers.BLACKSTONE_FRAGMENT_3).placeholderTemplate >= 0);
    assert.deepEqual(Site.fragments(), [28356, 28357]);
    assert.equal(core.ItemDefinition.forId(28356).getExamine(), "It's vibrating with energy!");
    assert.equal(core.ItemDefinition.forId(28357).getExamine(), 'A strange shard of dark stone with various modifications.');
    f.player.getInventory().adds(28357, 1);
    startSpecial(f.fight, 'seeds');
    assert.equal(f.player.getInventory().contains(28356), true);
    Specials.clear(f.fight);
    assert.equal(f.player.getInventory().contains(28357), true);
});



test('both melee hits grade the damage-roll prayer snapshot and protected chip remains perfect', t => {
    t.mock.method(Math, 'random', () => 0);
    for (const protectedMelee of [false, true]) {
        const f = fixture();
        const prayer = f.player.getPrayerActive();
        prayer[core.PrayerHandler.PROTECT_FROM_MELEE] = protectedMelee;
        f.fight.melee();
        prayer[core.PrayerHandler.PROTECT_FROM_MELEE] = !protectedMelee;
        f.apply();
        const first = 99 - f.player.getHitpoints();
        assert.ok(first > 0, 'protected melee still deals chip');
        assert.equal(f.fight.perfectKill, protectedMelee);
        f.fight.events.shift().action();
        f.apply();
        assert.equal(99 - f.player.getHitpoints(), first * 2);
        assert.equal(f.fight.perfectKill, protectedMelee);
    }
    const cancelled = fixture();
    cancelled.fight.melee();
    Common.cancelDamage(cancelled.fight);
    cancelled.apply();
    assert.equal(cancelled.player.getHitpoints(), 99);
    assert.equal(cancelled.fight.perfectKill, true);
});

test('crossing the next special threshold replaces the post-special bind', () => {
    for (const [kind, started, threshold, next] of [['screech', 1, 495, 'souls'], ['souls', 2, 270, 'seeds']]) {
      for (const [hp, skipsBind] of [[threshold, true], [threshold - 1, true], [threshold + 1, false]]) {
        const f = fixture();
        f.fight.startedSpecials = started;
        f.fight.completed = started - 1;
        f.fight.rotation = ['screech', 'souls', 'seeds'];
        f.boss.setHitpoints(hp);
        startSpecial(f.fight, kind);
        if (kind === 'souls')
            for (const soul of f.fight.special.souls.filter(soul => soul.group === 0)) Specials.soulDied(f.fight, soul.npc);
        const projectiles = [];
        const sender = f.player.getPacketSender();
        f.player.getPacketSender = () => new Proxy(sender, { get: (target, key) => key === 'sendProjectile' ? (...args) => projectiles.push(args) : target[key] });
        while (f.fight.special) f.fight.process();
        assert.equal(projectiles.length, skipsBind ? 0 : 1, `HP ${hp}`);
        if (skipsBind) {
            assert.equal(f.fight.boundUntil, 0);
            f.fight.process();
            assert.equal(f.fight.special.kind, next);
            assert.equal(f.fight.startedSpecials, started + 1);
        }
      }
    }
});

test('melee protection mitigates roughly one third and mirrors the protected amount', t => {
    t.mock.method(Math, 'random', () => 0.999999);
    const f = fixture();
    f.player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE] = true;
    f.fight.melee();
    f.apply();
    assert.equal(f.player.getHitpoints(), 71, 'a max 42 melee hit is reduced to 28');
    f.fight.events.shift().action();
    f.apply();
    assert.equal(f.player.getHitpoints(), 43);
    assert.equal(f.fight.perfectKill, true);
});

test('a threshold crossed mid-volley waits for the next attack and keeps launched impacts', t => {
    const f = fixture();
    f.player.moveTo(new core.Location(2656, 6378, 0));
    let impacts = 0;
    t.mock.method(f.fight, 'impact', () => impacts++);
    t.mock.method(core.Projectile, 'arrivalTicks', () => 2);
    f.fight.volley();
    f.fight.process();
    f.boss.setHitpoints(720);
    f.fight.process();
    assert.equal(f.fight.special === null, true);
    for (let tick = 3; tick <= 9; tick++) f.fight.process();
    assert.equal(impacts, 3);
    assert.equal(f.fight.special === null, true);
    f.fight.process();
    assert.ok(f.fight.special);
    assert.equal(f.fight.startedSpecials, 1);
});

test('only pursuit after the third special stops below 100 HP and leaves the remaining bind', t => {
    for (const [completed, hp, cancelled] of [[2, 99, false], [3, 100, false], [3, 99, true]]) {
        const f = fixture();
        f.fight.completed = completed;
        f.fight.boundUntil = 14;
        f.boss.setHitpoints(hp);
        f.player.getTimers().registers(core.TimerKey.FREEZE, 12);
        let steps = 0, resets = 0;
        t.mock.method(f.boss.getMovementQueue(), 'addStep', () => steps++);
        t.mock.method(f.boss.getMovementQueue(), 'reset', () => resets++);
        f.fight.pursueBound();
        assert.equal(f.fight.boundUntil, 14, 'the existing bind window still permits a later freeze counter');
        assert.equal(steps, cancelled ? 0 : 1);
        assert.equal(resets, cancelled ? 1 : 0);
        assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE), true);
    }
});
test('normal source spawn suppression leaves quest and unrelated spawns untouched', () => {
    for (const [npcId, x, expected] of [[12204, 2655, false], [12206, 2399, null], [12204, 3000, null]]) {
        const event = { npcId, location: new core.Location(x, 6369, 0), allow: null };
        Site.suppressSpawn(event);
        assert.equal(event.allow, expected);
    }
});
test('ice and standard binding spells are guaranteed during pursuit and boss freeze releases the player', () => {
    const f = fixture();
    f.fight.boundUntil = 14;
    f.player.getCombat().setCastSpell(core.CombatSpells.ICE_BARRAGE);
    const event = { attacker: f.player, target: f.boss, combatType: core.CombatType.MAGIC, forceAccurate: false };
    bindingCounter(event);
    assert.equal(event.forceAccurate, true);
    f.player.getTimers().registers(core.TimerKey.FREEZE, 12);
    f.boss.getTimers().registers(core.TimerKey.FREEZE, 20);
    f.fight.pursueBound();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE), false);
    assert.equal(f.fight.boundUntil, 0);
});

test('existing marked Undead Grasp bind releases the player during Whisperer pursuit', t => {
    t.mock.method(Math, 'random', () => .99);
    for (const [marked, lowHealth] of [[false, false], [true, false], [true, true]]) {
        const f = fixture();
        f.fight.boundUntil = 14;
        if (lowHealth) { f.fight.completed = 3; f.boss.setHitpoints(99); }
        f.boss.setFlag('combat:freezable', true);
        f.player.getTimers().registers(core.TimerKey.FREEZE, 12);
        if (marked) core.ArceuusSpells.placeMark(f.player);
        assert.equal(core.ArceuusSpells.hasMark(f.player), marked);
        const spell = core.CombatSpells.UNDEAD_GRASP;
        const hit = { isAccurate: () => true, getAttacker: () => f.player, getTarget: () => f.boss, getTotalDamage: () => 0 };
        spell.onHitCalc(hit);
        spell.finishCast(f.player, f.boss, true, 0);
        assert.equal(f.boss.getTimers().has(core.TimerKey.FREEZE), marked);
        f.fight.pursueBound();
        assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE), !marked);
        assert.equal(f.fight.boundUntil, marked ? 0 : 14);
    }
});

test('low-health pursuit cancellation preserves the launched bind and a later freeze counter', t => {
    const f = fixture();
    f.fight.completed = f.fight.startedSpecials = 3;
    f.boss.setHitpoints(99);
    f.fight.nextAttack = Infinity;
    f.player.moveTo(new core.Location(2656, 6378, 0));
    t.mock.method(f.boss.getMovementQueue(), 'addStep', () => assert.fail('pursuit must stop'));
    f.fight.bind();
    for(let i=0;i<5;i++)f.fight.process();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE), false);
    f.fight.process();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE), true);
    f.boss.getTimers().registers(core.TimerKey.FREEZE, 4);
    f.fight.process();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE), false);
});
test('running across a seed consumes the intermediate tile as well as the destination', () => {
    const f=fixture();startSpecial(f.fight,'seeds');
    const seed=f.fight.special.seeds.find(s=>s.light);
    f.player.moveTo(new core.Location(seed.x+1,seed.y,0));
    f.player.setRunningDirection(core.Direction.EAST);
    Specials.process(f.fight);
    assert.equal(seed.active,false);
});
test('the boss approaches targets outside ten tiles before launching another volley', t => {
    const f=fixture();f.player.moveTo(new core.Location(2656,6384,0));f.fight.nextAttack=0;
    t.mock.method(f.fight,'volley',()=>{f.fight.attacks++;});
    f.fight.process();assert.equal(f.fight.attacks,0);
});
test('tentacles cannot originate on blocked arena tiles or inside the boss', () => {
    const f=fixture();
    const tile=new core.Location(2652,6376,0);
    f.session.area.setClip(tile,core.RegionManager.BLOCKED_TILE);
    assert.equal(f.fight.validTentacleTile(tile.getX(),tile.getY()),false);
    assert.equal(f.fight.validTentacleTile(2656,6370),false);
});
test('existing Combat Achievements counts a normal kill once and restores the canonical boss key', () => {
    const Data=require('../plugins/achievements/combatachievements/Data.CombatAchievements');
    const Kills=require('../plugins/achievements/combatachievements/Kills.CombatAchievements');
    Data({core});
    assert.equal(Data.monsterNamed('Whisperer, The').byEvent,false);
    const f=fixture(), listeners=new Map(), deaths=[];
    const api=new Proxy({core,
        onNpcDeath(handler){deaths.push(handler);},
        onCustomEvent(name,handler){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(handler);},
        emitCustomEvent(name,event){for(const handler of listeners.get(name)||[])handler(event);},
    },{get:(object,key)=>object[key]??(()=>{})});
    Common.init(api);Kills(api);Site.attach(api);require('../plugins/bosses/whisperer/Fight.Whisperer').attach(api);
    f.fight.finish();
    for(const handler of deaths)handler({killer:f.player,npc:f.boss,npcId:12204});
    assert.equal(Kills.counts(f.player)['Whisperer, The'],1);
    assert.equal(f.player.getAttribute(Common.KILLS_ATTRIBUTE),1);
    const restore={player:f.player,counts:{}};api.emitCustomEvent('combat-achievements:kill-count',restore);
    assert.equal(restore.counts['Whisperer, The'],1);
    f.player.setAttribute(Common.BEST_ATTRIBUTE,123);
    const pb={player:f.player,monster:'Whisperer, The'};api.emitCustomEvent('combat-achievements:personal-best',pb);
    assert.equal(pb.best,123);
});
test('ordinary postquest rope and activated teleporter reach the cathedral without a debug teleport', () => {
    const f=fixture(),vars=new Map(),menus=[];let completed=false;
    const sender=new Proxy({}, {get:(_,key)=>key==='getVarbit'?(id=>vars.get(id)||0):key==='sendVarbit'?((id,value)=>{vars.set(id,value);return sender;}):(()=>sender)});
    f.player.getPacketSender=()=>sender;
    Common.init({core,emitCustomEvent(name,event){if(name==='quest:is-complete')event.complete=completed;},
        sendMultiChatboxPrompt(_player,_title,...choices){menus.push(choices);}});
    const entrance={player:f.player,objectId:49477,option:'climb-rope',location:{x:2922,y:5827,z:0},handled:false};
    assert.equal(Site.travel(entrance),false,'the quest retains its incomplete route');
    completed=true;Site.travel(entrance);
    assert.equal(entrance.handled,true);assert.equal(f.player.getLocation().getX(),2587);
    assert.equal(f.player.getLocation().getY(),6435,'the cache rope tile is blocked; arrive beside it');
    f.player.moveTo(new core.Location(2593,6423,0));
    const portal={player:f.player,objectId:49479,option:'activate',location:{x:2593,y:6424,z:0},handled:false};
    Site.travel(portal);assert.equal(vars.get(15088),1);
    vars.set(15090,1);Site.travel({...portal,option:'use'});
    const menu=menus.at(-1), index=menu.findIndex(choice=>choice==='Cathedral');
    assert.ok(index>=0);menu[index+1]();
    // The teleporter tile is solid; the tile south of it has only a wall edge, so it is the landing.
    assert.equal(f.player.getLocation().getX(),2652);assert.equal(f.player.getLocation().getY(),6404,'the teleporter tile is blocked; arrive beside it');
    const exit={player:f.player,objectId:48198,option:'climb-up',location:{x:2587,y:6436,z:0},handled:false};
    Site.travel(exit);assert.equal(exit.handled,true);
    assert.equal(f.player.getLocation().getX(),2922);assert.equal(f.player.getLocation().getY(),5826);
});
test('lethal damage freezes PB before the death animation and repeated death delivery cannot count twice', t => {
    let cycle=100;t.mock.method(core.World,'getProcessCycle',()=>cycle);
    const f=fixture(),hooks=[];
    const api=new Proxy({core,emitCustomEvent(){},onNpcDeath(handler){hooks.push(handler);}}, {get:(o,key)=>o[key]??(()=>{})});
    Common.init(api);require('../plugins/bosses/whisperer/Fight.Whisperer').attach(api);
    cycle=150;f.fight.finish();cycle=155;
    for(const handler of hooks){handler({npc:f.boss,killer:f.player});handler({npc:f.boss,killer:f.player});}
    assert.equal(f.player.getAttribute(Common.BEST_ATTRIBUTE),50);
    assert.equal(f.player.getAttribute(Common.KILLS_ATTRIBUTE),1);
});
test('postquest teleporter activations restore after quest login varbits are synchronized', t => {
    const Travel=require('../plugins/bosses/whisperer/Travel.Whisperer'),f=fixture(),vars=new Map(),tasks=[];
    f.player.setAttribute(Travel.TELEPORTERS_ATTRIBUTE,[0]);
    f.player.getPacketSender=()=>({sendVarbit:(id,value)=>vars.set(id,value)});
    Common.init({core,emitCustomEvent(name,event){if(name==='quest:is-complete')event.complete=true;}});
    t.mock.method(core.TaskManager,'submit',task=>tasks.push(task));
    Travel.restore({player:f.player});
    vars.set(15088,0); // Existing DT2 login hook runs later with its own saved discovery state.
    for(const task of tasks)task.execute();
    assert.equal(vars.get(15088),1);
});

function achievementFixture(t, { spellbook = core.MagicSpellbook.ARCEUUS, onTask = false } = {}) {
    let cycle = 100;
    t.mock.method(core.World, 'getProcessCycle', () => cycle);
    const awards = [], deaths = [], attacks = [];
    const api = new Proxy({ core,
        emitCustomEvent(name, event) {
            if (name === 'combat-achievements:complete') awards.push(event.task);
            if (name === 'slayer:on-task') event.onTask = onTask;
        },
        onNpcDeath(handler) { deaths.push(handler); },
        onCombatHitRoll(handler) { attacks.push(handler); },
    }, { get: (object, key) => object[key] ?? (() => {}) });
    Common.init(api);
    const f = fixture(spellbook);
    require('../plugins/bosses/whisperer/Fight.Whisperer').attach(api);
    const death = () => { for (const handler of deaths) handler({ npc: f.boss, killer: f.player }); };
    return Object.assign(f, { awards, death,
        kill(ticks = 400, beforeDeath = () => {}) { cycle = f.fight.startCycle + ticks; f.boss.setHitpoints(0); f.fight.finish(); beforeDeath(); death(); },
        setOnTask(value) { onTask = value; },
        attack() { for (const handler of attacks) handler({ attacker: f.player, target: f.boss, forceAccurate: false }); },
        nextFight() {
            f.boss = f.session.spawn(Common.data.npcs.boss, 2655, 6369);
            f.boss.setMaxHitpoints(900); f.boss.setHitpoints(900);
            f.fight = f.session.fight = new Fight(f.session, f.boss);
            f.boss.__whispererFight = f.fight;
        },
    });
}

test('normal speed achievements use current cache limits, strict lethal times and no Slayer task', t => {
    const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements'); Data({ core });
    for (const [rank, text, before, boundary] of [['Trialist', '3:00', 299, 300], ['Chaser', '2:25', 241, 242], ['Runner', '2:05', 208, 209]]) {
        const name = `Whisperer Speed-${rank}`;
        assert.ok(Data.taskNamed(name).description.includes(text));
        for (const [ticks, onTask, expected] of [[before, false, true], [boundary, false, false], [before, true, false]]) {
            const f = achievementFixture(t, { onTask }); f.kill(ticks);
            assert.equal(f.awards.includes(name), expected, `${name}, ticks=${ticks}, onTask=${onTask}`);
        }
    }
});

test('Tentacular tracks Arceuus throughout the fight including a changed-away-and-back spellbook', t => {
    const valid = achievementFixture(t); valid.kill(); assert.ok(valid.awards.includes('Tentacular'));
    const switched = achievementFixture(t);
    switched.fight.nextAttack = Infinity;
    switched.player.setSpellbook(core.MagicSpellbook.NORMAL); switched.fight.process();
    switched.player.setSpellbook(core.MagicSpellbook.ARCEUUS); switched.kill();
    assert.equal(switched.awards.includes('Tentacular'), false);
    const late = achievementFixture(t, { spellbook: core.MagicSpellbook.NORMAL });
    late.player.setSpellbook(core.MagicSpellbook.ARCEUUS); late.kill();
    assert.equal(late.awards.includes('Tentacular'), false);
    const cast = achievementFixture(t);
    cast.player.setSpellbook(core.MagicSpellbook.NORMAL); cast.attack();
    cast.player.setSpellbook(core.MagicSpellbook.ARCEUUS); cast.kill();
    assert.equal(cast.awards.includes('Tentacular'), false, 'an off-book cast between process ticks is tracked');
});

test('speed eligibility is frozen before a lethal Slayer kill can clear the task', t => {
    const f = achievementFixture(t, { onTask: true });
    f.kill(100, () => f.setOnTask(false));
    assert.equal(f.awards.some(name => name.startsWith('Whisperer Speed-')), false);
});

test('Dark Memories counts fewer than ten pre-enrage Shadow Realm ticks and ignores enrage', t => {
    for (const [ticks, expected] of [[9, true], [10, false]]) {
        const f = achievementFixture(t);
        f.fight.nextAttack = Infinity; f.fight.startedSpecials = 3;
        f.fight.setShadow(true);
        for (let tick = 0; tick < ticks; tick++) f.fight.process();
        beforeDeath({ npc: f.boss, preventDeath: false });
        f.fight.nextAttack = Infinity;
        for (let tick = 0; tick < 20; tick++) f.fight.process();
        f.kill(); assert.equal(f.awards.includes('Dark Memories'), expected);
    }
});

test('five perfect kills can include an imperfect kill, count once and never carry into another session', t => {
    const f = achievementFixture(t);
    for (const [index, perfect] of [true, true, false, true, true, true].entries()) {
        if (index) f.nextFight();
        f.fight.perfectKill = perfect; f.kill();
        assert.equal(f.awards.includes('Perfect Whisperer'), index === 5);
    }
    const before = f.awards.length; f.death(); assert.equal(f.awards.length, before);
    const fresh = achievementFixture(t); fresh.kill();
    assert.equal(fresh.awards.includes('Perfect Whisperer'), false);
});

test('enrage tentacles choose all eight cardinal and diagonal origins', t => {
    const f=fixture();f.fight.enraged=true;f.player.moveTo(new core.Location(2656,6376,0));
    t.mock.method(f.fight,'validTentacleTile',()=>true);
    const expected=[[-4,-4],[0,-4],[4,-4],[4,0],[4,4],[0,4],[-4,4],[-4,0]];
    for(let index=0;index<8;index++){
        const random=t.mock.method(Common,'random',()=>index);
        f.fight.spawnTentacles(); const tentacle=f.fight.tentacles.at(-1);
        assert.deepEqual([tentacle.x-2656,tentacle.y-6376],expected[index]);random.mock.restore();
    }
});

test('special preparation and screech fragment window follow normal packet phases',()=>{
    for(const [kind,delay] of [['seeds',6],['screech',5],['souls',4]]){
        const f=fixture();Specials.start(f.fight,kind);
        assert.equal(f.fight.special.active,false);assert.equal(f.fight.special.switchAllowed,false);
        for(let tick=1;tick<delay;tick++){Specials.process(f.fight);assert.equal(f.fight.special.active,false);}
        Specials.process(f.fight);assert.equal(f.fight.special.active,true);assert.equal(f.fight.special.switchAllowed,true);
        if(kind==='screech'){
            for(let tick=6;tick<=14;tick++)Specials.process(f.fight);
            assert.equal(f.fight.special.switchAllowed,false);assert.equal(f.fight.special.blasts,3);
            for(let tick=15;tick<=17;tick++)Specials.process(f.fight);
            assert.equal(f.fight.special.blasts,2);
            for(let tick=18;tick<=23;tick++)Specials.process(f.fight);
            assert.equal(f.fight.special.blasts,1);
            for(let tick=24;tick<29;tick++)Specials.process(f.fight);
            assert.equal(f.fight.special.blasts,1);
            Specials.process(f.fight);assert.ok(f.fight.special);
            for(let tick=30;tick<=31;tick++){Specials.process(f.fight);assert.ok(f.fight.special);}
            Specials.process(f.fight);assert.equal(f.fight.special,null);
        }
        if(kind==='seeds'||kind==='souls'){
            const remaining=kind==='seeds'?40:17;
            assert.equal(f.fight.special.left,remaining);
            for(let tick=1;tick<remaining;tick++)Specials.process(f.fight);
            assert.ok(f.fight.special,'special remains active until its deadline');
            Specials.process(f.fight);assert.equal(f.fight.special,null);
        }
    }
});


test('normal lethal damage delays enrage appearance, realm transfer and first shot while retaining launched impacts', t => {
    const f = fixture(), animations = [], impacts = [];
    f.player.moveTo(new core.Location(2656,6378,0));
    t.mock.method(Math,'random',()=>0);
    t.mock.method(f.boss,'performAnimation',a=>animations.push([f.fight.tick,a.getId()]));
    t.mock.method(f.fight,'impact',style=>impacts.push([f.fight.tick,style]));
    f.fight.volley();
    f.fight.process();
    beforeDeath({npc:f.boss,preventDeath:false});
    assert.equal(f.fight.shadow,false);
    for(let i=0;i<4;i++)f.fight.process();
    assert.deepEqual(animations,[[1,10237],[5,10248]]);
    assert.deepEqual(impacts,[[4,'ranged']]);
    assert.equal(f.fight.shadow,false);
    f.fight.process();
    assert.equal(f.fight.shadow,true);
    f.fight.process();f.fight.process();
    assert.deepEqual(animations,[[1,10237],[5,10248],[8,10237]]);
});

test('enrage entered in the Shadow Realm retains the realm without an appearance animation', t => {
    const f=fixture(), animations=[];
    f.player.moveTo(new core.Location(2656,6378,0));f.fight.setShadow(true);
    t.mock.method(f.boss,'performAnimation',a=>animations.push([f.fight.tick,a.getId()]));
    beforeDeath({npc:f.boss,preventDeath:false});
    for(let i=0;i<7;i++)f.fight.process();
    assert.equal(f.fight.shadow,true);
    assert.deepEqual(animations,[[7,10237]]);
});


test('wake holds the Odd Figure for four ticks and launches the first shot at wake plus eight', t => {
    const f=fixture(), animations=[], forms=[];
    f.player.moveTo(new core.Location(2656,6378,0));
    t.mock.method(f.boss,'performAnimation',a=>animations.push([f.fight.tick,a.getId()]));
    t.mock.method(f.boss,'setNpcTransformationId',id=>forms.push([f.fight.tick,id]));
    f.fight.wake();
    assert.equal(f.fight.waking,true);
    for(let i=0;i<3;i++)f.fight.process();
    assert.equal(f.fight.waking,true);
    assert.deepEqual(forms,[[0,12203]]);
    f.fight.process();
    assert.equal(f.fight.waking,false);
    assert.deepEqual(forms,[[0,12203],[4,12204]]);
    for(let i=0;i<4;i++)f.fight.process();
    assert.deepEqual(animations.map(([tick,id])=>[tick,id]),[[0,10227],[4,65535],[8,10237]]);
});


test('binding retains captured packet constants and prepares its route before the fifth-tick NPC movement pass', t => {
    const f=fixture(), packets=[], steps=[];
    const sender=new Proxy({}, {get:(_,key)=>key==='sendProjectile'?((...args)=>packets.push(args)):(()=>sender)});
    f.player.getPacketSender=()=>sender;
    f.player.moveTo(new core.Location(2659,6378,0));
    t.mock.method(f.boss.getMovementQueue(),'addStep',()=>steps.push(f.fight.tick));
    f.fight.bind();
    assert.equal(packets.length,1);
    const packet=packets[0];
    assert.deepEqual([packet[3],packet[4],packet[5]*4,packet[6]*4,packet[8],packet[9],packet[10]], [170,2467,580,0,80,16,150]);
    assert.deepEqual([packet[0].getX(),packet[0].getY(),packet[1].getX(),packet[1].getY()],[2656,6370,2659,6378]);
    f.player.moveTo(new core.Location(2660,6379,0));
    assert.equal(packet[1].getX(),2659,'flight endpoint is the cast-time snapshot');
    for(let i=0;i<3;i++)f.fight.process();
    assert.deepEqual(steps,[]);
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),false);
    f.fight.process();
    assert.deepEqual(steps,[4]);
    f.fight.process();
    assert.deepEqual(steps,[4,5]);
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),false);
    f.fight.process();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),true);
    assert.equal(f.fight.boundUntil,14,'existing provisional phase duration is retained');
});

test('an uncountered bind provisionally releases after eight ticks rather than outlasting pursuit', () => {
    const f = fixture();
    f.fight.bind();
    for (let tick = 0; tick < 6; tick++) f.fight.process();
    const timers = f.player.getTimers();
    for (let tick = 0; tick < 7; tick++) timers.process();
    assert.equal(timers.has(core.TimerKey.FREEZE), true);
    timers.process();
    assert.equal(timers.has(core.TimerKey.FREEZE), false);
});

test('binding visibly casts in the melee form and returns to the normal form after a counter or expiry', t => {
    for (const countered of [false, true]) {
        const f = fixture(), animations = [];
        t.mock.method(f.boss, 'performAnimation', animation => animations.push(animation.getId()));
        f.fight.bind();
        assert.equal(f.boss.getNpcTransformationId(), 12205);
        assert.deepEqual(animations, [10254]);
        if (countered) {
            f.boss.getTimers().registers(core.TimerKey.FREEZE, 20);
            f.fight.process();
        } else {
            f.fight.nextAttack = 100;
            while (f.fight.tick < 14) f.fight.process();
        }
        assert.equal(f.boss.getNpcTransformationId(), 12204);
    }
});

test('special and enrage transitions leave the binding melee form', () => {
    for (const transition of ['seeds', 'screech', 'souls', 'enrage']) {
        const f = fixture();
        f.fight.bind();
        if (transition === 'enrage') beforeDeath({ npc: f.boss, preventDeath: false });
        else Specials.start(f.fight, transition);
        assert.equal(f.boss.getNpcTransformationId(), 12204, transition);
    }
});

test('binding impact shows its target graphic once at the scheduled impact and a counter suppresses it', t => {
    for (const countered of [false, true]) {
        const f = fixture(), graphics = [];
        t.mock.method(f.player, 'performGraphic', graphic => graphics.push([f.fight.tick, graphic.getId()]));
        f.fight.bind();
        for (let tick = 0; tick < 5; tick++) f.fight.process();
        assert.deepEqual(graphics, []);
        if (countered) {
            f.boss.getTimers().registers(core.TimerKey.FREEZE, 20);
            f.fight.pursueBound();
        }
        f.fight.process();
        f.fight.process();
        assert.deepEqual(graphics, countered ? [] : [[6, 2466]]);
    }
});

test('a binding melee attack retains its form through both hits and restores before its following volley', () => {
    const f = fixture();
    f.player.moveTo(new core.Location(2655, 6372, 0));
    // Complete the setup teleport before the real combat resolver accepts hits.
    f.player.setNeedsPlacement(false);
    f.fight.bind();
    for (let tick = 0; tick < 5; tick++) f.fight.process();
    f.apply();
    const first = 99 - f.player.getHitpoints();
    assert.ok(first > 0);
    assert.equal(f.boss.getNpcTransformationId(), 12205);
    f.fight.process();
    f.apply();
    assert.equal(99 - f.player.getHitpoints(), first * 2);
    assert.equal(f.boss.getNpcTransformationId(), 12205);
    f.player.moveTo(new core.Location(2655, 6378, 0));
    const nextVolley = f.fight.nextAttack;
    while (f.fight.tick < nextVolley) f.fight.process();
    assert.equal(f.boss.getNpcTransformationId(), 12204);
});

test('ordinary Disturb preserves each adjacent approach tile when entering the private cathedral', () => {
    for (const [x, y] of [[2656,6371], [2656,6367], [2654,6369], [2658,6369]]) {
        const f = fixture();
        f.session.area.remove(f.player);
        f.player.moveTo(new core.Location(x, y, 0));
        f.player.getInventory().adds(core.ItemIdentifiers.BLACKSTONE_FRAGMENT_2, 1);
        Common.init({core,
            emitCustomEvent(name, event) { if (name === 'quest:is-complete') event.complete = true; },
            removeNpc() {},
            spawnNpc({id,x,y,z,owner}) {
                const npc = core.NPC.create(id, new core.Location(x,y,z));
                npc.setOwner(owner);
                return npc;
            },
        });
        const beforeClip = core.RegionManager.getClipping(x,y,0,null);
        const figure = core.NPC.create(Common.data.npcs.figure, new core.Location(2655,6368,0));
        Site.disturb({player:f.player,npc:figure});
        const session = Site.sessionOf(f.player);
        assert.ok(session);
        assert.equal(f.player.getPrivateArea(),session.area);
        assert.deepEqual([f.player.getLocation().getX(),f.player.getLocation().getY()],[x,y]);
        assert.equal(core.RegionManager.getClipping(x,y,0,session.area),beforeClip);
        assert.equal(beforeClip & 0x200100,0,'the real cache approach tile is walkable');
        assert.equal(session.area.canAttack(f.player,session.fight.boss),false);
        Site.leave({player:f.player});
    }
    Common.init({core,emitCustomEvent(){},removeNpc(){}});
});

test('shadow columns use clean native forty-pixel health bars and remove them outside the realm', () => {
    const f = fixture();
    f.fight.setShadow(true);
    startSpecial(f.fight,'screech');
    const fills = {20:14,40:27,60:40};
    for (const column of f.fight.special.columns) {
        assert.deepEqual(column.npc.getTickHits(),[],'revealing health does not create a blue zero hitsplat');
        assert.deepEqual(column.npc.getHeadbars(),[{id:2,fill:fills[column.hp],endFill:fills[column.hp],duration:0,delay:0}]);
        column.npc.resetUpdating();
    }
    Specials.process(f.fight);
    assert.ok(f.fight.special.columns.every(column=>column.npc.getHeadbars().length===1),'shadow bars refresh without hits each tick');
    const strongest = f.fight.special.columns.find(column=>column.hp===60);
    while (f.fight.special.age<19) Specials.process(f.fight);
    assert.equal(strongest.hp,40);
    assert.deepEqual(strongest.npc.getHeadbars(),[{id:2,fill:27,endFill:27,duration:0,delay:0}]);
    for(const column of f.fight.special.columns)column.npc.resetUpdating();
    f.fight.setShadow(false);
    for (const column of f.fight.special.columns.filter(column=>column.active)) {
        assert.deepEqual(column.npc.getTickHits(),[]);
        assert.deepEqual(column.npc.getHeadbars(),[{id:2,remove:true}]);
    }
});

test('normal north and south wake approaches use the native three-tile two-tick flyback', t => {
    const tasks = [];
    t.mock.method(core.TaskManager,'submit',task=>{task.setRunning(true);tasks.push(task);});
    for (const [y,dy,direction] of [[6371,3,2],[6367,-3,0]]) {
        const f = fixture();
        f.boss.moveTo(new core.Location(2655,6368,0));
        f.player.moveTo(new core.Location(2656,y,0));
        f.fight.wake();
        const movement = f.player.getForceMovement();
        assert.ok(movement,'wake immediately starts the native flyback');
        assert.deepEqual([movement.getStart().getX(),movement.getStart().getY(),movement.getEnd().getX(),movement.getEnd().getY()],[2656,y,0,dy]);
        assert.deepEqual([movement.getSpeed(),movement.getReverseSpeed(),movement.getDirection(),movement.getAnimation()],[0,60,direction,9799]);
        const task = tasks.at(-1);
        task.tick();
        assert.equal(f.player.getLocation().getY(),y);
        task.tick();
        assert.equal(f.player.getLocation().getY(),y+dy);
        assert.equal(f.player.getForceMovement(),null);
        f.fight.stop();
    }
});

test('leaving during wake cancels its flyback task instead of returning the player to the cathedral', t => {
    let task;
    t.mock.method(core.TaskManager,'submit',value=>{task=value;task.setRunning(true);});
    const f = fixture();
    f.boss.moveTo(new core.Location(2655,6368,0));
    f.player.moveTo(new core.Location(2656,6371,0));
    f.fight.wake();
    assert.ok(f.player.getForceMovement());
    f.player.moveTo(new core.Location(2656,6386,0));
    f.fight.stop();
    assert.equal(f.player.getForceMovement(),null);
    task.tick();task.tick();
    assert.equal(f.player.getLocation().getY(),6386);
});

function recordBoard() {
    const f=fixture(), hooks={before:[],death:[],npcDeath:[],objects:new Map(),attributes:[]}, interfaces=[], strings=new Map();
    let complete=true,canonical=0;
    const sender=new Proxy({}, {get:(_,name)=>name==='sendInterface'?id=>interfaces.push(id):name==='sendString'?(text,uid)=>strings.set(uid&65535,text):()=>sender});
    f.player.getPacketSender=()=>sender;
    const api=new Proxy({core,
        persistAttribute:(...args)=>hooks.attributes.push(args),
        onBeforeObjectInteraction:fn=>hooks.before.push(fn),
        onPlayerDeath:fn=>hooks.death.push(fn),
        onNpcDeath:fn=>hooks.npcDeath.push(fn),
        onObjectInteraction:(name,actions)=>hooks.objects.set(name,actions),
        emitCustomEvent(name,event){if(name==='quest:is-complete')event.complete=complete;if(name==='combat-achievements:count')event.total=canonical;},
        spawnNpc({id,x,y,z,owner}){const npc=core.NPC.create(id,new core.Location(x,y,z));npc.setOwner(owner);return npc;},
    },{get:(object,key)=>object[key]??(()=>{})});
    Common.init(api);Site.attach(api);
    return {...f,hooks,interfaces,strings,api,setComplete:value=>complete=value,setCanonical:value=>canonical=value};
}

test('owned Whisperer boss, columns and souls retain scripted HP through the real idle NPC regeneration clock',t=>{
    const h=recordBoard(),session=new Site.Session(h.player);
    t.after(()=>session.end());
    let cycle=1;t.mock.method(core.World,'getProcessCycle',()=>cycle);
    session.start();
    const boss=session.fight.boss;boss.isRegistered=()=>true;boss.setHitpoints(300);
    startSpecial(session.fight,'screech');
    const columns=session.fight.special.columns;
    for(const column of columns){column.npc.isRegistered=()=>true;column.npc.setHitpoints(column.hp);column.npc.getCombat().getLastAttack().reset();}
    boss.getCombat().getLastAttack().reset();
    cycle=100;
    for(let tick=0;tick<5;tick++){
        cycle++;boss.process();for(const column of columns)column.npc.process();
    }
    assert.equal(boss.getHitpoints(),300,'idle NPC healing must not refill the boss between scripted phases');
    for(const column of columns)assert.equal(column.npc.getHitpoints(),column.hp,'the native headbar HP must not regenerate');
    const soul=session.spawn(Common.data.npcs.soul,2656,6364);soul.isRegistered=()=>true;
    soul.setMaxHitpoints(10);soul.setHitpoints(1);soul.getCombat().getLastAttack().reset(1);
    soul.process();assert.equal(soul.getHitpoints(),1,'owned soul HP is scripted too');
});

test('normal and shadow Whisperer scoreboard parents Read the native statistics interface and existing personal records', () => {
    const h=recordBoard(), read=h.hooks.objects.get('Scoreboard')?.Read;
    assert.equal(typeof read,'function');
    h.player.setAttribute(Common.KILLS_ATTRIBUTE,12);h.player.setAttribute(Common.BEST_ATTRIBUTE,123);h.setCanonical(25);
    for(const id of [46092,49474]){
        const event={player:h.player,objectId:id,clickType:1,handled:false};
        for(const hook of h.hooks.before)hook(event);
        assert.equal(event.handled,true);
    }
    assert.deepEqual(h.interfaces,[830,830]);
    assert.equal(h.strings.get(9),'25');
    assert.equal(h.strings.get(11),'0 (recorded)');
    assert.equal(h.strings.get(13),'1:13.80');
    for(const id of [47580,47581,47582,47583])assert.equal(read({player:h.player,objectId:id}),true);
    assert.equal(read({player:h.player,objectId:47588}),false,'other bosses are not handled');
    assert.equal(read({player:h.player,objectId:48174}),false,'the broken normal transform has no Read action');
    const nonRead={player:h.player,objectId:46092,clickType:2,handled:false};
    for(const hook of h.hooks.before)hook(nonRead);
    assert.equal(nonRead.handled,false);
    h.setComplete(false);
    assert.equal(read({player:h.player,objectId:47582}),false);
});

test('Whisperer records only active fight deaths once and completed kills once', () => {
    const h=recordBoard();
    require('../plugins/bosses/whisperer/Fight.Whisperer').attach(h.api);
    const read=()=>h.hooks.objects.get('Scoreboard').Read({player:h.player,objectId:47582});
    read();
    const beforeKills=Number(h.strings.get(15).replace(/[^0-9]/g,''));
    assert.equal(h.hooks.death.length,1);
    const death=()=>h.hooks.death[0]({player:h.player});
    death();
    assert.equal(Number(h.player.getAttribute(Common.DEATHS_ATTRIBUTE))||0,0,'staging is excluded');
    h.player.moveTo(new core.Location(2656,6371,0));
    h.player.getInventory().adds(core.ItemIdentifiers.BLACKSTONE_FRAGMENT_2,1);
    Site.disturb({player:h.player,npc:core.NPC.create(12203,new core.Location(2655,6368,0))});
    const session=Site.sessionOf(h.player), fight=session.fight;
    death();death();
    assert.equal(h.player.getAttribute(Common.DEATHS_ATTRIBUTE),1);
    assert.equal(session.ended,false,'recording does not interfere with the existing death/gravestone cleanup');
    Site.leave({player:h.player});death();
    assert.equal(h.player.getAttribute(Common.DEATHS_ATTRIBUTE),1,'departure is excluded');
    h.fight.elapsedTicks=100;
    for(const hook of h.hooks.npcDeath)hook({npc:h.boss});
    assert.equal(Number(h.player.getAttribute(Common.KILLS_ATTRIBUTE))||0,0,'non-final death is excluded');
    h.fight.finish();
    for(let repeat=0;repeat<2;repeat++)for(const hook of h.hooks.npcDeath)hook({npc:h.boss});
    assert.equal(h.player.getAttribute(Common.KILLS_ATTRIBUTE),1);
    read();assert.equal(Number(h.strings.get(15).replace(/[^0-9]/g,'')),beforeKills+1,'the world kill also counts once');
    const completed=recordBoard();
    completed.player.moveTo(new core.Location(2656,6371,0));
    completed.player.getInventory().adds(core.ItemIdentifiers.BLACKSTONE_FRAGMENT_2,1);
    Site.disturb({player:completed.player,npc:core.NPC.create(12203,new core.Location(2655,6368,0))});
    Site.sessionOf(completed.player).fight.finish();
    completed.hooks.death[0]({player:completed.player});
    assert.equal(Number(completed.player.getAttribute(Common.DEATHS_ATTRIBUTE))||0,0,'completed fights are excluded');
    Site.leave({player:completed.player});
});

test('Whisperer recorded world totals and best survive a memory-only save reload without historical backfill', t => {
    const filename=require.resolve('../plugins/bosses/whisperer/Records.Whisperer');
    const previous=require.cache[filename];
    let saved=JSON.stringify({kills:7,deaths:3,bestTicks:80}), writes=0;
    const read=fs.readFileSync,write=fs.writeFileSync;
    t.mock.method(fs,'readFileSync',(file,...args)=>typeof file==='string'&&path.resolve(file)===scoreboardFile?saved:read(file,...args));
    t.mock.method(fs,'writeFileSync',(file,value,...args)=>{if(typeof file==='string'&&path.resolve(file)===scoreboardFile){saved=String(value);writes++;return;}return write(file,value,...args);});
    try {
        delete require.cache[filename];
        let records=require(filename);
        const h=recordBoard();h.player.setAttribute(Common.KILLS_ATTRIBUTE,999);
        records.won({elapsedTicks:100});records.won({elapsedTicks:40});records.died(h.player);
        assert.equal(writes,3);
        assert.deepEqual(JSON.parse(saved),{kills:9,deaths:4,bestTicks:40});
        delete require.cache[filename];records=require(filename);
        records.read({player:h.player,objectId:47582});
        assert.equal(h.strings.get(9),'999','existing personal KC remains canonical');
        assert.equal(h.strings.get(15),'9 (recorded)');assert.equal(h.strings.get(17),'4 (recorded)');assert.equal(h.strings.get(19),'0:24.00');
        assert.equal(h.player.getAttribute(Common.DEATHS_ATTRIBUTE),1);
    } finally {delete require.cache[filename];if(previous)require.cache[filename]=previous;}
});

test('Whisperer statistics write failures retain memory totals without interrupting final rewards', t => {
    const h=recordBoard(),messages=[],logs=[];
    const read=()=>h.hooks.objects.get('Scoreboard').Read({player:h.player,objectId:47582});
    read();const beforeKills=Number(h.strings.get(15).replace(/[^0-9]/g,'')),beforeDeaths=Number(h.strings.get(17).replace(/[^0-9]/g,''));
    h.player.sendMessage=message=>messages.push(message);
    h.api.log=(...args)=>logs.push(args);
    require('../plugins/bosses/whisperer/Fight.Whisperer').attach(h.api);
    const write=fs.writeFileSync;
    t.mock.method(fs,'writeFileSync',(file,...args)=>{if(typeof file==='string'&&path.resolve(file)===scoreboardFile)throw new Error('controlled statistics failure');return write(file,...args);});
    h.fight.finish();
    assert.doesNotThrow(()=>{for(const hook of h.hooks.npcDeath)hook({npc:h.boss});});
    assert.ok(messages.some(message=>message.startsWith('Fight duration:')),'completion continues after recording');
    assert.equal(h.player.getAttribute(Common.KILLS_ATTRIBUTE),1);
    assert.equal(h.session.perfectKills,1,'the final reward callback still executes');
    assert.doesNotThrow(()=>require('../plugins/bosses/whisperer/Records.Whisperer').died(h.player));
    assert.equal(h.player.getAttribute(Common.DEATHS_ATTRIBUTE),1);
    read();
    assert.equal(Number(h.strings.get(15).replace(/[^0-9]/g,'')),beforeKills+1);
    assert.equal(Number(h.strings.get(17).replace(/[^0-9]/g,'')),beforeDeaths+1);
    assert.equal(logs.length,2);
});

test('screech snapshots cover at the wave and applies column damage two ticks later', t => {
    const f=fixture(),packets=[],graphics=[];
    const sender=f.player.getPacketSender();
    f.player.getPacketSender=()=>new Proxy(sender,{get:(target,key)=>key==='sendProjectile'?(...args)=>packets.push(args):target[key]});
    t.mock.method(f.boss,'performGraphic',graphic=>graphics.push(graphic));
    startSpecial(f.fight,'screech');
    const special=f.fight.special,column=special.columns.find(c=>c.hp===60),initial=special.columns.map(c=>c.hp);
    f.player.moveTo(new core.Location(column.x,column.y+2,0));
    while(special.age<17)Specials.process(f.fight);
    assert.deepEqual(special.columns.map(c=>c.hp),initial,'the wave has not reached the columns');
    assert.equal(graphics.at(-1).getId(),2470);
    assert.equal(graphics.at(-1).getHeight(),125);
    f.player.moveTo(new core.Location(2656,6379,0));
    Specials.process(f.fight);
    assert.equal(packets.length,1,'the snapshotted cover receives its projectile after one tick');
    const args=packets[0];
    assert.deepEqual([args[3],args[4],args[5],args[6],args[8],args[9],args[10]],[40,2471,100,10,0,127,128]);
    assert.deepEqual([args[1].getX(),args[1].getY()],[column.x,column.y]);
    assert.deepEqual(special.columns.map(c=>c.hp),initial);
    Specials.process(f.fight);f.apply();
    assert.equal(f.player.getHitpoints(),99,'moving after the wave retains the launch cover');
    assert.equal(column.active,false,'a covered column falls regardless of its original health');
    assert.ok(special.columns.every(c=>c.npc.getTickHits().length===1 && c.npc.getTickHits()[0].getDamage()===20),'each column displays the actual screech hit');
    assert.ok(special.columns.some(c=>c.hp!==initial[special.columns.indexOf(c)]));
});

test('entering screech cover after the wave does not evade its delayed ordinary damage', () => {
    const f=fixture();startSpecial(f.fight,'screech');
    const special=f.fight.special,column=special.columns.find(c=>c.hp===60);
    f.player.moveTo(new core.Location(2656,6379,0));
    while(special.age<17)Specials.process(f.fight);
    f.apply();assert.equal(f.player.getHitpoints(),99);
    f.player.moveTo(new core.Location(column.x,column.y+2,0));
    Specials.process(f.fight);f.apply();assert.equal(f.player.getHitpoints(),99);
    Specials.process(f.fight);f.apply();
    assert.equal(f.player.getHitpoints(),54);
    assert.equal(f.fight.sanity,55);
    assert.equal(f.fight.perfectKill,false);
});

test('the third screech remains active through impact and stop cancels unresolved column damage', () => {
    const f=fixture();startSpecial(f.fight,'screech');
    const special=f.fight.special;
    while(special.age<29)Specials.process(f.fight);
    assert.ok(f.fight.special===special,'the third launch does not overwrite its own animation with bind');
    Specials.process(f.fight);assert.ok(f.fight.special===special);
    Specials.process(f.fight);assert.ok(f.fight.special===special,'the damage update remains visible before removal');
    Specials.process(f.fight);assert.equal(f.fight.special,null);
    const cancelled=fixture();startSpecial(cancelled.fight,'screech');
    const old=cancelled.fight.special;
    while(old.age<17)Specials.process(cancelled.fight);
    const health=old.columns.map(c=>c.hp);
    cancelled.fight.stop();
    Specials.process(cancelled.fight);Specials.process(cancelled.fight);cancelled.apply();
    assert.deepEqual(old.columns.map(c=>c.hp),health);
    assert.equal(cancelled.player.getHitpoints(),99);
});

test('native screech water waves fill the source footprint while active columns shelter their two-by-four rectangles', t => {
    t.mock.method(Math,'random',()=>0);
    for(const shadow of [false,true]) {
        const f=fixture(),waves=[];
        const sender=f.player.getPacketSender();
        f.player.getPacketSender=()=>new Proxy(sender,{get:(target,key)=>key==='sendGraphic'?(graphic,location)=>waves.push({graphic,location}):target[key]});
        f.fight.setShadow(shadow);startSpecial(f.fight,'screech');
        f.player.moveTo(new core.Location(shadow?2400:2656,6379,0));
        const counts=[];
        for(const age of [17,23,29]) {
            while(f.fight.special.age<age)Specials.process(f.fight);
            counts.push(waves.length-counts.reduce((sum,n)=>sum+n,0));
        }
        assert.deepEqual(counts,[311,356,364]);
        const offset=shadow?256:0;
        assert.ok(waves.every(({graphic})=>graphic.getId()===2451 && graphic.getHeight()===0));
        for(const {graphic,location} of waves) {
            const distance=Math.abs(location.getX()+offset-2656)+Math.abs(location.getY()-6357);
            assert.equal(graphic.getDelay(),Math.max(5,5+3*(distance-2)));
        }
        assert.ok(waves.some(({graphic})=>graphic.getDelay()===50),'a delay equal to GraphicHeight.MIDDLE stays a delay');
        assert.ok(waves.some(({location})=>location.getX()+offset===2656 && location.getY()===6376));
        const first=waves.slice(0,counts[0]);
        assert.ok(first.every(({location})=>!f.fight.special.columns.some(c=>location.getX()>=c.x && location.getX()<c.x+2 && location.getY()>=c.y && location.getY()<c.y+4)));
        f.fight.stop();
    }
});

test('normal binding selects its observed flight from Chebyshev distance and lands at the matching tick', t => {
    for(const [dx,dy,cycles,impact] of [[3,3,200,7],[4,0,180,6],[0,-4,180,6],[-5,0,170,6],[-8,11,170,6]]) {
        const f=fixture(),packets=[],casts=[];
        f.boss.moveTo(new core.Location(2655,6368,0));
        f.player.moveTo(new core.Location(2656+dx,6369+dy,0));
        const sender=f.player.getPacketSender();
        f.player.getPacketSender=()=>new Proxy(sender,{get:(target,key)=>key==='sendProjectile'?(...args)=>packets.push(args):target[key]});
        t.mock.method(f.boss,'performGraphic',graphic=>casts.push(graphic));
        f.fight.bind();
        assert.equal(packets[0][3],cycles,`initial offset ${dx},${dy}`);
        assert.deepEqual(casts.map(graphic=>[graphic.getId(),graphic.getHeight()]),[[177,120]]);
        for(let tick=1;tick<impact;tick++)f.fight.process();
        assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),false);
        f.fight.process();
        assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),true);
        f.fight.stop();
    }
});

test('a counter before the seventh-tick short-distance bind impact still cancels that impact', t => {
    const f=fixture(),graphics=[];
    f.boss.moveTo(new core.Location(2655,6368,0));
    f.player.moveTo(new core.Location(2659,6372,0));
    t.mock.method(f.player,'performGraphic',graphic=>graphics.push(graphic.getId()));
    f.fight.bind();
    for(let tick=1;tick<=5;tick++)f.fight.process();
    f.boss.setFlag('combat:freezable',true);
    core.CombatFactory.freezeTicks(f.boss,20);
    f.fight.process();f.fight.process();
    assert.equal(f.fight.boundUntil,0);
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),false);
    assert.deepEqual(graphics,[]);
});

test('below one hundred after the third special resumes autos two ticks after cancellation while its bind still lands', t => {
    const f=fixture(),shots=[];
    f.fight.completed=f.fight.startedSpecials=3;
    f.boss.moveTo(new core.Location(2655,6368,0));
    f.player.moveTo(new core.Location(2659,6372,0));
    f.boss.setHitpoints(100);
    const sender=f.player.getPacketSender();
    f.player.getPacketSender=()=>new Proxy(sender,{get:(target,key)=>key==='sendProjectile'?(...args)=>{if(args[4]!==2467)shots.push(f.fight.tick);}:target[key]});
    t.mock.method(f.fight,'impact',()=>{});
    f.fight.bind();f.fight.process();
    assert.equal(f.boss.getNpcTransformationId(),12205,'one hundred is not below the cancellation threshold');
    f.boss.setHitpoints(99);
    f.fight.process();const cancelledAt=f.fight.tick;
    assert.equal(f.boss.getNpcTransformationId(),12204);
    assert.ok(f.fight.boundUntil>f.fight.tick,'the launched bind retains its own deadline');
    f.fight.process();assert.deepEqual(shots,[]);
    f.fight.process();assert.deepEqual(shots,[cancelledAt+2]);
    while(f.fight.tick<7)f.fight.process();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),true);
    f.boss.setFlag('combat:freezable',true);core.CombatFactory.freezeTicks(f.boss,20);
    f.fight.process();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),false,'a real later counter still releases the player');
});

test('melee after low-health pursuit cancellation cannot erase the launched bind projectile', () => {
    const f=fixture();f.fight.completed=f.fight.startedSpecials=3;
    f.boss.moveTo(new core.Location(2655,6368,0));f.player.moveTo(new core.Location(2659,6372,0));
    f.boss.setHitpoints(99);f.fight.bind();f.fight.process();
    f.fight.melee();
    while(f.fight.tick<7)f.fight.process();
    assert.equal(f.player.getTimers().has(core.TimerKey.FREEZE),true);
});


// Capture-review regressions retained alongside the later mechanics tests.


test('normal recording volleys animate each projectile and use fixed flight cycles', t => {
    const f = fixture(), animations = [], projectiles = [], impacts = [];
    t.mock.method(f.boss,'getIndex',()=>5);
    const {PacketSender}=require('../dist/net/packet/PacketSender');
    const sender=new PacketSender(f.player);
    f.player.getSession=()=>({sendClientPacket(packet){projectiles.push(packet);return true;},write(){}});
    f.player.getPacketSender=()=>sender;
    t.mock.method(core.World,'forEachNetworkPlayer',visit=>visit(f.player));
    t.mock.method(f.boss, 'performAnimation', animation => animations.push(animation.getId()));
    t.mock.method(f.fight, 'impact', style => impacts.push(style));
    t.mock.method(Math, 'random', () => 0);
    f.fight.volley();
    assert.deepEqual(animations, []);
    f.fight.process(); f.fight.process(); f.fight.process();
    assert.deepEqual(animations, [10237, 10238, 10237]);

    const packets=projectiles.filter(packet=>packet.length>=31).map(packet=>packet.subarray(packet.length-29));
    assert.equal(packets.length,3);
    for (const entry of packets) {
        assert.deepEqual([entry.readUInt16BE(7),entry.readUInt16BE(14),entry.readUInt16BE(19),entry.readUInt16BE(21)],[350,100,30,90]);
        assert.equal(entry.readUInt16BE(2),2656,'projectiles originate at the 3x3 boss centre');
        assert.equal(entry[23],0,'captured tile projectiles have no source actor');
    }
    assert.deepEqual(impacts, []);
    f.fight.process();
    assert.deepEqual(impacts, ['ranged']);
});

test('Ketla replacement uses her generated conversation and grants the plain fragment at its handout', () => {
    const f = fixture(), variants = [], actions = [], npcHooks = [];
    const api = new Proxy({core,
        emitCustomEvent(name, event) {if(name==='quest:is-complete') event.complete=true;},
        onNpcDialogueVariant(handler) {variants.push(handler);},
        onCustomEvent(name, handler) {if(name==='npc-dialogue:action')actions.push(handler);},
        onNpcInteraction(name, handlers) {npcHooks.push({name,handlers});},
    }, {get:(target,name)=>target[name]??(()=>{})});
    Common.init(api); Site.attach(api);
    assert.ok(!npcHooks.some(h=>h.name==='Ketla'&&h.handlers['Talk-to']));
    const variant=variants.map(fn=>fn({player:f.player,npcId:12232})).find(Boolean);
    assert.equal(variant.variant, 'the-whisperer-talking-to-ketla-with-the-ring-of-visibility-reclaiming-the-blackstone-fragment');
    assert.equal(f.player.getInventory().getAmount(28357),0,'talking does not grant an item immediately');
    const event={player:f.player,npcId:12232,stepId:'5mQjA2',kind:'message'};
    for(const fn of actions)fn(event);
    assert.equal(f.player.getInventory().getAmount(28357),1);
    assert.deepEqual(event.box.items,[28357]);
    for(const fn of actions)fn(event);
    assert.equal(f.player.getInventory().getAmount(28357),1,'duplicate handout delivery cannot duplicate the fragment');
});

test('capture messages accompany special activation, depletion and bind impact', t => {
    const f=fixture(), messages=[],sounds=[],graphics=[];
    f.player.sendMessage=text=>messages.push(text);
    const sender=new Proxy({}, {get:(_,name)=>(...args)=>{if(name==='sendSoundEffect')sounds.push(args[0]);return sender;}});
    f.player.getPacketSender=()=>sender;
    f.player.performGraphic=graphic=>graphics.push(graphic.getId());
    startSpecial(f.fight,'seeds');
    assert.deepEqual(messages,[Common.data.messages.seeds,Common.data.messages.pulse]);
    assert.deepEqual(sounds,[1664]);
    f.fight.special.left=1;
    Specials.process(f.fight);
    assert.ok(messages.includes(Common.data.messages.deplete));
    assert.ok(messages.includes(Common.data.messages.seedsFailed));
    for(let tick=0;tick<7;tick++)f.fight.process();
    assert.ok(messages.includes(Common.data.messages.bind));
    assert.deepEqual(graphics,[2466]);
});

test('named interaction hooks match the cache display forms and leave global hooks unused', () => {
    const hooks=[],items=[];
    const api=new Proxy({core,onObjectInteraction(name,actions){hooks.push({name,actions});},onItemAction(name,actions){items.push({name,actions});},
        onBeforeObjectInteraction(handler){assert.equal(handler.name,'parentRead','only unnamed scoreboard parents need a fallback');}}, {get:(o,key)=>o[key]??(()=>{})});
    Common.init(api);Site.attach(api);
    for(const [id,name,action] of [[48197,'Rock','Climb-rope'],[48198,'Rope','Climb-up'],[48201,'Teleporter','Activate'],[48202,'Teleporter','Use']]) {
        const definition=core.CacheDefinitions.getObject(id);
        assert.equal(definition.name,name);
        assert.ok(definition.actions.includes(action));
        assert.equal(typeof hooks.find(h=>h.name===name).actions[action],'function');
    }
    assert.deepEqual(items.map(h=>h.name),['Blackstone fragment']);
});

test('leaving during the intro cancels flyback and the delayed boss spawn', t => {
    const f=fixture(),tasks=[];
    t.mock.method(core.TaskManager,'submit',task=>tasks.push(task));
    Common.init({core,emitCustomEvent(){},spawnNpc({id,x,y}){return f.session.spawn(id,x,y);},removeNpc(){}});
    const session=new Site.Session(f.player);
    session.area.enter(f.player);session.begin();
    session.end();f.player.moveTo(Common.location(Common.data.site.outside));
    for(const task of tasks)task.execute();
    assert.equal(session.fight,null);
    assert.equal(f.player.getLocation().getY(),6386);
});

test('melee recovery retains launched volley impacts and removes future shots; exit cancels all', t => {
    const f=fixture(),impacts=[];
    t.mock.method(f.fight,'impact',style=>impacts.push([f.fight.tick,style]));
    t.mock.method(Common,'damage',()=>{});
    f.fight.volley();
    f.fight.process();
    assert.equal(f.fight.events.filter(event=>event.launched).length,1);
    f.fight.melee();
    for(let tick=0;tick<3;tick++)f.fight.process();
    assert.equal(impacts.length,1,'the launched shot lands at its original tick');
    assert.equal(impacts[0][0],4);
    const g=fixture();
    t.mock.method(g.fight,'impact',()=>assert.fail('a stopped encounter cannot deliver its queued shot'));
    g.fight.volley();g.fight.process();g.fight.stop();
    for(let tick=0;tick<5;tick++)g.fight.process();
    assert.equal(g.fight.events.length,0);
});
