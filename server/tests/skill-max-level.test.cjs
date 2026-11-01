// Run after `yarn build`: node --test tests/skill-max-level.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");

const sender = new Proxy({}, { get: (_, name) => (name === "then" ? undefined : () => sender) });
const skills = new SkillManager({ getPacketSender: () => sender });

test("lowering a skill takes effect on the first call (issue #101)", () => {
  for (const level of [99, 1]) {
    skills
      .setCurrentLevels(Skill.ATTACK, level)
      .setMaxLevel(Skill.ATTACK, level)
      .setExperience(Skill.ATTACK, SkillManager.getExperienceForLevel(level));
    assert.equal(skills.getMaxLevel(Skill.ATTACK), level);
  }
});

test("rate 1 keeps OSRS's tenths of experience instead of flooring each gain away (issue #748)", () => {
  const xp = new SkillManager({ getPacketSender: () => sender, getAttribute: () => undefined });
  xp.setExperience(Skill.WOODCUTTING, 0);
  for (let log = 0; log < 2; log++) xp.addExperience(Skill.WOODCUTTING, 37.5, true);
  assert.equal(xp.getExperience(Skill.WOODCUTTING), 75, "two oak logs");
  xp.setExperience(Skill.HITPOINTS, 1154);
  for (let hit = 0; hit < 10; hit++) xp.addExperience(Skill.HITPOINTS, 4 / 3, true);
  assert.equal(xp.skills.experience[Skill.HITPOINTS.getIndex()], 1167, "ten 1-damage hits are 1.3 each, as OSRS");
  assert.equal(xp.getExperience(Skill.HITPOINTS), 1167);
});

