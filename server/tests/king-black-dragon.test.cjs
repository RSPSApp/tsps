// Run with: node --test server/tests/king-black-dragon.test.cjs
// The King Black Dragon's own dragonfire table (Wiki Dragonfire/King_Black_Dragon).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { _test } = require("../plugins/bosses/KingBlackDragon.plugin");

const { breathMax, DragonfireProtectionTier: Tier } = _test;

const PROTECTION = {
  none: { shield: false, prayer: false, tier: Tier.NONE },
  shield: { shield: true, prayer: false, tier: Tier.NONE },
  prayer: { shield: false, prayer: true, tier: Tier.NONE },
  shieldPrayer: { shield: true, prayer: true, tier: Tier.NONE },
  antifire: { shield: false, prayer: false, tier: Tier.ANTIFIRE },
  superAntifire: { shield: false, prayer: false, tier: Tier.SUPER_ANTIFIRE },
  shieldAntifire: { shield: true, prayer: false, tier: Tier.ANTIFIRE },
  shieldSuperAntifire: { shield: true, prayer: false, tier: Tier.SUPER_ANTIFIRE },
  prayerAntifire: { shield: false, prayer: true, tier: Tier.ANTIFIRE },
  prayerSuperAntifire: { shield: false, prayer: true, tier: Tier.SUPER_ANTIFIRE },
  shieldPrayerAntifire: { shield: true, prayer: true, tier: Tier.ANTIFIRE },
  shieldPrayerSuperAntifire: { shield: true, prayer: true, tier: Tier.SUPER_ANTIFIRE },
};

const FIERY = {
  none: 65, shield: 15, prayer: 20, shieldPrayer: 15, antifire: 50, superAntifire: 0,
  shieldAntifire: 0, shieldSuperAntifire: 0, prayerAntifire: 5, prayerSuperAntifire: 0,
  shieldPrayerAntifire: 0, shieldPrayerSuperAntifire: 0,
};
const SPECIAL = {
  none: 50, shield: 10, prayer: 15, shieldPrayer: 10, antifire: 50, superAntifire: 50,
  shieldAntifire: 10, shieldSuperAntifire: 10, prayerAntifire: 15, prayerSuperAntifire: 15,
  shieldPrayerAntifire: 10, shieldPrayerSuperAntifire: 10,
};

test("fiery breath maxima match the Wiki table", () => {
  for (const [key, protection] of Object.entries(PROTECTION)) {
    assert.equal(breathMax(false, protection), FIERY[key], key);
  }
});

test("special breath maxima match the Wiki table", () => {
  for (const [key, protection] of Object.entries(PROTECTION)) {
    assert.equal(breathMax(true, protection), SPECIAL[key], key);
  }
});

// The way into the lair (ladder, spider room, lever) and its diary credit are covered in kbd-lair-arrival.test.cjs.

test('Echo KBD is the normal dragon in a private lair, configured once, cleaning pending hits', () => {
  const hooks={}, events=[], spawned=[], providers=[], levers=[];
  class PrivateArea {
    constructor() { this.entities=[]; }
    add(npc) { this.entities.push(npc); }
    enter(player) { player.area=this; }
    destroy() { this.destroyed=true; }
    postLeave() {}
  }
  const makeCombat=()=>({reset(){this.resetCount=(this.resetCount??0)+1;},getHitQueue(){return {clear:()=>{this.cleared=true;}};}});
  const api=new Proxy({
    core:{PrivateArea,Boundary:class{},Location:class{constructor(...args){this.args=args;}},CombatMethod:class{},CombatType:{MAGIC:1,MELEE:2},NpcIdentifiers:{KING_BLACK_DRAGON:239,KING_BLACK_DRAGON_2:2642,KING_BLACK_DRAGON_3:6502},Projectile:{centreOf:n=>n},
      // The spider room's lever, up (the real map's is checked in kbd-lair-arrival.test.cjs).
      MapObjects:{get:(id)=>id===1816?{id:1816}:null}},
    getPrayerHandler:()=>({}),getCombatFactory:()=>({}),
    registerNpcCombatMethodProvider:(ids,method)=>providers.push(method),
    onCustomEvent:(name,fn)=>{hooks[name]=fn;},onNpcDeath:fn=>{hooks.death=fn;},
    onPlayerLogout:fn=>{hooks.logout=fn;},
    spawnNpc:(options)=>{const combat=makeCombat();const npc={id:options.id,getCombat:()=>combat};spawned.push(npc);return npc;},
    // The lever's teleport lands at once here (Levers.plugin.js plays it in game).
    emitCustomEvent:(name,event)=>{events.push(name);if(name==='echo-boss:configure')event.configured=true;if(name==='echo-boss:claim')event.token='session-'+spawned.length;if(name==='lever:teleport'){levers.push(event);event.onArrival?.();}},
  },{get:(obj,key)=>obj[key]??(()=>{})});
  require('../plugins/bosses/KingBlackDragon.plugin').register(api);
  const normalProviders=providers.length;
  const makePlayer=()=>{const combat=makeCombat();return {setAttribute(){},moveTo(){},getCombat:()=>combat,sendMessage(){}};};
  const a=makePlayer(), b=makePlayer();
  hooks['echo-boss:start']({player:a,boss:'king-black-dragon'});
  hooks['echo-boss:start']({player:a,boss:'king-black-dragon'});
  hooks['echo-boss:start']({player:b,boss:'king-black-dragon'});
  assert.equal(spawned.length,2,'duplicate entry cannot spawn another dragon');
  assert.deepEqual(levers.map(l=>[l.player===b?'b':'a',...l.destination.args]),[['a',2271,4680,0],['b',2271,4680,0]],'each Echo entry pulls the lever into the lair, as the normal fight does');
  assert.deepEqual(levers.map(l=>[l.message?.spam,l.landed?.spam]),[["You pull the lever...","... and teleport into the Dragon's lair."],["You pull the lever...","... and teleport into the Dragon's lair."]],'with its recorded lines (rsprox_transcripts/242/900155.txt)');
  assert.ok(levers.every(l=>l.object?.id===1816),'the map\'s own lever is pulled');
  assert.notEqual(a.area,b.area);
  assert.deepEqual(spawned.map(npc=>npc.id),[239,239],'the normal King Black Dragon');
  assert.equal(providers.length,normalProviders,'Echo adds no controller of its own');
  assert.equal(events.filter(e=>e==='echo-boss:configure').length,2);
  hooks.death({npc:spawned[0]});hooks.death({npc:spawned[0]});
  assert.equal(events.filter(e=>e==='echo-boss:completed').length,1);
  hooks.logout({player:a});hooks.logout({player:a});
  assert.equal(a.getCombat().cleared,true);
  assert.equal(spawned[0].getCombat().cleared,true);
  assert.equal(a.area.destroyed,true);
  hooks.logout({player:b});
  assert.equal(events.filter(e=>e==='echo-boss:release').length,2);
});