test("Hunter cache data, trap ownership, transactions, cancellation and persisted birdhouses", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi(), I = core.ItemIdentifiers;
  const C = require("../plugins/skills/hunter/Context.Hunter"), { H } = C;
  const Traps = require("../plugins/skills/hunter/Traps.Hunter");
  const Houses = require("../plugins/skills/hunter/Birdhouses.Hunter");
  const Tracking = require("../plugins/skills/hunter/Tracking.Hunter");
  const Catching = require("../plugins/skills/hunter/Catching.Hunter");
  const Runtime = require("../plugins/skills/hunter/Runtime.Hunter");
  const originalChoose = C.choose;
  let startup;
  const hooks = [];
  const api = new Proxy({ core, emitCustomEvent() {}, spawnNpc() { return null; }, onServerStartup(handler) { startup = handler; } }, {
    get(target, name) { return target[name] ?? ((...args) => hooks.push([name, ...args])); },
  });
  require("../plugins/skills/Hunter.plugin").register(api);
  startup();
  assert.equal(H.data.creatures.length, 27);
  assert.equal(H.data.implings.length, 12);
  assert.equal(Houses.bases.size, 4);
  assert.ok(hooks.some(hook => hook[0] === "onNpcRoute"));
  for (const rows of Object.values(require("../plugins/skills/data/impling-loot.json"))) {
    for (const [name, weight, min, max, noted] of rows) {
      assert.ok(name === null || Number.isInteger(I[name]), name);
      assert.ok(weight > 0 && min > 0 && max >= min, name);
      if (noted && name !== null) assert.ok(core.ItemDefinition.forId(I[name]).getNoteId() > 0, name);
    }
  }
  for (const def of Object.values(Tracking.data.creatures)) for (const name of def.loot) assert.ok(name === null || Number.isInteger(I[name]), name);

  function player() {
    const counts = new Map(), attrs = new Map(), levels = new Map(), baseLevels = new Map(), experience = new Map(), configs = new Map(), equipment = new Map();
    let location = new core.Location(3000, 3000, 0), size = 28, area = null, force = null;
    const banks = Array.from({length:core.Bank.TOTAL_BANK_TABS},()=>{const items=new Map();return {items,capacity:()=>352,getFreeSlots:()=>352-items.size,getItems:()=>[...items].map(([id,n])=>new core.Item(id,n)),contains:id=>items.has(id),getAmount:id=>items.get(id)??0,adds:(id,n)=>items.set(id,(items.get(id)??0)+n)};});
    const slots = () => [...counts].reduce((total, [id, n]) => total + (core.ItemDefinition.forId(id).isStackable() ? 1 : n), 0);
    const inv = {
      capacity: () => size, getFreeSlots: () => size - slots(), full() {},
      getItems: () => [...counts].map(([id, amount]) => new core.Item(id, amount)),
      get: slot => [...counts].map(([id, amount]) => new core.Item(id, amount))[slot],
      getAmount: id => counts.get(id) ?? 0, contains: id => (counts.get(id) ?? 0) > 0,
      adds(id, n) { counts.set(id, (counts.get(id) ?? 0) + n); },
      deleteNumber(id, n) { const next = (counts.get(id) ?? 0) - n; if (next > 0) counts.set(id, next); else counts.delete(id); },
    };
    const messages = [];
    const skillManager = {
      getCurrentLevel: s => levels.get(s) ?? 99, getMaxLevel: s => baseLevels.get(s) ?? 99, stopSkillable() {},
      setCurrentLevels: (s, n) => levels.set(s, n),
      addExperiences: (s, n) => experience.set(s, (experience.get(s) ?? 0) + n),
    };
    return {
      counts, attrs, levels, baseLevels, experience, configs, equipment, banks, setSize(n) { size = n; },
      isRegistered: () => true, getHitpoints: () => 99, busy: () => false, getUsername: () => "hunter-test",
      getInventory: () => inv, getSkillManager: () => skillManager,
      getBank: (tab = 0) => banks[tab], getCurrentBankTab: () => 0,
      getEquipment: () => ({ getItems: () => [...equipment].map(([slot,id])=>new core.Item(id,1)), get: slot => new core.Item(equipment.get(slot)??-1,1),set(slot,item){equipment.set(slot,item.getId());},refreshItems(){} }),
      getPrivateArea: () => area, setArea(a) {area=a;}, getWildernessLevel: () => 0,
      getLocation: () => location, moveTo(p) { location = p; },
      getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
      getPacketSender: () => ({ sendConfig: (id, value) => configs.set(id, value), sendVarbit: (id,value) => configs.set(id,value), sendProjectile() {}, sendGraphic() {}, sendSound() {},
        sendTypedMessage: (type, text) => messages.push(text), sendClientScript() {}, sendObjectAnimation() {} }),
      getCombat: () => ({ getTarget: () => null, getAttacker: () => null, getHitQueue: () => ({ addPendingDamage() {} }) }),
      getPrayerActive: () => ({}),
      getMovementQueue: () => ({ canWalk: () => false, reset() {} }),
      getForceMovement: () => force, setForceMovement(f) {force=f;}, getUpdateFlag: () => ({flag(){}}), getRunEnergy: () => 50, setRunEnergy() {},
      performAnimation(a) { this.animations.push(a.getId()); }, sendMessage(text) { this.messages.push(text); },
      animations: [], messages, statements: [],
      getDialogueManager() { const statements = this.statements; return { startDialogues(chain) { statements.push(chain); } }; },
    };
  }
  const p = player(), stranger = player();
  const objects = new Set(), drops = [], grounds = [];
  let npcs = [];
  H.core = { ...core,
    ObjectManager: { register(o) { objects.add(o); }, deregister(o) { objects.delete(o); } },
    MapObjects: { exists: o => objects.has(o), getType: () => null },
    RegionManager: { blocked: () => false },
    ItemOnGroundManager: {
      registerLocation(...args) {
        drops.push(args);
        const ground = { removed: false, getItem: () => args[1], isPendingRemoval() { return this.removed; } };
        grounds.push(ground); return ground;
      },
      deregister(ground) { ground.removed = true; },
    },
    World: { getRemovedObjects: () => [], getNearbyNpcsForUpdate: () => npcs },
    PathFinder: { calculateWalkRoute(npc, x, y) { npc.moveTo(new core.Location(x, y, npc.getLocation().getZ())); } },
  };
  const advance = ticks => { for (let i = 0; i < ticks; i++) Runtime.tick(); };
  const random = Math.random;
  Math.random = () => 0;
  try {
    p.counts.set(I.BOX_TRAP, 1);
    p.setSize(1);
    assert.equal(C.exchange(p, [[I.BOX_TRAP, 1]], [[I.BONES, 1], [I.RAW_BIRD_MEAT, 1]]), false);
    assert.equal(p.counts.get(I.BOX_TRAP), 1, "failed exchange preserves materials");
    assert.equal(C.exchange(p, [[I.BOX_TRAP, 1]], [[I.CHINCHOMPA_2, 100]]), true, "stack uses freed slot");
    p.counts.clear(); p.setSize(28); p.counts.set(I.BIRD_SNARE, 1);
    Traps.activate({ player: p, itemId: I.BIRD_SNARE });
    p.moveTo(new core.Location(3001, 3000, 0)); advance(3);
    // The snare goes on the floor as the lay starts (rsprox captures); walking off leaves it there.
    assert.equal(H.traps.size, 0, "moving cancels the lay");
    assert.equal(p.counts.has(I.BIRD_SNARE), false); assert.equal(grounds.at(-1).getItem().getId(), I.BIRD_SNARE);
    assert.equal(p.messages.at(-1), "You begin setting up the trap.");
    p.counts.set(I.BIRD_SNARE, 1);
    Traps.activate({ player: p, itemId: I.BIRD_SNARE }); advance(3);
    const trap = [...H.traps][0]; assert.ok(trap); assert.equal(p.counts.has(I.BIRD_SNARE), false);
    assert.equal(Traps.limit(p, "box"), 5);
    assert.equal(Traps.limit({ ...p, getWildernessLevel: () => 10 }, "box"), 6);
    assert.equal(Traps.limit(p, "deadfall"), 2);
    p.levels.set(Skill.HUNTER, 19); assert.equal(Traps.limit(p, "bird"), 1);
    p.levels.set(Skill.HUNTER, 20); assert.equal(Traps.limit(p, "bird"), 2, "temporary boosts unlock the next trap");
    p.levels.delete(Skill.HUNTER);
    let npcLocation = trap.location.clone(), visible = true, blocked = false;
    const npc = {
      getId: () => core.NpcIdentifiers.CRIMSON_SWIFT, getPrivateArea: () => null, isRegistered: () => true,
      isVisible: () => visible, setVisible(v) { visible = v; }, isDyingFunction: () => false, getHitpoints: () => 1,
      getLocation: () => npcLocation, moveTo(p) { npcLocation = p; }, getSpawnPosition: () => trap.location.clone(),
      getMovementQueue: () => ({ reset() {}, isMovementBlocked: () => blocked, setBlockMovement(v) { blocked = v; } }),
      getCombat: () => ({ getTarget: () => null, getAttacker: () => null, reset() {} }),
    };
    p.moveTo(trap.location.clone().add(1, 0)); npcs = [npc]; advance(6);
    assert.equal(trap.state, "closing", "the trapping loc shows for two ticks");
    advance(2);
    assert.equal(trap.state, "caught"); assert.equal(visible, false);
    const object = trap.objects[0];
    Traps.check({ player: stranger, object }); advance(2);
    assert.equal(H.traps.size, 1, "only owner can collect");
    p.setSize(1); Traps.check({ player: p, object }); advance(2);
    assert.equal(H.traps.size, 1, "full inventory preserves catch");
    p.setSize(28); Traps.check({ player: p, object }); advance(2);
    assert.equal(H.traps.size, 0); assert.equal(p.counts.get(I.BIRD_SNARE), 1);
    assert.equal(p.experience.get(Skill.HUNTER), 34);
    assert.deepEqual(p.messages.slice(-2), ["You dismantle the trap.", "You've caught a crimson swift."]);
    Traps.check({ player: p, object }); advance(4);
    assert.equal(p.experience.get(Skill.HUNTER), 34, "stale clicks cannot duplicate XP");
    assert.equal(visible, true, "caught NPC respawns");
    p.counts.set(I.BIRD_SNARE, 2);
    Traps.activate({ player: p, itemId: I.BIRD_SNARE }); advance(3); npcs = []; advance(100);
    assert.equal(H.traps.size, 0); assert.equal(drops.at(-1)[1].getId(), I.BIRD_SNARE);

    // Box traps accept spicy tomato/minced meat, deadfalls a jerboa tail; both return on dismantle.
    p.counts.clear(); p.counts.set(I.BOX_TRAP, 1); p.counts.set(I.SPICY_TOMATO, 1); p.counts.set(I.SPICY_MINCED_MEAT, 1);
    Traps.activate({ player: p, itemId: I.BOX_TRAP }); advance(3);
    assert.equal(H.traps.size, 0, "box traps wait for Nickolaus's lesson in Eagles' Peak");
    p.attrs.set("quest.eagles_peak.stage", 6);
    Traps.activate({ player: p, itemId: I.BOX_TRAP }); advance(3);
    const boxTrap = [...H.traps][0]; assert.ok(boxTrap);
    Traps.bait({ player: p, object: boxTrap.objects[0], itemId: I.RAW_BEEF });
    assert.equal(boxTrap.bait, null, "box traps reject bait outside tomato/minced meat");
    Traps.bait({ player: p, object: boxTrap.objects[0], itemId: I.SPICY_TOMATO });
    assert.equal(boxTrap.bait.baits[core.NpcIdentifiers.CHINCHOMPA], I.SPICY_TOMATO);
    assert.equal(p.counts.has(I.SPICY_TOMATO), false);
    Traps.dismantle({ player: p, object: boxTrap.objects[0] }); advance(2);
    assert.equal(p.counts.get(I.SPICY_TOMATO), 1, "box bait returns on dismantle");
    p.counts.clear(); p.counts.set(I.LOGS, 1); p.counts.set(I.KNIFE, 1); p.counts.set(I.JERBOA_TAIL, 1);
    Traps.lay(p, "deadfall", p.getLocation()); advance(3);
    const deadfall = [...H.traps][0]; assert.ok(deadfall);
    Traps.bait({ player: p, object: deadfall.objects[0], itemId: I.SPICY_TOMATO });
    assert.equal(deadfall.bait, null, "deadfalls reject box bait");
    Traps.bait({ player: p, object: deadfall.objects[0], itemId: I.JERBOA_TAIL });
    assert.equal(deadfall.bait.baits[core.NpcIdentifiers.PYRE_FOX], I.JERBOA_TAIL);
    Traps.dismantle({ player: p, object: deadfall.objects[0] }); advance(2);
    assert.equal(p.counts.get(I.JERBOA_TAIL), 1, "deadfall bait returns on dismantle");
    p.counts.clear(); Math.random = () => 0;

    const [baseId] = Houses.bases.keys(), houseObject = new core.GameObject(baseId, p.getLocation().clone(), 10, 0, null);
    const varp = () => p.configs.get(Houses.bases.get(baseId).transformVarp);
    const statementText = () => [...p.statements.at(-1).dialogues.values()].map(d => d.text).join("\n");
    p.counts.set(I.BIRD_HOUSE, 1); p.counts.set(I.HAMMERSTONE_SEED, 10);
    Houses.use({ player: p, object: houseObject, objectId: baseId, itemId: I.BIRD_HOUSE });
    assert.equal(p.counts.has(I.BIRD_HOUSE), false, "a carried birdhouse is placed on the arrival tick");
    assert.equal(varp(), 1); assert.equal(p.animations.at(-1), 827, "human_pickupfloor");
    // Seeds only reports the seed level (captures 545, 1863, 1875).
    Houses.seeds({ player: p, object: houseObject });
    assert.equal(p.counts.get(I.HAMMERSTONE_SEED), 10, "Seeds does not take seeds");
    assert.match(statementText(), /seed level is: 0\/10/);
    Houses.use({ player: p, object: houseObject, objectId: baseId, itemId: I.HAMMERSTONE_SEED });
    const state = p.attrs.get(Houses.ATTRIBUTE)[baseId];
    assert.equal(state.seeds, 10); assert.equal(p.counts.has(I.HAMMERSTONE_SEED), false);
    assert.equal(Houses.status(state), 2); assert.equal(varp(), 3, "full of seed shows the Empty/Reset variant at once (varp 22->24 live)");
    assert.match(statementText(), /now full of seed and will start to catch birds/);
    Houses.seeds({ player: p, object: houseObject });
    assert.match(statementText(), /set and consuming seed\. Seed level is: 10\/10/);
    state.filled = Date.now() - Houses.DURATION * 0.75;
    assert.equal(Houses.seedLevel(state), 3, "a seed per bird, a bird per tenth of the wait");
    state.filled = Date.now();
    Houses.empty({ player: p, object: houseObject }); advance(2);
    assert.equal(p.attrs.get(Houses.ATTRIBUTE)[baseId], state, "timer cannot be bypassed");
    state.filled = Date.now() - Houses.DURATION;
    const restored = JSON.parse(JSON.stringify(p.attrs.get(Houses.ATTRIBUTE)));
    p.attrs.set(Houses.ATTRIBUTE, restored); Houses.login({ player: p });
    assert.equal(varp(), 3);
    const beforeXp = p.experience.get(Skill.HUNTER), dropsBefore = drops.length;
    Houses.empty({ player: p, object: houseObject });
    assert.equal(p.counts.has(I.CLOCKWORK), false, "the empty lands a tick after arrival");
    advance(1);
    assert.equal(p.experience.get(Skill.HUNTER) - beforeXp, 112);
    assert.equal(p.counts.get(I.CLOCKWORK), 1);
    assert.equal(p.counts.has(I.RAW_BIRD_MEAT), false, "raw bird meat never goes to the inventory");
    const meat = drops.slice(dropsBefore).filter(args => args[1].getId() === I.RAW_BIRD_MEAT);
    assert.equal(meat.length, 10, "ten raw bird meat on the floor");
    assert.ok([30, 40, 50, 60].includes(p.counts.get(I.FEATHER)));
    assert.equal(varp(), 0);
    assert.match(p.messages.at(-1), /^You dismantle and discard the trap, retrieving (a nest|\d+ nests), 10 dead birds, \d0 feathers and 112 Hunter XP\.$/);
    Houses.empty({ player: p, object: houseObject }); advance(2);
    assert.equal(p.counts.get(I.CLOCKWORK), 1, "birdhouse loot only collected once");
    // Feathers are always 30, 40, 50 or 60 (Wiki); the old roll gave anything from 30 to 100.
    const feathers = new Set();
    for (const r of [0, 0.3, 0.6, 0.99]) { Math.random = () => r; feathers.add(Houses.loot(p, { tier: 0 }).find(([id]) => id === I.FEATHER)[1]); }
    Math.random = () => 0;
    assert.deepEqual([...feathers].sort((a, b) => a - b), [30, 40, 50, 60]);
    // Wiki Bird house trapping/Seeds: these take ten to fill; only herb seeds from ranarr up and wildblood take five.
    for (const seed of [I.WATERMELON_SEED, I.SNAPE_GRASS_SEED, I.WHITEBERRY_SEED, I.POISON_IVY_SEED, I.WHITE_LILY_SEED, I.BARLEY_SEED])
      assert.equal(Houses.seedValue(seed), 1, core.ItemDefinition.forId(seed).getName());
    for (const seed of [I.RANARR_SEED, I.TORSTOL_SEED, I.WILDBLOOD_SEED]) assert.equal(Houses.seedValue(seed), 2);
    // Reset without logs still empties, then fails two ticks later (recording 716).
    p.counts.clear(); p.messages.length = 0;
    p.attrs.get(Houses.ATTRIBUTE)[baseId] = { tier: 0, seeds: 10, filled: Date.now() - Houses.DURATION };
    Houses.reset({ player: p, object: houseObject }); advance(1);
    assert.equal(p.counts.get(I.CLOCKWORK), 1, "reset empties before checking for logs");
    advance(2);
    assert.equal(p.messages.at(-1), "You need logs to make a birdhouse.");
    assert.equal(p.attrs.get(Houses.ATTRIBUTE)[baseId], undefined);
    p.counts.clear(); p.counts.set(I.CLOCKWORK, 1);
    p.attrs.get(Houses.ATTRIBUTE)[baseId] = { tier: 0, seeds: 10, filled: Date.now() - Houses.DURATION };
    p.counts.set(I.LOGS, 1); p.counts.set(I.HAMMER, 1); p.counts.set(I.CHISEL, 1);
    Houses.reset({ player: p, object: houseObject }); advance(4);
    assert.equal(p.attrs.get(Houses.ATTRIBUTE)[baseId].seeds, 0, "reset rebuilds an unseeded birdhouse");
    assert.equal(p.counts.get(I.CLOCKWORK), 1, "reset reuses clockwork without creating another");
    assert.equal(p.counts.has(I.LOGS), false);
    assert.equal(p.experience.get(Skill.CRAFTING), 15);
    // Build on an empty space with no birdhouse makes one from logs: crafted two ticks in, placed a tick later.
    delete p.attrs.get(Houses.ATTRIBUTE)[baseId]; p.counts.clear();
    p.counts.set(I.CLOCKWORK, 1); p.counts.set(I.LOGS, 1); p.counts.set(I.HAMMER, 1); p.counts.set(I.CHISEL, 1);
    Houses.build({ player: p, object: houseObject });
    assert.equal(p.animations.at(-1), 7057, "birdhouse_make");
    advance(2);
    assert.equal(p.counts.get(I.BIRD_HOUSE), 1); assert.equal(p.experience.get(Skill.CRAFTING), 30);
    advance(1);
    assert.equal(p.counts.has(I.BIRD_HOUSE), false); assert.equal(varp(), 1);
    delete p.attrs.get(Houses.ATTRIBUTE)[baseId]; p.counts.clear(); p.counts.set(I.REDWOOD_BIRD_HOUSE, 1);
    p.levels.set(Skill.HUNTER, 10);
    Houses.build({ player: p, object: houseObject });
    assert.equal(p.messages.at(-1), "You do not have a birdhouse with the required hunter level to build here.");
    assert.equal(p.counts.get(I.REDWOOD_BIRD_HOUSE), 1);
    p.levels.delete(Skill.HUNTER);
    p.counts.clear(); p.counts.set(I.SNOWY_KNIGHT, 1); p.levels.set(Skill.HITPOINTS, 50);
    Catching.release({ player: p, itemId: I.SNOWY_KNIGHT });
    assert.equal(p.levels.get(Skill.HITPOINTS), 58); assert.equal(p.counts.get(I.BUTTERFLY_JAR), 1);
    p.counts.set(I.LUCKY_IMPLING_JAR, 1);
    Catching.loot({ player: p, itemId: I.LUCKY_IMPLING_JAR });
    assert.equal(p.counts.has(I.LUCKY_IMPLING_JAR), false, "Lucky jars produce a clue-table reward without another plugin");
    const Crabs = require("../plugins/skills/hunter/Crabs.Hunter"), Drift = require("../plugins/skills/hunter/DriftNets.Hunter");
    const Herbi = require("../plugins/skills/hunter/Herbiboar.Hunter"), Dungeon = require("../plugins/skills/hunter/Dungeon.Hunter");
    const Broavs = require("../plugins/skills/hunter/Broavs.Hunter"), Rumours = require("../plugins/skills/hunter/Rumours.Hunter");
    const Rabbits = require("../plugins/skills/hunter/Rabbits.Hunter"), Aerial = require("../plugins/skills/hunter/Aerial.Hunter");
    const Pitfalls = require("../plugins/skills/hunter/Pitfalls.Hunter");
    const successEvents=[];
    api.emitCustomEvent=(name,event)=>{if(name==='hunter:success'){successEvents.push(event);Rumours.success(event);}};
    const spawned=[];
    function prey(id,location,privateArea=null) {
      let visible=true,registered=true,blocked=false,where=location.clone(),area=privateArea;
      const animations=[];
      return {animations,getId:()=>id,getDefinition:()=>core.NpcDefinition.forId(id),getPrivateArea:()=>area,setArea(a){area=a;},
        isRegistered:()=>registered,unregister(){registered=false;},isVisible:()=>visible,setVisible(v){visible=v;},
        isDyingFunction:()=>false,getHitpoints:()=>1,getLocation:()=>where,moveTo(l){where=l;},getSpawnPosition:()=>location.clone(),
        performAnimation(a){animations.push(a);},getMovementQueue:()=>({reset(){},isMovementBlocked:()=>blocked,setBlockMovement(v){blocked=v;}}),
        getCombat:()=>({getTarget:()=>null,getAttacker:()=>null,reset(){}})};
    }
    api.spawnNpc=opts=>{const n=prey(opts.id,new core.Location(opts.x,opts.y,opts.z??0));spawned.push(n);return n;};
    api.removeNpc=n=>n.unregister();
    C.choose=(player,options)=>{player.options=options;};
    const q=player();
    assert.equal(C.probability(100,420,1),101/256);
    q.levels.set(Skill.HUNTER,0);
    assert.equal(C.chance(q,H.data.creatures[0]),false,"a drained level cannot use the base level to catch");
    q.levels.clear();
    for(const tables of [require("../plugins/skills/data/lucky-loot.json"),require("../plugins/skills/data/sack-loot.json")])
      for(const rows of Object.values(tables))for(const [name,weight,min,max,noted]of rows){
        assert.ok(Number.isInteger(I[name]),name);assert.ok(weight>0&&min>0&&max>=min,name);
        if(noted)assert.ok(core.ItemDefinition.forId(I[name]).getNoteId()>0,name);
      }
    for(const task of Rumours.tasks)assert.ok(Number.isInteger(I[task.part]),task.part);
    assert.equal(Crabs.bases.size,20);assert.equal(Drift.bases.size,2);

    // Moths use their published distinct net/barehand curves, with current levels on tick two.
    q.levels.set(Skill.HUNTER,75);q.equipment.set(core.Equipment.WEAPON_SLOT,I.MAGIC_BUTTERFLY_NET);
    q.counts.set(I.BUTTERFLY_JAR,1);
    const moth=prey(core.NpcIdentifiers.MOONLIGHT_MOTH,q.getLocation());
    Math.random=()=>0.85;
    Catching.catchNpc({player:q,npc:moth,npcId:moth.getId()});advance(2);
    assert.equal(q.counts.get(I.MOONLIGHT_MOTH_2),1,"magic net uses the improved moonlight-moth curve");
    assert.equal(moth.isVisible(),true,"butterflies remain available to other hunters");
    q.counts.set(I.BUTTERFLY_JAR,1);q.levels.set(Skill.HUNTER,75);
    Catching.catchNpc({player:q,npc:moth,npcId:moth.getId()});q.levels.set(Skill.HUNTER,74);advance(2);
    assert.equal(q.counts.get(I.BUTTERFLY_JAR),1,"level drain during the catch preserves the jar");
    q.levels.clear();q.equipment.clear();q.counts.clear();Math.random=()=>0.5;

    // Implings (rsprox captures 1342/1389/1510/2520 + Leagues; Wiki Implings): the catch lands on the
    // click's tick with live messages, sound 2623 and the caught animation; Puro-Puro spawns return in 7/50.
    const N=core.NpcIdentifiers,said=[],sounds=[],grabs=[];
    const iq=player(),packets=iq.getPacketSender();
    iq.sendMessage=m=>said.push(m);iq.getPacketSender=()=>({...packets,sendSound:id=>sounds.push(id)});
    iq.performAnimation=a=>grabs.push(a.getId());
    const puroTile=new core.Location(2567,4320,0),outsideTile=new core.Location(3000,3000,0);
    iq.moveTo(puroTile);iq.equipment.set(core.Equipment.WEAPON_SLOT,I.BUTTERFLY_NET);iq.counts.set(I.IMPLING_JAR,2);
    Math.random=()=>0;
    const baby=prey(N.BABY_IMPLING_2,puroTile.clone());
    Catching.catchNpc({player:iq,npc:baby,npcId:baby.getId()});
    assert.equal(iq.counts.get(I.BABY_IMPLING_JAR),1,"the jar is filled on the click's tick, not two ticks later");
    assert.equal(iq.counts.get(I.IMPLING_JAR),1);
    assert.deepEqual(said,["You manage to catch the impling and squeeze it into a jar."]);
    assert.deepEqual(sounds,[2623]);assert.deepEqual(grabs,[6606]);
    assert.equal(iq.experience.get(Skill.HUNTER),18,"Puro-Puro XP");
    assert.deepEqual(baby.animations.map(a=>a.getId()),[6615]);
    assert.equal(baby.isVisible(),true,"the caught impling stays for its animation");
    advance(2);assert.equal(baby.isVisible(),false,"and is gone two ticks after the catch");
    advance(6);assert.equal(baby.isVisible(),false);
    advance(1);assert.equal(baby.isVisible(),true,"a Puro-Puro baby impling returns 7 ticks after it is removed");
    const earth=prey(N.EARTH_IMPLING_2,puroTile.clone());
    Catching.catchNpc({player:iq,npc:earth,npcId:earth.getId()});
    assert.equal(iq.counts.get(I.EARTH_IMPLING_JAR),1);
    advance(51);assert.equal(earth.isVisible(),false);
    advance(1);assert.equal(earth.isVisible(),true,"earth and essence implings return after 50 ticks");
    said.length=0;
    Catching.catchNpc({player:iq,npc:baby,npcId:baby.getId()});
    assert.deepEqual(said,["You don't have an empty impling jar in which to keep an impling."]);
    iq.equipment.clear();iq.counts.set(I.IMPLING_JAR,1);iq.levels.set(Skill.HUNTER,45);said.length=0;
    Catching.catchNpc({player:iq,npc:earth,npcId:earth.getId()});
    assert.deepEqual(said,["You need a Hunter level of at least 46 to catch this impling barehanded."]);
    iq.equipment.set(core.Equipment.WEAPON_SLOT,I.BUTTERFLY_NET);iq.levels.set(Skill.HUNTER,35);said.length=0;
    Catching.catchNpc({player:iq,npc:earth,npcId:earth.getId()});
    assert.deepEqual(said,["You need a Hunter level of at least 36 to catch this impling."]);
    assert.equal(iq.counts.get(I.IMPLING_JAR),1,"a refused catch keeps the jar");
    iq.equipment.clear();iq.levels.delete(Skill.HUNTER);iq.counts.clear();iq.moveTo(outsideTile);
    iq.setSize(0);said.length=0;
    const wild=prey(N.EARTH_IMPLING,outsideTile.clone());
    Catching.catchNpc({player:iq,npc:wild,npcId:wild.getId()});
    assert.deepEqual(said,["You'll need to clear some space in your pack to catch this impling without a jar."]);
    iq.setSize(28);said.length=0;grabs.length=0;iq.experience.clear();
    Catching.catchNpc({player:iq,npc:wild,npcId:wild.getId()});
    assert.deepEqual(said,["You manage to catch the impling and acquire some loot."]);
    assert.deepEqual(grabs,[7171],"barehanded catches play hunting_impling_catch");
    assert.ok(iq.counts.size>0,"barehanded loot arrives on the same tick");
    assert.equal(iq.experience.get(Skill.HUNTER),27,"Gielinor XP");
    advance(102);

    const crabId=[...Crabs.bases].find(([id])=>Crabs.species(new core.GameObject(id,q.getLocation(),10,0,null)).level===21)[0];
    const crabObject=new core.GameObject(crabId,q.getLocation().clone(),10,0,null);
    for(const[id,n]of[[I.PLANK,1],[I.BUCKET,1],[I.STEEL_NAILS,2],[I.HAMMER,1],[I.SAW,1]])q.counts.set(id,n);
    Crabs.build({player:q,object:crabObject});q.levels.set(Skill.CONSTRUCTION,9);advance(4);
    assert.equal(q.counts.get(I.PLANK),1,"drained Construction cancels without spending building materials");
    q.levels.delete(Skill.CONSTRUCTION);Crabs.build({player:q,object:crabObject});advance(4);
    assert.equal(q.experience.get(Skill.CONSTRUCTION),30);
    q.counts.set(I.FISH_OFFCUTS,2);Crabs.bait({player:q,object:crabObject});advance(16);
    assert.equal(Crabs.states(q)[crabId].value,3);
    q.setSize(0);Crabs.empty({player:q,object:crabObject});advance(1);
    assert.equal(Crabs.states(q)[crabId].value,3,"full inventory preserves a caught crab");
    q.setSize(28);Crabs.empty({player:q,object:crabObject});advance(1);
    assert.equal(q.counts.get(I.RED_CRAB_2),1);assert.equal(q.experience.get(Skill.HUNTER),84+64);
    advance(3);assert.equal(Crabs.states(q)[crabId].value,2,"harvest automatically rebaits");
    advance(15);q.moveTo(new core.Location(3100,3100));advance(1);
    assert.equal(Crabs.states(q)[crabId].value,1,"leaving resets caught traps as well as baited traps");

    q.counts.clear();q.equipment.set(core.Equipment.WEAPON_SLOT,I.BUTTERFLY_NET);
    const bat=prey(core.NpcIdentifiers.PSYKK_BAT,q.getLocation());
    Dungeon.catchBat({player:q,npc:bat,npcId:bat.getId()});q.levels.set(Skill.HUNTER,89);advance(2);
    assert.equal(q.counts.has(I.RAW_PSYKK_BAT_6_),false);
    q.levels.clear();Dungeon.catchBat({player:q,npc:bat,npcId:bat.getId()});advance(2);
    assert.equal(q.counts.get(I.RAW_PSYKK_BAT_6_),1);q.equipment.clear();
    const rock=new core.GameObject(core.ObjectIdentifiers.ROCK_167,q.getLocation().clone(),10,0,null);
    const bush=new core.GameObject(core.ObjectIdentifiers.BUSH_63,q.getLocation().clone().add(1,0),10,0,null);
    q.counts.set(I.ROPE,1);Dungeon.rock({player:q,object:rock});advance(2);
    Dungeon.rustle({player:q,object:bush});advance(3);
    assert.equal(q.counts.get(I.ROPE),1);assert.equal(q.counts.get(I.RAW_MOSS_LIZARD),1);
    const mossXp=q.experience.get(Skill.HUNTER);Dungeon.rustle({player:q,object:bush});advance(3);
    assert.equal(q.experience.get(Skill.HUNTER),mossXp,"a lizard trap pays out once");

    q.counts.clear();q.moveTo(new core.Location(2324,3532));q.counts.set(I.RABBIT_SNARE,1);q.counts.set(I.FERRET,1);
    Traps.activate({player:q,itemId:I.RABBIT_SNARE});advance(3);
    const snare=[...H.traps].find(t=>t.player===q);
    q.moveTo(new core.Location(2323,3533));const hole=new core.GameObject(core.ObjectIdentifiers.RABBIT_HOLE,q.getLocation().clone(),10,0,null);
    q.attrs.set('quest.eagles_peak.stage',2);Math.random=()=>0;
    Rabbits.flush({player:q,object:hole});advance(3);assert.equal(snare.state,'caught');
    Traps.check({player:q,object:snare.objects[0]});advance(2);
    assert.equal(q.counts.get(I.RABBIT_FOOT),1);assert.equal(q.counts.get(I.RABBIT_SNARE),1);assert.equal(q.counts.get(I.FERRET),1);

    // Pitfalls: build from the cache pit base, tease a creature, jump, then collect.
    q.counts.clear();q.moveTo(new core.Location(3000,3000,0));
    q.counts.set(I.KNIFE,1);q.counts.set(I.LOGS,2);q.counts.set(I.TEASING_STICK,1);
    const pitBaseId=[...Array(core.CacheDefinitions.getCounts().objects).keys()].find(id=>{
      const transforms=core.CacheDefinitions.getObject(id).transforms;
      return transforms?.[0]===core.ObjectIdentifiers.PIT_4&&transforms.includes(core.ObjectIdentifiers.COLLAPSED_TRAP_4);});
    assert.ok(pitBaseId,"cache has a spined-larupia pit base");
    const pitBase=new core.GameObject(pitBaseId,q.getLocation().clone(),10,0,null);
    objects.add(pitBase);
    Pitfalls.build({player:q,object:pitBase});advance(3);
    const pit=[...H.traps].find(t=>t.player===q&&t.kind==='pit');assert.ok(pit);assert.equal(pit.state,'idle');
    assert.equal(objects.has(pitBase),false,"the mapped pit base is replaced while set");
    const larupia=prey(core.NpcIdentifiers.SPINED_LARUPIA,new core.Location(3001,3000,0));
    Pitfalls.tease({player:q,npc:larupia,npcId:larupia.getId()});advance(1);
    assert.equal(H.reserved.get(larupia)!=null,true,"a teased creature is reserved");
    const prePit=q.experience.get(Skill.HUNTER);Math.random=()=>0;
    Pitfalls.jump({player:q,object:pit.objects[0]});
    assert.ok(q.getForceMovement(),"jumping forces movement before it resolves");
    advance(1);assert.ok(q.getForceMovement(),"force movement resolves on the second tick");
    assert.ok(q.getLocation().equals(new core.Location(3000,3000,0)));
    advance(1);assert.equal(q.getForceMovement(),null);assert.equal(pit.state,'caught');
    assert.ok(q.getLocation().equals(new core.Location(3000,3003,0)),"the hunter lands across the pit");
    q.moveTo(pit.location.clone().add(1,0));Traps.check({player:q,object:pit.objects[0]});advance(2);
    assert.equal(q.experience.get(Skill.HUNTER)-prePit,180);
    assert.equal(q.counts.get(I.BIG_BONES),1);assert.equal(q.counts.get(I.LARUPIA_FUR),1);assert.equal(q.counts.get(I.RAW_LARUPIA),1);
    assert.equal(H.traps.has(pit),false);assert.equal(objects.has(pitBase),true,"collecting restores the pit base");

    // A failed leap hides the creature until it lands on the far side; the pit stays set.
    q.counts.set(I.LOGS,1);q.counts.set(I.TEASING_STICK,1);q.levels.set(Skill.HUNTER,50);
    Pitfalls.build({player:q,object:pitBase});advance(3);
    const pit2=[...H.traps].find(t=>t.player===q&&t.kind==='pit');assert.ok(pit2);
    const larupia2=prey(core.NpcIdentifiers.SPINED_LARUPIA,new core.Location(3001,3000,0));
    Pitfalls.tease({player:q,npc:larupia2,npcId:larupia2.getId()});advance(1);
    Math.random=()=>0.99;Pitfalls.jump({player:q,object:pit2.objects[0]});advance(2);
    assert.equal(pit2.state,'idle',"a missed pitfall stays set");
    assert.equal(larupia2.isVisible(),false,"the creature is hidden mid-leap");
    advance(3);assert.equal(larupia2.isVisible(),true);
    assert.ok(larupia2.getLocation().equals(q.getLocation()),"the creature lands beside the hunter");
    assert.equal(C.distance(larupia2.getLocation(),pit2.location),3);
    Pitfalls.clear({player:q});Math.random=()=>0.5;q.counts.clear();q.levels.delete(Skill.HUNTER);

    q.counts.clear();Math.random=()=>0.5;q.attrs.set('quest.bone_voyage.stage',2);
    q.moveTo(new core.Location(...Herbi.data.starts[0],0));
    const startObject=new core.GameObject(core.ObjectIdentifiers.ROCK_72,q.getLocation().clone(),10,0,null);
    Herbi.inspect({player:q,object:startObject});advance(2);
    q.levels.set(Skill.HUNTER,70);
    for(let step=0;!q.configs.get(5766)&&step<8;step++){
      const [varbit,value]=[...q.configs].find(([v,value])=>Herbi.data.edges.some(e=>e[0]===v)&&value>=3);
      const edge=Herbi.data.edges.find(e=>e[0]===varbit),point=edge[value===4?2:1].slice(1);
      q.moveTo(new core.Location(...point,0));Herbi.inspect({player:q,object:new core.GameObject(core.ObjectIdentifiers.MUDDY_PATCH,q.getLocation().clone(),10,0,null)});advance(2);
    }
    assert.ok(q.configs.get(5766)>0,"visible cache trails lead to a final tunnel");
    const end=Herbi.data.ends[q.configs.get(5766)-1];q.moveTo(new core.Location(...end,0));
    const tunnel=new core.GameObject(core.ObjectIdentifiers.TUNNEL_47,q.getLocation().clone(),10,0,null);
    const preHerbi=q.experience.get(Skill.HUNTER);Herbi.attack({player:q,object:tunnel});advance(2);
    assert.equal(q.experience.get(Skill.HUNTER)-preHerbi,2461,"only the start requires the boosted Hunter level");
    const herbi=spawned.at(-1);q.counts.set(I.MAGIC_SECATEURS,1);q.setSize(1);
    Herbi.harvest({player:q,npc:herbi});advance(2);assert.equal(herbi.isRegistered(),true);
    q.setSize(28);Herbi.harvest({player:q,npc:herbi});advance(4);
    assert.equal(herbi.isRegistered(),false);assert.equal(q.experience.get(Skill.HERBLORE),50);
    assert.ok(successEvents.some(e=>e.method==='herbiboar'&&e.petChance===6500));q.levels.clear();

    q.counts.clear();q.attrs.set('quest.while_guthix_sleeps.stage',1);q.counts.set(I.KNIFE,1);q.counts.set(I.LOGS,1);q.counts.set(I.MORT_MYRE_FUNGUS,1);
    let broavBaseId;
    for(let id=0;id<core.CacheDefinitions.getCounts().objects;id++)if(core.CacheDefinitions.getObject(id).transforms?.[0]===core.ObjectIdentifiers.PIT_5){broavBaseId=id;break;}
    assert.ok(broavBaseId);const broavBase=new core.GameObject(broavBaseId,q.getLocation().clone(),10,0,null);
    Broavs.build({player:q,object:broavBase});advance(3);
    const broavPit=[...objects].find(o=>o.getId()===core.ObjectIdentifiers.PIT_TRAP);
    Broavs.bait({player:q,object:broavPit});advance(22);
    const caughtBroav=[...objects].find(o=>o.getId()===core.ObjectIdentifiers.COLLAPSED_TRAP_10);
    assert.ok(caughtBroav);Broavs.dismantle({player:q,object:caughtBroav});advance(2);
    assert.equal(q.counts.get(I.UNCONSCIOUS_BROAV),1);
    const expert={getId:()=>0,getDefinition:()=>({getName:()=>"Hunting expert"}),getLocation:()=>q.getLocation(),getPrivateArea:()=>null};
    Broavs.train({player:q,target:expert,itemId:I.UNCONSCIOUS_BROAV});assert.equal(q.counts.get(I.BROAV),1);
    Broavs.build({player:q,object:broavBase});advance(3);
    assert.equal([...objects].some(o=>o.getId()===core.ObjectIdentifiers.PIT_TRAP),false,"cannot catch a second broav while one is owned");

    q.counts.clear();const rumour=Rumours.state(q);rumour.unlocked=true;
    const taskIndex=Rumours.tasks.findIndex(t=>t.npc==='TROPICAL_WAGTAIL');
    assert.ok(taskIndex>=0);rumour.assignments[0]={task:taskIndex,count:39,found:false};rumour.active=0;
    q.setSize(0);Rumours.success({player:q,npcId:core.NpcIdentifiers.TROPICAL_WAGTAIL,method:'bird'});
    assert.equal(rumour.assignments[0].found,false,"a full-inventory pity part is withheld");
    q.setSize(28);Rumours.success({player:q,npcId:core.NpcIdentifiers.TROPICAL_WAGTAIL,method:'bird'});
    const part=I[Rumours.tasks[taskIndex].part];assert.equal(q.counts.get(part),1);
    const rumourXp=q.experience.get(Skill.HUNTER);Rumours.assign(q,0);
    assert.equal(q.experience.get(Skill.HUNTER)-rumourXp,5200);assert.equal(q.counts.get(I.HUNTERS_LOOT_SACK_BASIC_),1);
    assert.equal(rumour.completed,1);assert.equal(q.counts.has(part),false);
    q.setSize(0);Rumours.open({player:q,itemId:I.HUNTERS_LOOT_SACK_BASIC_});assert.equal(q.counts.get(I.HUNTERS_LOOT_SACK_BASIC_),1);
    let rerolls=0;Math.random=()=>{rerolls++;return 0.9;};q.setSize(28);Rumours.open({player:q,itemId:I.HUNTERS_LOOT_SACK_BASIC_});
    assert.equal(rerolls,0,"opening retries use the already rolled sack contents");assert.equal(q.counts.has(I.HUNTERS_LOOT_SACK_BASIC_),false);
    Math.random=()=>0.5;

    assert.equal(Drift.experience(44,true),52.3);assert.equal(Drift.experience(47,false),46.2);assert.equal(Drift.experience(99,true),101.5);
    H.core.PrivateArea=class {constructor(){this.entities=[];}enter(p){p.setArea(this);}add(e){this.entities.push(e);e.setArea(this);}getObjects(){return this.entities.filter(e=>e instanceof core.GameObject);}leave(p){p.setArea(null);}destroy(){} };
    const anchors=[...Drift.bases].map(([id],i)=>new core.GameObject(id,new core.Location(i?3743:3746,i?10288:10295,1),10,0,null));
    H.core.MapObjects.mapObjects=new Map([[0,anchors]]);H.core.RegionManager.loadMapFiles=()=>{};
    q.counts.clear();q.counts.set(I.DRIFT_NET,1);Drift.state(q).until=-1;Drift.enter(q);
    const anchor=q.getPrivateArea().getObjects()[0];q.moveTo(anchor.getLocation().clone().add(0,1));
    Drift.setup({player:q,object:anchor});advance(2);
    const net=Drift.state(q).nets[anchor.getId()];assert.equal(net.count,0);
    const shoal=spawned.find(n=>n.getId()===core.NpcIdentifiers.FISH_SHOAL&&n.getLocation().getX()===3744);
    const preNet=q.experience.get(Skill.HUNTER);
    Math.random=()=>0.9;Drift.chase({player:q,npc:shoal,npcId:shoal.getId()});advance(2);
    assert.equal(net.count,0,"a failed scare leaves the shoal in place");
    q.equipment.set(core.Equipment.WEAPON_SLOT,I.MERFOLK_TRIDENT);Math.random=()=>0.5;
    Drift.chase({player:q,npc:shoal,npcId:shoal.getId()});
    advance(2);
    assert.equal(net.count,1);assert.equal(q.experience.get(Skill.HUNTER)-preNet,101.5);
    net.count=10;Drift.harvest({player:q,object:anchor});q.setSize(0);q.options[0][1]();
    assert.equal(Drift.state(q).nets[anchor.getId()],net,"harvest keeps the remaining catch when full");
    q.setSize(1);q.options[0][1]();assert.equal(net.rewards.length,9,"fish can be collected individually");
    q.counts.set(I.NUMULITE,5);q.setSize(28);q.moveTo(new core.Location(3729,10293,1));q.options[1][1]();
    assert.equal(q.counts.get(I.NUMULITE),5,"a stale dialogue cannot bank a net remotely");
    q.moveTo(anchor.getLocation().clone().add(0,1));q.options[1][1]();
    assert.equal(Drift.state(q).nets[anchor.getId()],undefined);assert.equal(q.counts.has(I.NUMULITE),false);
    assert.ok(q.banks.some(b=>b.items.size>0));Drift.cleanup({player:q});
    // Ceto's transcript: its conditions follow the player's access and numulites.
    const Ceto = require("../plugins/skills/hunter/Ceto.Hunter");
    const cetoSays = text => Ceto.condition({ player: q, npcId: core.NpcIdentifiers.CETO, text });
    Drift.state(q).until = 0; q.counts.set(I.NUMULITE, 200);
    assert.equal(cetoSays("If the player has the level requirements to drift net fish, but has not paid for a day's access:"), true);
    assert.equal(cetoSays("If the player has at least 200 numulites in their inventory:"), true);
    assert.ok(Drift.buyDay(q)); assert.equal(q.counts.has(I.NUMULITE), false);
    assert.equal(cetoSays("If the player has paid to access for the day:"), true);
    assert.equal(cetoSays("If the player has paid for permanent access:"), false);
    assert.equal(Ceto.condition({ player: q, npcId: core.NpcIdentifiers.ANNETTE, text: "If the player has paid for permanent access:" }), null);
    // The lines the payments hang on are the transcript's own words.
    const transcript = JSON.stringify(require("../data/definitions/npc-dialogues.json").Ceto);
    for (const words of [Ceto.PAY_TEXT, Ceto.ENTERS_LINE, Ceto.PERMANENT_LINE]) assert.ok(transcript.includes(JSON.stringify(words)), words);
    Drift.state(q).until = 0; q.counts.set(I.NUMULITE, 200);
    const give = { player: q, npcId: core.NpcIdentifiers.CETO, action: "give", text: Ceto.PAY_TEXT, handled: false };
    Ceto.action(give);
    assert.ok(give.handled && !give.end && Drift.state(q).until > Date.now(), "the give step pays for the day");
    const broke = { player: q, npcId: core.NpcIdentifiers.CETO, action: "give", text: Ceto.PAY_TEXT, handled: false };
    Ceto.action(broke); assert.ok(broke.end, "no numulites ends the conversation");
    q.counts.set(I.NUMULITE, 20000);
    const thanks = { player: q, npcId: core.NpcIdentifiers.CETO, text: Ceto.PERMANENT_LINE, skip: false };
    Ceto.line(thanks);
    assert.equal(Drift.state(q).until, -1); assert.equal(q.counts.has(I.NUMULITE), false);
    q.equipment.clear();q.counts.clear();q.moveTo(new core.Location(1370,3620));q.counts.set(I.KING_WORM,2);
    Aerial.borrow({player:q});const spot=prey(core.NpcIdentifiers.FISHING_SPOT_12,q.getLocation().clone().add(2,0));
    const preAerial=q.experience.get(Skill.HUNTER);Aerial.fish({player:q,npc:spot,npcId:spot.getId()});advance(1);
    assert.ok(q.experience.get(Skill.HUNTER)>preAerial);assert.equal(q.counts.get(I.KING_WORM),1);
    Aerial.cleanup({player:q});Runtime.cleanup({player:q});

    // Tracking: the object the visible tracks lead to reveals the next set, and the last one hides the kebbit.
    const t = player(), tracked = [];
    t.counts.set(I.NOOSE_WAND, 1); t.sendMessage = m => tracked.push(m);
    const trailAt = ([x, y, z]) => new core.GameObject(1, new core.Location(x, y, z), 10, 0, null);
    const segmentOf = varbit => Tracking.data.segments.find(s => s.varbit === varbit);
    const burrow = trailAt(Tracking.data.segments.find(s => s.burrow && s.kebbit === "feldip_weasel").start);
    t.moveTo(burrow.getLocation().clone());
    Tracking.inspect({ player: t, object: burrow, definition: { getName: () => "Burrow" } });
    let searches = 0;
    while (!tracked.at(-1).startsWith("Something is moving here") && searches++ < 15) {
      const varbit = [...t.configs.keys()].at(-1), segment = segmentOf(varbit);
      const forwards = t.configs.get(varbit) === (segment.inverted ? 5 : 4);
      const spot = trailAt(forwards ? segment.end : segment.start);
      t.moveTo(spot.getLocation().clone());
      Tracking.inspect({ player: t, object: spot, definition: { getName: () => "Bush" } });
      assert.notEqual(tracked.at(-1), "You find no new tracks here.", "the object the tracks lead to continues the trail");
    }
    assert.ok(searches < 15, "the trail ends at the kebbit");
    const hide = trailAt([t.getLocation().getX(), t.getLocation().getY(), t.getLocation().getZ()]);
    Tracking.catchPrey({ player: t, object: hide }); advance(2);
    assert.equal(t.experience.get(Skill.HUNTER), 48, "a Feldip weasel gives 48 Hunter XP");
    assert.ok(t.counts.has(I.FELDIP_WEASEL_FUR));

    const route = { npcId: core.NpcIdentifiers.FISHING_SPOT_12, definition: { getActions: () => ["Catch"] }, clickType: 1, range: 1 };
    Runtime.npcRoute(route); assert.equal(route.range, 9);
    const MagicBoxes = require("../plugins/skills/hunter/MagicBoxes.Hunter");
    p.counts.clear(); p.counts.set(I.IMP_IN_A_BOX_2_, 1); p.counts.set(I.COINS, 500);
    let transferred = 0;
    H.core.Bank = { ...core.Bank, deposit(player, id, slot, amount) { player.getInventory().deleteNumber(id, amount); transferred += amount; } };
    const bankEvent = { player: p, usedItemId: I.IMP_IN_A_BOX_2_, usedWithItemId: I.COINS };
    MagicBoxes.use(bankEvent);
    assert.equal(transferred, 500); assert.equal(p.counts.get(I.IMP_IN_A_BOX_1_), 1);
    p.counts.set(I.COINS, 100); H.core.Bank.deposit = () => {};
    MagicBoxes.use({ ...bankEvent, usedItemId: I.IMP_IN_A_BOX_1_ });
    assert.equal(p.counts.get(I.IMP_IN_A_BOX_1_), 1, "failed banking does not spend a charge");
    const pluginApi = PluginManager.createApi("hunter-route-check");
    pluginApi.onNpcRoute(event => { event.range = Infinity; });
    const checkedRoute = { player: p, npc, range: 1 };
    PluginManager.emitNpcRoute(checkedRoute); assert.equal(checkedRoute.range, 1, "invalid hook ranges are rejected centrally");
    const { MovementQueue } = require("../dist/game/model/movement/MovementQueue");
    const originals = { projectile: core.RegionManager.canProjectileAttack, entityRoute: core.PathFinder.calculateEntityRoute,
      reached: core.PathFinder.reachedEntity, submit: core.TaskManager.submit };
    let completed = 0, queued = 0;
    const queue = { player: { ...p, getIndex: () => 1, setMobileInteraction() {} }, getMobility: () => ({ canMove: () => true }),
      checkDestination: () => true, reset() {}, walkToReset() {}, isInteractionTargetValid: () => true,
      isProjectedMainWorldNpc: () => false, canInteractWithUnreachableNpc: () => false };
    try {
      core.PathFinder.reachedEntity = () => false;
      core.PathFinder.calculateEntityRoute = () => {};
      core.TaskManager.submit = () => queued++;
      core.RegionManager.canProjectileAttack = () => true;
      MovementQueue.prototype.walkToEntity.call(queue, npc, () => completed++, 9);
      assert.equal(completed, 1, "a ranged option resolves before trying to walk into water");
      core.RegionManager.canProjectileAttack = () => false;
      MovementQueue.prototype.walkToEntity.call(queue, npc, () => completed++, 9);
      assert.equal(completed, 1, "ranged options cannot resolve through projectile clipping");
      assert.equal(queued, 1, "blocked ranged interaction keeps the approach task");
    } finally {
      core.RegionManager.canProjectileAttack = originals.projectile; core.PathFinder.calculateEntityRoute = originals.entityRoute;
      core.PathFinder.reachedEntity = originals.reached; core.TaskManager.submit = originals.submit;
    }
  } finally {
    Math.random = random; C.choose = originalChoose;
    Runtime.shutdown(); H.core = core; H.players.clear(); H.reserved.clear(); H.actions.clear(); H.hidden.clear();
  }
});


// Exercise native feedback and the real plugin actions without a client or game loop.
function feedbackPlayer(core) {
  const counts = new Map(), sent = [], animations = [], attrs = new Map(), varbits = new Map(), messages = [], graphics = [];
  let location = new core.Location(3000, 3000, 0), menu, chatbox = -1, activeSkill = null;
  const inventory = {
    getItems: () => [...counts].map(([id, n]) => new core.Item(id, n)),
    get: slot => [...counts].map(([id, n]) => new core.Item(id, n))[slot],
    getSlotForItemId: id => [...counts.keys()].indexOf(id),
    contains: id => (counts.get(id) ?? 0) > 0, getAmount: id => counts.get(id) ?? 0,
    deleteNumber(id, n) { const remaining = (counts.get(id) ?? 0) - n; if (remaining > 0) counts.set(id, remaining); else counts.delete(id); },
    deleteAtSlot(slot, n) { this.deleteNumber(this.get(slot).getId(), n); },
    addItem(item) { counts.set(item.getId(), (counts.get(item.getId()) ?? 0) + item.getAmount()); },
    isFull: () => false, getFreeSlots: () => 28,
  };
  const sender = new Proxy({
    sendCreationMenu(value) { menu = value; return sender; },
    sendTypedMessage(type, text) { sent.push(["sendTypedMessage", type, text]); messages.push(text); return sender; },
    sendChatboxInterface(id) { chatbox = id; sent.push(["chatbox", id]); return sender; },
    isChatboxInterface: id => chatbox === id,
    closeInterface(id) { if (chatbox === id) chatbox = -1; return sender; },
    getVarbit: id => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); sent.push(["sendVarbit", id, value]); return sender; },
  }, { get: (target, key) => target[key] ?? ((...args) => { sent.push([key, ...args]); return sender; }) });
  const p = {
    counts, sent, animations, messages, graphics, inventory, menu: () => menu,
    getLocation: () => location, moveTo(value) { location = value; },
    getInventory: () => inventory, getEquipment: () => ({ contains: () => false }), getPacketSender: () => sender,
    getMovementQueue: () => ({ size: () => 0 }), getForceMovement: () => null,
    isRegistered: () => true, getHitpoints: () => 99,
    getUsername: () => "feedback-test", getIndex: () => 1, isPlayerBot: () => false,
    performAnimation: a => animations.push(a.getId()), performGraphic: g => graphics.push(g.getId()), sendMessage: m => messages.push(m),
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getSkill: () => activeSkill, setSkill(value) { activeSkill = value; }, setCreationMenu() {},
    getUpdateFlag: () => ({ flag() {} }),
    getAttribute: k => attrs.get(k), setAttribute: (k, v) => attrs.set(k, v),
    getSkillManager: () => p.skills, getCombat: () => ({ getTarget: () => p.target ?? null, getAttacker: () => null }),
  };
  p.skills = new SkillManager(p);
  return p;
}

function registerFeedbackPlugin(name, core, extra = {}) {
  // Like the plugin API, every handler a hook name gets runs until one handles the event.
  const handlers = {}, hooks = { customEvents: new Map() };
  const api = new Proxy({ core, log() {}, getPluginConfig: (_key, defaultValue) => defaultValue, ...extra }, {
    get: (target, key) => target[key] ?? ((...args) => {
      if (key === "onCustomEvent") {
        const [name, handler] = args;
        hooks.customEvents.set(name, [...(hooks.customEvents.get(name) ?? []), handler]);
      }
      (handlers[key] ??= []).push(args.find(arg => typeof arg === "function"));
      hooks[key] ??= (event, ...rest) => {
        let result;
        for (const handler of handlers[key]) {
          result = handler(event, ...rest);
          if (result || event?.handled) break;
        }
        return result;
      };
    }),
  });
  require(`../plugins/${name}.plugin`).register(api);
  return hooks;
}

test("every skill gets native level-up text, its own model, stats before hooks, and a working Continue", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core);
  const emit = PluginManager.emitPlayerLevelUp;
  PluginManager.emitPlayerLevelUp = event => {
    assert.equal(event.player.skills.getCurrentLevel(event.skill), event.newLevel);
    assert.ok(event.player.sent.some(([type, s]) => type === "sendSkill" && s === event.skill));
    hooks.onPlayerLevelUp(event);
  };
  const layers = [6, 17, 49, 30, 40, 38, 34, 12, 53, 25, 23, 21, 14, 47, 36, 28, 4, 51, 45, 19, 43, 9, 32, 57];
  try {
    for (const skill of Skill.values()) {
      const p = feedbackPlayer(core);
      p.skills.setCurrentLevels(skill, 1, false).setMaxLevel(skill, 1, false).setExperience(skill, 0);
      p.sent.length = 0;
      p.skills.addExperience(skill, SkillManager.getExperienceForLevel(2), false);
      assert.ok(p.sent.some(([type, id]) => type === "chatbox" && id === 233), skill.getName());
      assert.equal(p.messages[0], `Congratulations, you've just advanced your ${skill.getName()} level. You are now level 2.`);
      assert.deepEqual(p.graphics, [199]);
      assert.ok(p.sent.some(([type, text, id]) => type === "sendString" && id === ((233 << 16) | 1)
        && text === `<col=000080>Congratulations, you just advanced a ${skill.getName()} level.`));
      assert.ok(p.sent.some(([type, text, id]) => type === "sendString" && id === ((233 << 16) | 2)
        && text === `Your ${skill.getName()} level is now 2.`));
      assert.deepEqual(p.sent.filter(([type, , hidden]) => type === "sendInterfaceDisplayState" && !hidden),
        [["sendInterfaceDisplayState", (233 << 16) | layers[skill.getIndex()], false]]);
      assert.equal(p.sent.filter(([type]) => type === "sendSkill").length, 1, "one stats update for the resolving tick");
      assert.equal(p.animations.at(-1), 65535);
      assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
      assert.equal(p.getPacketSender().isChatboxInterface(233), false);
      assert.equal(hooks.onInterfaceActionButton({ player: p }), false, "stale continue does not close another dialog");
    }
  } finally { PluginManager.emitPlayerLevelUp = emit; }
});

/** A player whose skill totals the level-up plugin reads are fixed. */
function levelledPlayer(core, { total = 101, combat = 3 } = {}) {
  const p = feedbackPlayer(core);
  p.stopped = 0;
  p.skills = { getTotalLevel: () => total, getCombatLevel: () => combat, stopSkillable() { p.stopped++; } };
  p.setCombat = (level) => { combat = level; };
  return p;
}

const POPUP_DISABLED = 20157;

test("as captured: Disabled pop-ups keep the message and graphic, and interrupt nothing", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), emitted = [];
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core, { emitCustomEvent: (name) => emitted.push(name) });
  const p = levelledPlayer(core);
  p.getPacketSender().sendVarbit(POPUP_DISABLED, 1);
  hooks.onPlayerLevelUp({ player: p, skill: Skill.DEFENCE, oldLevel: 80, newLevel: 81 });
  assert.deepEqual(p.messages, ["Congratulations, you've just advanced your Defence level. You are now level 81."]);
  assert.deepEqual(p.graphics, [199]);
  assert.equal(p.sent.some(([type]) => type === "chatbox"), false);
  assert.equal(p.stopped, 0);
  assert.deepEqual(emitted, []);
  assert.deepEqual(p.animations, []);
});

test("world config can disable interruption without closing another dialogue or stopping the action", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), emitted = [];
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core, {
    getPluginConfig(key, defaultValue) {
      assert.equal(key, "SkillLevelUp:interruptActions");
      assert.equal(defaultValue, true);
      return false;
    },
    emitCustomEvent: name => emitted.push(name),
  });
  const p = levelledPlayer(core);
  p.getPacketSender().sendChatboxInterface(999);
  p.sent.length = 0;
  hooks.onPlayerLevelUp({ player: p, skill: Skill.FISHING, oldLevel: 66, newLevel: 67 });
  assert.deepEqual(p.messages, ["Congratulations, you've just advanced your Fishing level. You are now level 67."]);
  assert.deepEqual(p.graphics, [199]);
  assert.equal(p.getPacketSender().isChatboxInterface(999), true);
  assert.equal(p.sent.some(([type]) => type === "chatbox" || type === "sendInterfaceRemoval"), false);
  assert.equal(p.stopped, 0);
  assert.deepEqual(emitted, []);
  assert.deepEqual(p.animations, []);
});

test("an open pop-up stops skilling and tells the skilling plugins", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), emitted = [];
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core, { emitCustomEvent: (name, event) => emitted.push([name, event.skill]) });
  const p = levelledPlayer(core);
  hooks.onPlayerLevelUp({ player: p, skill: Skill.FISHING, oldLevel: 66, newLevel: 67 });
  assert.equal(p.stopped, 1);
  assert.deepEqual(emitted, [["level-up:popup-opened", Skill.FISHING]]);
});

test("a level-up mid-fight keeps the attack animation", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core);
  const p = levelledPlayer(core);
  p.target = {};
  hooks.onPlayerLevelUp({ player: p, skill: Skill.ATTACK, oldLevel: 40, newLevel: 41 });
  assert.deepEqual(p.animations, []);
  assert.deepEqual(p.graphics, [199]);
});

test("as captured: every 25 total levels, and level 99, have their own message", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core);
  const crossed = levelledPlayer(core, { total: 1350 });
  crossed.getPacketSender().sendVarbit(POPUP_DISABLED, 1);
  hooks.onPlayerLevelUp({ player: crossed, skill: Skill.FISHING, oldLevel: 62, newLevel: 63 });
  assert.deepEqual(crossed.messages, [
    "Congratulations, you've just advanced your Fishing level. You are now level 63.",
    "Congratulations, you've reached a total level of 1350.",
  ]);
  const between = levelledPlayer(core, { total: 1351 });
  between.getPacketSender().sendVarbit(POPUP_DISABLED, 1);
  hooks.onPlayerLevelUp({ player: between, skill: Skill.FISHING, oldLevel: 63, newLevel: 64 });
  assert.equal(between.messages.length, 1);
  const maxed = levelledPlayer(core);
  maxed.getPacketSender().sendVarbit(POPUP_DISABLED, 1);
  hooks.onPlayerLevelUp({ player: maxed, skill: Skill.ATTACK, oldLevel: 98, newLevel: 99 });
  assert.deepEqual(maxed.messages, ["Congratulations, you've reached the highest possible Attack level of 99."]);
  assert.deepEqual(maxed.graphics, [1388]);
});

test("as captured: a combat level gained waits behind the skill's pop-up", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  const submit = core.TaskManager.submit, tasks = [];
  core.TaskManager.submit = (task) => tasks.push(task);
  try {
    const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core);
    const p = levelledPlayer(core, { combat: 90 });
    hooks.onPlayerLogin({ player: p });
    p.setCombat(91);
    hooks.onPlayerLevelUp({ player: p, skill: Skill.ATTACK, oldLevel: 83, newLevel: 84 });
    assert.equal(tasks.length, 1, "the combat message comes a tick later");
    tasks[0].execute();
    assert.equal(p.messages.at(-1), "Congratulations, you've just advanced your Combat level. You are now level 91.");
    p.sent.length = 0;
    assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
    assert.ok(p.sent.some(([type, text]) => type === "sendString" && text === "<col=000080>Congratulations, you just advanced a combat level."));
    assert.ok(p.sent.some(([type, text]) => type === "sendString" && text === "Your combat level is now 91."));
    assert.deepEqual(p.sent.filter(([type, , hidden]) => type === "sendInterfaceDisplayState" && !hidden),
      [["sendInterfaceDisplayState", (233 << 16) | 55, false]]);
    assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
    assert.equal(p.getPacketSender().isChatboxInterface(233), false);
  } finally { core.TaskManager.submit = submit; }
});

test("burying resolves inventory and XP on click; movement, logout and cancellation cannot repeat or refund it", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), tasks = [];
  const hooks = registerFeedbackPlugin("skills/Prayer", core, {
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
  });
  for (const mode of ["complete", "walk-before-message", "logout", "cancel"]) {
    const p = feedbackPlayer(core);
    p.counts.set(core.ItemIdentifiers.BONES, 2);
    let xp = 0;
    p.skills = { stopSkillable() {}, addExperiences(s, n) { assert.equal(s, Skill.PRAYER); xp += n; } };
    assert.equal(hooks.onItemFirstAction({ player: p, itemId: core.ItemIdentifiers.BONES, slot: 0 }), true);
    const task = tasks.pop();
    assert.equal(task.key, p, "logout cancels tasks by player identity");
    assert.equal(p.counts.get(core.ItemIdentifiers.BONES), 1);
    assert.equal(xp, 4.5, "the clicked bone awards XP immediately");
    if (mode === "walk-before-message") p.moveTo(new core.Location(3001, 3000, 0));
    if (mode === "logout") p.isRegistered = () => false;
    if (mode === "cancel") task.stop();
    task.tick();
    task.tick();
    assert.equal(xp, 4.5, mode);
    assert.equal(p.counts.get(core.ItemIdentifiers.BONES), 1, mode);
    assert.deepEqual(p.messages, mode === "logout" || mode === "cancel"
      ? ["You dig a hole in the ground..."]
      : ["You dig a hole in the ground...", "You bury the bones."], mode);
    assert.equal(task.isRunning(), false);
  }
});

test("Fletching keeps going while moving, stops on the next click and resumes after a level-up is acknowledged", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  // Fletching names its animations by gameval; an earlier test may have opened the cache already.
  try { CachePipeline.getActive(); } catch { await CachePipeline.initialize(require("node:path").resolve(__dirname, "..")); }
  const core = PluginManager.getCoreApi(), tasks = [];
  const hooks = registerFeedbackPlugin("skills/Fletching", core, {
    getTaskManager: () => ({ submit: task => { task.setRunning(true); tasks.push(task); } }),
  });
  // The level-up pop-up is what stops Fletching: SkillLevelUp announces it as an event.
  let interruptActions = true;
  const feedback = registerFeedbackPlugin("interface/SkillLevelUp", core, {
    getPluginConfig: () => interruptActions,
    emitCustomEvent: (name, event) => name === "level-up:popup-opened" && hooks.onCustomEvent(event),
  });
  for (const mode of ["moving", "click", "level-up", "uninterrupted-level-up"]) {
    interruptActions = mode !== "uninterrupted-level-up";
    const p = feedbackPlayer(core);
    let xp = 0;
    p.skills = {
      getCurrentLevel: () => 99, getTotalLevel: () => 100, getCombatLevel: () => 3, stopSkillable() {},
      addExperiences() {
        xp++;
        if (mode.endsWith("level-up") && xp === 1) feedback.onPlayerLevelUp({ player: p, skill: Skill.FLETCHING, oldLevel: 1, newLevel: 2 });
      },
    };
    p.counts.set(core.ItemIdentifiers.KNIFE, 1); p.counts.set(core.ItemIdentifiers.LOGS, 2);
    hooks.onItemOnItem({ player: p, usedItemId: core.ItemIdentifiers.KNIFE, usedWithItemId: core.ItemIdentifiers.LOGS });
    const menu = p.menu(); assert.ok(menu);
    menu.execute(menu.getItems()[0], 2);
    const task = tasks.at(-1);
    assert.equal(task.key, p.getIndex(), "walkToReset cancels tasks keyed to the player");
    for (let n = 0; n < 7; n++) {
      // A walk click or interaction runs walkToReset, which stops the player's keyed tasks.
      if (mode === "click" && n === 1) task.stop();
      if (mode === "moving") p.moveTo(new core.Location(3000 + n, 3000, 0));
      if (task.isRunning()) task.execute();
    }
    assert.equal(xp, { moving: 2, click: 0, "level-up": 1, "uninterrupted-level-up": 2 }[mode]);
    assert.equal(p.counts.get(core.ItemIdentifiers.LOGS) ?? 0, { moving: 0, click: 2, "level-up": 1, "uninterrupted-level-up": 0 }[mode]);
    assert.equal(task.isRunning(), mode === "level-up");
    if (mode === "level-up") {
      assert.equal(p.animations.at(-1), 65535, "the popup holds the remaining batch and animation");
      assert.equal(feedback.onInterfaceActionButton({ player: p }), true);
      for (let n = 0; n < 7 && task.isRunning(); n++) task.execute();
      assert.equal(xp, 2, "Continue finishes the remaining batch exactly once");
      assert.equal(p.counts.get(core.ItemIdentifiers.LOGS) ?? 0, 0);
      assert.equal(task.isRunning(), false);
    }
    assert.equal(p.sent.some(([type]) => type === "sendSoundEffect"), false, "animation frames supply the audio");
  }
});

test("level-up acknowledgement waits through nested skill and combat popups before resuming the original session", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { pauseForLevelUp } = require("../plugins/skills/SkillActions");
  const core = PluginManager.getCoreApi(), sessions = new Map();
  const p = levelledPlayer(core, { combat: 90 });
  const session = {};
  sessions.set(p, session);
  let resumed = 0, nested = false;
  const submit = core.TaskManager.submit;
  core.TaskManager.submit = () => {};
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core, {
    emitCustomEvent(name, event) {
      if (name !== "level-up:popup-opened") return;
      pauseForLevelUp(event, sessions, (player) => sessions.delete(player), () => resumed++);
      if (!nested) {
        nested = true;
        hooks.onPlayerLevelUp({ player: p, skill: Skill.HITPOINTS, oldLevel: 50, newLevel: 51 });
      }
    },
  });
  try {
    hooks.onPlayerLogin({ player: p });
    p.setCombat(91);
    hooks.onPlayerLevelUp({ player: p, skill: Skill.ATTACK, oldLevel: 50, newLevel: 51 });
    assert.equal(session.levelUpPaused, true);
    assert.equal(p.stopped, 0, "the cancellable action is held rather than destroyed");
    for (let popup = 0; popup < 2; popup++) {
      assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
      assert.equal(session.levelUpPaused, true, "later popups keep the session paused");
      assert.equal(resumed, 0);
    }
    assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
    assert.equal(session.levelUpPaused, false);
    assert.equal(resumed, 1);
    assert.equal(hooks.onInterfaceActionButton({ player: p }), false);
  } finally { core.TaskManager.submit = submit; }
});

test("a shared Smithing task holds only the levelled player's remaining work until Continue", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const Core = require("../plugins/skills/smithing/Core.Smithing");
  const Sessions = require("../plugins/skills/smithing/Sessions.Smithing");
  const core = PluginManager.getCoreApi();
  const tasks = [];
  const api = { core, emitCustomEvent() {}, getTaskManager: () => ({ submit: (task) => tasks.push(task) }), onServerStartup: (start) => start() };
  Core.init(api);
  Sessions(api);
  const p = levelledPlayer(core), other = levelledPlayer(core);
  let made = 0, otherMade = 0;
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core, {
    emitCustomEvent(name, event) { if (name === "level-up:popup-opened") Sessions.pause(event); },
  });
  Sessions.start(p, {
    type: "test", remaining: 2, interval: 1,
    step() {
      if (++made === 1) hooks.onPlayerLevelUp({ player: p, skill: Skill.SMITHING, oldLevel: 1, newLevel: 2 });
      return true;
    },
  });
  Sessions.start(other, { type: "test", remaining: 4, interval: 1, step() { otherMade++; return true; } });
  try {
    for (let tick = 0; tick < 6; tick++) tasks[0].execute();
    assert.equal(made, 1, "no resources are processed while the popup is open");
    assert.equal(otherMade, 4, "another player's session continues normally");
    assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
    for (let tick = 0; tick < 4; tick++) tasks[0].execute();
    assert.equal(made, 2, "only the original remaining work resumes");
    assert.equal(Sessions.typeOf(p), null);
  } finally {
    Sessions.stop(p, false);
    Sessions.stop(other, false);
  }
});

test("a popup from the first altar offering pauses its newly created loop until acknowledged", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), tasks = [];
  const submit = core.TaskManager.submit, random = Math.random;
  core.TaskManager.submit = (task) => { task.setRunning(true); tasks.push(task); };
  Math.random = () => 0.99;
  const altar = registerFeedbackPlugin("skills/BoneAltars", core, {
    emitCustomEvent(name, request) { if (name === "prayer:bone") request.bone = { xp: 4.5 }; },
  });
  const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core, {
    emitCustomEvent(name, event) {
      for (const handler of altar.customEvents.get(name) ?? []) handler(event);
    },
  });
  const p = levelledPlayer(core);
  p.getEquipment = () => ({ getItems: () => [] });
  p.setPositionToFace = () => {};
  p.counts.set(core.ItemIdentifiers.BONES, 2);
  let offerings = 0;
  p.skills.addExperiences = () => {
    if (++offerings === 1) hooks.onPlayerLevelUp({ player: p, skill: Skill.PRAYER, oldLevel: 1, newLevel: 2 });
  };
  const at = new core.Location(2947, 3820, 0);
  try {
    altar.onItemOnObject({ player: p, object: { getLocation: () => at },
      objectId: core.CacheDefinitions.getLocId("chaosaltar"), itemId: core.ItemIdentifiers.BONES, location: at });
    for (let tick = 0; tick < 10; tick++) tasks[0].execute();
    assert.equal(offerings, 1);
    assert.equal(p.counts.get(core.ItemIdentifiers.BONES), 1);
    assert.equal(hooks.onInterfaceActionButton({ player: p }), true);
    for (let tick = 0; tick < 8 && tasks[0].isRunning(); tick++) tasks[0].execute();
    assert.equal(offerings, 2);
    assert.equal(p.counts.get(core.ItemIdentifiers.BONES) ?? 0, 0);
    assert.equal(tasks[0].isRunning(), false);
  } finally {
    core.TaskManager.submit = submit;
    Math.random = random;
  }
});

test("walking, replacement actions, popup cancellation and logout never resume a paused skill", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { pauseForLevelUp } = require("../plugins/skills/SkillActions");
  const core = PluginManager.getCoreApi();
  for (const mode of ["world-input", "interface-close", "item", "movement", "logout", "disconnect", "death", "replacement"]) {
    const p = levelledPlayer(core), sessions = new Map([[p, {}]]);
    let resumed = 0;
    const hooks = registerFeedbackPlugin("interface/SkillLevelUp", core, {
      emitCustomEvent(name, event) {
        if (name === "level-up:popup-opened") pauseForLevelUp(event, sessions, (player) => sessions.delete(player), () => resumed++);
      },
    });
    hooks.onPlayerLevelUp({ player: p, skill: Skill.FISHING, oldLevel: 1, newLevel: 2 });
    if (mode === "world-input" || mode === "interface-close") {
      const name = mode === "world-input" ? "player:world-input" : "interface:closed";
      for (const handler of hooks.customEvents.get(name)) handler({ player: p, interfaceId: 233 });
    } else if (mode === "item") hooks.onCanUseItem({ player: p, action: "action" });
    else if (mode === "movement") p.moveTo(new core.Location(3001, 3000, 0));
    else if (mode === "replacement") sessions.set(p, {});
    else hooks[{ logout: "onPlayerLogout", disconnect: "onPlayerDisconnect", death: "onPlayerDeath" }[mode]]({ player: p });
    hooks.onInterfaceActionButton({ player: p });
    assert.equal(resumed, 0, mode);
    if (mode !== "replacement") assert.equal(sessions.has(p), false, mode);
  }
});

test("native autocast indicators clear on staff removal while remembering the default", () => {
  const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
  const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
  const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
  const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
  const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  const { Item } = require("../dist/game/model/Item");
  const update = BonusManager.update, assign = CombatSpecial.assign, bar = CombatSpecial.updateBar;
  BonusManager.update = CombatSpecial.assign = CombatSpecial.updateBar = () => {};
  try {
    let staff = true, selected = null, fightType = null;
    const varbits = new Map();
    const sender = new Proxy({ sendVarbit(id, n) { varbits.set(id, n); return sender; } }, { get: (t, key) => t[key] ?? (() => sender) });
    const p = { getCombat: () => ({ getAutocastSpell: () => selected, setAutocastSpell: s => { selected = s; } }),
      getEquipment: () => ({ hasStaffEquipped: () => staff, getWeapon: () => new Item(staff ? ItemIdentifiers.STAFF_OF_AIR : -1, 1), getItems: () => new Array(14).fill(new Item(-1, 0)) }),
      getPacketSender: () => sender, getFightType: () => fightType, setFightType: type => { fightType = type; },
      setWeapon() {}, autoRetaliateReturn: () => false, sendMessage() {} };
    Autocasting.setAutocast(p, CombatSpells.WIND_STRIKE);
    assert.equal(varbits.get(275), 1); assert.equal(varbits.get(276), 1);
    staff = false; WeaponInterfaceManager.assign(p);
    assert.equal(selected, CombatSpells.WIND_STRIKE);
    for (const id of [275, 276, 2668]) assert.equal(varbits.get(id), 0);
    staff = true; Autocasting.setAutocast(p, selected);
    assert.equal(varbits.get(275), 1);
  } finally { BonusManager.update = update; CombatSpecial.assign = assign; CombatSpecial.updateBar = bar; }
});


test("choosing a style while autocasting turns autocast off, and autocast shows as com_mode 4 (rsprox)", () => {
  const { Item } = require("../dist/game/model/Item");
  const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
  const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
  const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
  const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
  const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
  const { FightType } = require("../dist/game/content/combat/FightType");
  const update = BonusManager.update;
  BonusManager.update = () => {};
  try {
    let selected = null, fightType = FightType.STAFF_BASH;
    const varbits = new Map(), varps = new Map();
    const sender = new Proxy({
      sendVarbit(id, n) { varbits.set(id, n); return sender; },
      sendConfig(id, n) { varps.set(id, n); return sender; },
    }, { get: (t, key) => t[key] ?? (() => sender) });
    const p = { getCombat: () => ({ getAutocastSpell: () => selected, setAutocastSpell: s => { selected = s; } }),
      getEquipment: () => ({ hasStaffEquipped: () => true, getWeapon: () => new Item(ItemIdentifiers.STAFF_OF_AIR, 1) }),
      getWeapon: () => WeaponInterfaces.STAFF,
      getPacketSender: () => sender, getFightType: () => fightType, setFightType: type => { fightType = type; },
      sendMessage() {} };

    Autocasting.setAutocast(p, CombatSpells.FIRE_STRIKE);
    assert.equal(varps.get(43), 4, "autocasting is com_mode 4, so any style click is a change");

    // The style the selector left selected (the same-value click the report hit), as a button.
    assert.equal(WeaponInterfaceManager.handleStyleButton(p, 593, 10), true);
    assert.equal(selected, null, "autocast off");
    assert.equal(varbits.get(275), 0); assert.equal(varbits.get(276), 0);
    assert.equal(varps.get(43), 1);
    assert.equal(fightType.getChildId(), 1);

    // And the same through a varp 43 change.
    Autocasting.setAutocast(p, CombatSpells.FIRE_STRIKE);
    assert.equal(WeaponInterfaceManager.changeCombatStyle(p, 0), true);
    assert.equal(selected, null);
    assert.equal(varps.get(43), 0);

    assert.equal(WeaponInterfaceManager.handleStyleButton(p, 593, 26), false, "other combat-tab buttons aren't styles");
  } finally { BonusManager.update = update; }
});
test("client feedback IDs and per-gem animations exist in the active OSRS cache", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { CacheIndexDat2 } = require("../dist/game/cache/codec/rs/cache/CacheIndex");
  const { IndexType } = require("../dist/game/cache/codec/rs/cache/IndexType");
  const { ConfigType } = require("../dist/game/cache/codec/rs/cache/ConfigType");
  const { Sound } = require("../dist/game/Sound");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const store = CachePipeline.getStore();
  const audio = CacheIndexDat2.fromStore(IndexType.DAT2.soundEffects, store);
  for (const [name, id] of Object.entries({ COOKING_COOK: 2577, CRAFT_RUNES: 2710,
    MINING_MINE: 3220, FISHING_FISH: 2600, CUTTING: 2605, SHEAR_SHEEP: 761,
    POTION_MIX: 2611, GEM_CUTTING: 2586, SMELTING: 2725, BURY_BONES: 2738, PRAYER_RECHARGE: 2674 })) {
    assert.equal(Sound[name].getId(), id, name);
    assert.ok(audio.getFileSmart(id)?.data.length, `OSRS synth ${name} exists`);
  }
  const interfaces = CacheIndexDat2.fromStore(IndexType.DAT2.interfaces, store);
  for (const child of [1, 2, 3, 4, 6, 9, 12, 14, 17, 19, 21, 23, 25, 28, 30, 32, 34, 36, 38, 40, 43, 45, 47, 49, 51, 53, 57])
    assert.ok(interfaces.getFile(233, child)?.data.length, `level-up component ${child}`);
  const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);
  const core = PluginManager.getCoreApi();
  const tasks = [];
  const hooks = registerFeedbackPlugin("skills/Crafting", core, { getTaskManager: () => ({ submit: task => tasks.push(task) }) });
  const members = core.WorldDefinition.isMembersWorld, random = Math.random;
  core.WorldDefinition.isMembersWorld = () => true;
  Math.random = () => 0;
  try {
    for (const [uncut, cut, animation] of [["OPAL", "OPAL", 890], ["JADE", "JADE", 891],
      ["RED_TOPAZ", "RED_TOPAZ", 892], ["SAPPHIRE", "SAPPHIRE", 888], ["EMERALD", "EMERALD", 889],
      ["RUBY", "RUBY", 887], ["DIAMOND", "DIAMOND", 886], ["DRAGONSTONE", "DRAGONSTONE", 885],
      ["ONYX", "ONYX", 2717], ["ZENYTE", "ZENYTE", 7185]]) {
      assert.ok(configs.getFile(ConfigType.DAT2.seqs, animation)?.data.length, `gem sequence ${animation}`);
      const p = feedbackPlayer(core), I = core.ItemIdentifiers;
      p.skills = { getCurrentLevel: () => 99, addExperiences() {} };
      p.getInterfaceId = () => -1;
      p.counts.set(I.CHISEL, 1); p.counts.set(I[`UNCUT_${uncut}`], 1);
      hooks.onItemOnItem({ player: p, usedItemId: I.CHISEL, usedWithItemId: I[`UNCUT_${uncut}`] });
      // rsprox 1875: the gem is cut on the tick after it is chosen in the skillmulti menu.
      p.menu().execute(I[`UNCUT_${uncut}`], 1);
      tasks.at(-1).execute();
      assert.equal(p.animations.at(-1), animation, uncut);
      assert.equal(p.counts.get(I[cut]), 1);
      assert.equal(p.sent.filter(([type, id]) => type === "sendSoundEffect" && id === 2586).length, 1);
    }
  } finally {
    core.WorldDefinition.isMembersWorld = members;
    Math.random = random;
  }
});

test("sound lookup excludes Lost City IDs, altar switches use OSRS audio, and region music still resolves", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { Sound } = require("../dist/game/Sound");
  const { Sounds } = require("../dist/game/Sounds");
  const { Music } = require("../dist/game/Music");
  const { ObjectIds } = require("../dist/util/IdEnums");
  const core = PluginManager.getCoreApi();
  for (const token of ["PRAYERON", "BAT_ATTACK", "SOUND_33", 1, "1"])
    assert.equal(Sounds.resolveKnownSound(token), null, String(token));
  for (const token of ["prayer_recharge", "Sound.PRAYER_RECHARGE", 2674, "2674"])
    assert.equal(Sounds.resolveKnownSound(token), Sound.PRAYER_RECHARGE);
  assert.ok(!Sounds.knownSoundNames().includes("PRAYERON"));

  const interactions = new Map();
  require("../plugins/objects/Altars.plugin").register({
    onObjectInteraction: (name, actions) => interactions.set(name, actions),
  });
  const change = core.MagicSpellbook.changeSpellbook;
  core.MagicSpellbook.changeSpellbook = (p, spellbook) => { p.spellbook = spellbook; };
  try {
    const cases = [["Ancient Altar", "Venerate", core.MagicSpellbook.ANCIENT],
      ["Lunar Altar", "Venerate", core.MagicSpellbook.LUNAR],
      ["Dark Altar", "Venerate", core.MagicSpellbook.ARCEUUS],
      ["Altar of the Occult", "Venerate", core.MagicSpellbook.NORMAL],
      ...["Standard", "Ancient", "Lunar", "Arceuus"].map((action, i) =>
        ["Altar of the Occult", action, [core.MagicSpellbook.NORMAL, core.MagicSpellbook.ANCIENT,
          core.MagicSpellbook.LUNAR, core.MagicSpellbook.ARCEUUS][i]])];
    for (const [name, action, expected] of cases) {
      const p = feedbackPlayer(core);
      p.getSpellbook = () => core.MagicSpellbook.NORMAL;
      assert.equal(interactions.get(name)[action]({ player: p, objectId: ObjectIds.ALTAR_OF_THE_OCCULT }), true);
      assert.equal(p.spellbook, expected, `${name}: ${action}`);
      assert.deepEqual(p.sent.filter(([type]) => type === "sendSoundEffect"), [["sendSoundEffect", 2674, 0, 0, 1]]);
    }
  } finally { core.MagicSpellbook.changeSpellbook = change; }

  const regions = require("../data/definitions/music-data.json").regions;
  const [region, tracks] = Object.entries(regions).find(([, tracks]) => tracks.length > 0);
  assert.equal(Music.forRegion(Number(region)), tracks[0]);
  assert.equal(Music.forRegion(-1), undefined);
});

test("Defence threshold changes update native prayer-unlock varbits", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const p = feedbackPlayer(PluginManager.getCoreApi());
  p.skills.setMaxLevel(Skill.PRAYER, 99, false);
  for (const level of [59, 60, 69, 70]) {
    p.sent.length = 0;
    p.skills.setMaxLevel(Skill.DEFENCE, level);
    const bits = new Map(p.sent.filter(([type]) => type === "sendVarbit").map(([, id, n]) => [id, n]));
    assert.equal(bits.get(3909), level >= 60 ? 8 : 0);
    assert.equal(bits.get(5451), level >= 70 ? 1 : 0);
    assert.equal(bits.get(5452), level >= 70 ? 1 : 0);
  }
});


test("cancelling a combat target stops its animation and future attacks without clearing airborne hits", () => {
  const { Combat } = require("../dist/game/content/combat/Combat");
  const animations = [], hits = [{ launched: true }], target = {};
  const character = { isPlayer: () => true, isNpc: () => false,
    getAsPlayer: () => ({ getPacketSender: () => ({ sendConfig() {} }) }),
    getMovementQueue: () => ({ reset() {} }), setMobileInteraction() {}, setPositionToFace() {},
    performAnimation: animation => animations.push(animation.getId()),
  };
  const combat = Object.assign(Object.create(Combat.prototype), { character, target, generation: 3, autoRetaliating: true,
    cycleState: { target }, specialAttackQueued: true, hitQueue: hits });
  Combat.prototype.reset.call(combat);
  assert.equal(combat.target, null); assert.equal(combat.generation, 4);
  assert.equal(combat.cycleState, null); assert.equal(combat.specialAttackQueued, false);
  assert.deepEqual(animations, [65535]); assert.deepEqual(hits, [{ launched: true }]);
  Combat.prototype.reset.call(combat);
  assert.equal(animations.length, 1, "unrelated reset does not cancel a skilling animation");
});

test("disconnecting before a pickpocket's outcome tick cancels it", () => {
  // The attempt message goes out on the click; the outcome lands on the next tick
  // (thieving-pickpocket.test.cjs). A player gone by then gets nothing.
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi(), tasks = [], npcHooks = {};
  registerFeedbackPlugin("skills/Thieving", { ...core,
    TaskManager: { submit(task) { task.setRunning(true); tasks.push(task); } },
    CombatFactory: { inCombat: () => false },
  }, {
    onNpcInteraction: (name, actions) => { npcHooks[name] = actions; },
    onNpcsInteraction: (names, actions) => { for (const name of names) npcHooks[name] = { ...npcHooks[name], ...actions }; },
  });
  const p = feedbackPlayer(core);
  p.getIndex = () => 1; p.getTimers = () => ({ has: () => false, getTicks: () => 0 });
  p.setPositionToFace = () => {}; p.getMovementQueue = () => ({ size: () => 0, reset() {} });
  p.getHitpoints = () => 10;
  p.skills = { getCurrentLevel: () => 99, addExperiences() { assert.fail("interrupted action awarded XP"); } };
  const npc = { getDefinition: () => ({ getName: () => "Man" }),
    getTimers: () => ({ registers() {} }), getLocation: p.getLocation, isRegistered: () => true };
  npcHooks.Man.Pickpocket({ player: p, npc, definition: npc.getDefinition() });
  const task = tasks.pop(); assert.ok(task);
  p.isRegistered = () => false;
  task.tick();
  assert.equal(task.isRunning(), false);
  assert.equal(p.counts.size, 0, "interrupted action produced no loot");
});

test("overworld implings spawn on the Wiki's 30-minute cycle, show after two minutes and stay caught", () => {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { H } = require("../plugins/skills/hunter/Context.Hunter");
  const Overworld = require("../plugins/skills/hunter/Overworld.Hunter");
  const spawns = [], removed = [];
  H.core = PluginManager.getCoreApi();
  H.api = { spawnNpc: def => { const npc = { def, setVisible(v) { npc.visible = v; } }; spawns.push(npc); return npc; }, removeNpc: npc => removed.push(npc) };
  H.tick = 1;
  Overworld.process();
  const crystal = spawns.filter(n => n.def.id === H.core.NpcIdentifiers.CRYSTAL_IMPLING);
  assert.equal(crystal.length, 1, "one crystal impling in Prifddinas");
  const others = spawns.length - 1;
  assert.ok(others >= 4 + 5 * 3 && others <= 4 + 10 * 3, "4 high + N mid + 2N low, N in 5-10");
  assert.ok(spawns.every(n => n.visible === false), "invisible while roaming");
  H.tick = 1 + Overworld.MANIFEST_TICKS;
  Overworld.process();
  assert.ok(spawns.every(n => n.visible === true), "visible after two minutes");
  const event = { npc: spawns[0], handled: false };
  Overworld.caught(event);
  assert.equal(event.handled, true);
  H.tick += 2;
  Overworld.process();
  assert.deepEqual(removed, [spawns[0]], "a caught impling is removed and not replaced");
  assert.equal(Overworld.caught({ npc: {}, handled: false }), undefined);
  H.tick = 1 + Overworld.CYCLE_TICKS;
  Overworld.process();
  assert.equal(removed.length, others + 1, "the next cycle despawns the old implings and spawns new ones");
  Overworld.clear();
});
