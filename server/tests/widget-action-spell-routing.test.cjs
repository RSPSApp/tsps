const assert = require("node:assert/strict");
const path = require("node:path");
const zlib = require("node:zlib");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { InterfaceActionClickOpcode } = require("../dist/net/packet/impl/InterfaceActionClickOpcode");
const { EffectSpells } = require("../dist/game/content/combat/magic/EffectSpells");

let core;
let playerIndex = 800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

function encodeMedium(value) {
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

test("spell metadata lookups share one cache scan", (t) => {
  let itemReads = 0;
  const getItem = core.CacheDefinitions.getItem.bind(core.CacheDefinitions);
  t.mock.method(core.CacheDefinitions, "getItem", (...args) => {
    itemReads++;
    return getItem(...args);
  });
  const spell = core.CacheDefinitions.getSpellByName("Bones to Bananas");
  assert.ok(spell);
  assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId, -1), "Bones to Bananas");
  assert.equal(core.CacheDefinitions.isSpellWidgetGroup(spell.widgetId >>> 16), true);
  assert.equal(itemReads, core.CacheDefinitions.getCounts().items);
  assert.deepEqual(core.CacheDefinitions.getSpellByName("  BONES TO BANANAS  "), spell);
  assert.equal(itemReads, core.CacheDefinitions.getCounts().items);
});

test("spell metadata lookups refresh after archived items are replaced", (t) => {
  const cache = CachePipeline.getActive();
  const originalCount = core.CacheDefinitions.getCounts().items;
  const widgetId = (0x7ffe << 16) | 1;
  const spellName = "Archive Regression Spell";
  const data = Buffer.from([
    249, 2,
    0, ...encodeMedium(596), (widgetId >>> 24) & 255, (widgetId >>> 16) & 255, (widgetId >>> 8) & 255, widgetId & 255,
    1, ...encodeMedium(601), ...Buffer.from(spellName + "\0", "ascii"),
    0,
  ]);
  const bundle = {
    id: "spell-metadata-regression",
    targetCache: { name: cache.name, game: "oldschool", revision: cache.revision },
    sourceCache: { name: cache.name, game: "oldschool", environment: "live", revision: cache.revision, timestamp: cache.timestamp, size: 0 },
    definitions: [{
      kind: "obj",
      symbol: "archive_regression_spell",
      sourceId: 0,
      id: originalCount,
      dataBase64: data.toString("base64"),
      crc: zlib.crc32(data),
    }],
  };
  t.after(() => {
    core.CacheDefinitions.registerDefinitionArchives([]);
    assert.equal(core.CacheDefinitions.getSpellByName(spellName), undefined);
  });

  assert.equal(core.CacheDefinitions.getSpellByName(spellName), undefined);
  assert.equal(core.CacheDefinitions.registerDefinitionArchives([bundle]).obj.includes(originalCount), true);
  const spell = core.CacheDefinitions.getSpellByName(spellName);
  assert.deepEqual(spell, { widgetId, itemId: originalCount });
  assert.equal(core.CacheDefinitions.getSpellName(widgetId, -1), spellName);
  assert.equal(core.CacheDefinitions.isSpellWidgetGroup(widgetId >>> 16), true);
});

function createPlayer(t) {
  const channel = {
    kind: "test",
    remoteAddress: "127.0.0.1",
    isOpen: () => true,
    send: () => true,
    close() {},
    onData() {},
    onError() {},
    onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(playerIndex++);
  player.setUsername(`spell-routing-${playerIndex}`);
  player.setRegistered(true);
  player.needsPlacement = false;
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
  });
  return { player, connection };
}

function addBonesSpellRunes(player) {
  for (const [id, amount] of [[526, 1], [561, 2], [555, 4], [557, 4]]) {
    player.getInventory().add(new core.Item(id, amount), false);
  }
}

async function sendWidgetAction(connection, packet) {
  await connection.dispatch([packet]);
  connection.processTurnPackets();
}

function offerWidgetAction(itemId) {
  return {
    type: "widget_action",
    widgetId: (465 << 16) | 7,
    groupId: 465,
    childId: 7,
    slot: 0,
    buttonNum: 1,
    itemId,
  };
}

test("Grand Exchange item actions cannot cast spells from colliding item ids", async (t) => {
  for (const [itemId, expectedName] of [
    [1159, "Mithril full helm"],
    [1162, "Adamant full helm"],
    [1168, "Leather cowl"],
    [1173, "Bronze sq shield"],
    [1178, "Steel sq shield"],
    [15877, "Bandos cloak"],
  ]) {
    const { player, connection } = createPlayer(t);
    addBonesSpellRunes(player);
    player.getInventory().add(new core.Item(itemId), false);
    assert.equal(core.CacheDefinitions.getItem(itemId).name, expectedName);

    await sendWidgetAction(connection, offerWidgetAction(itemId));

    assert.equal(player.getInventory().getAmount(526), 1, `${expectedName} must not cast a spell`);
    assert.equal(player.getInventory().getAmount(1963), 0);
    assert.equal(player.getInventory().getAmount(6883), 0);
  }
});

test("effect spell IDs cannot cast from non-spell widget groups", async (t) => {
  const { player, connection } = createPlayer(t);
  const effectSpellIds = [...EffectSpells.map.keys()].sort((left, right) => left - right);
  assert.ok(effectSpellIds.length > 0);
  const nonSpellGroups = [465, 149, 12, 300, 30004];
  const receivedSpellIds = [];
  t.mock.method(EffectSpells, "handleSpell", (_player, spellId) => {
    receivedSpellIds.push(spellId);
    return false;
  });
  t.mock.method(InterfaceActionClickOpcode, "handle", () => true);

  for (const groupId of nonSpellGroups) {
    for (const itemId of effectSpellIds) {
      await sendWidgetAction(connection, {
        type: "widget_action",
        widgetId: (groupId << 16) | 7,
        groupId,
        childId: 7,
        slot: -1,
        buttonNum: 1,
        itemId,
      });
    }
  }

  assert.equal(receivedSpellIds.length, nonSpellGroups.length * effectSpellIds.length);
  assert.ok(receivedSpellIds.every((spellId) => spellId === -1));
});

test("a spellbook self-cast still resolves its canonical spell name", async (t) => {
  const { player, connection } = createPlayer(t);
  addBonesSpellRunes(player);
  const spell = core.CacheDefinitions.getSpellByName("Bones to Bananas");
  assert.ok(spell);

  await sendWidgetAction(connection, {
    type: "widget_action",
    widgetId: spell.widgetId,
    groupId: spell.widgetId >>> 16,
    childId: spell.widgetId & 0xffff,
    slot: -1,
    buttonNum: 1,
    itemId: spell.itemId,
  });

  assert.equal(player.getInventory().getAmount(526), 0);
  assert.equal(player.getInventory().getAmount(1963), 1);
});

test("a widget-only spellbook self-cast resolves without an item id", async (t) => {
  const { player, connection } = createPlayer(t);
  addBonesSpellRunes(player);
  const spell = core.CacheDefinitions.getSpellByName("Bones to Bananas");
  assert.ok(spell);

  await sendWidgetAction(connection, {
    type: "widget_action",
    widgetId: spell.widgetId,
    groupId: spell.widgetId >>> 16,
    childId: spell.widgetId & 0xffff,
    slot: -1,
    buttonNum: 1,
  });

  assert.equal(player.getInventory().getAmount(526), 0);
  assert.equal(player.getInventory().getAmount(1963), 1);
});

test("non-effect spell metadata cannot route a colliding item id to an effect spell", async (t) => {
  const { connection } = createPlayer(t);
  const spell = core.CacheDefinitions.getSpellByName("Ice Barrage");
  const effectSpellIds = [];
  assert.ok(spell);
  assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId, -1), "Ice Barrage");
  t.mock.method(EffectSpells, "handleSpell", (_player, spellId) => {
    effectSpellIds.push(spellId);
    return false;
  });
  t.mock.method(InterfaceActionClickOpcode, "handle", () => true);

  await sendWidgetAction(connection, {
    type: "widget_action",
    widgetId: spell.widgetId,
    groupId: spell.widgetId >>> 16,
    childId: spell.widgetId & 0xffff,
    slot: -1,
    buttonNum: 1,
    itemId: 1159,
  });

  assert.deepEqual(effectSpellIds, [-1]);
});

test("spell widgets from each book remain eligible for canonical resolution", () => {
  for (const name of ["Bones to Bananas", "Ice Barrage", "Cure Me", "Resurrect Crops"]) {
    const spell = core.CacheDefinitions.getSpellByName(name);
    assert.ok(spell, `${name} must exist in the cache`);
    assert.equal(core.CacheDefinitions.isSpellWidgetGroup(spell.widgetId >>> 16), true, name);
    assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId, -1), name);
  }
});

test("Grand Exchange item actions fall through to the interface action handler", async (t) => {
  const { player, connection } = createPlayer(t);
  const received = [];
  t.mock.method(InterfaceActionClickOpcode, "handle", (...args) => {
    received.push(args);
    return true;
  });

  await sendWidgetAction(connection, offerWidgetAction(1159));

  assert.equal(received.length, 1);
  assert.equal(received[0][3].groupId, 465);
  assert.equal(received[0][3].itemId, 1159);
});

test("Bones to Bananas awards one cast of Magic XP regardless of plain bone count", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  PluginManager.loadFromDirectory(path.resolve(__dirname,"../plugins"));
  t.after(()=>PluginManager.emitServerShutdown({}));
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222,3218); PluginManager.emitServerStartup({});
  assert.equal(core.WorldDefinition.isMembersWorld(),true,"configured native members world");
  let index=6800;

    for (const count of [1, 3]) await t.test(`${count} plain bones`, async t => {
      const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
      const p=new Player(new PlayerSession(channel)); p.setIndex(index++); p.setUsername("bonesxp"+index);
      p.setRegistered(true); p.setLocation(new core.Location(3226,3218,0)); p.needsPlacement=false;
      const c=new ClientConnection(channel), inv=p.getInventory(), skill=p.getSkillManager(), magic=core.Skill.MAGIC; c.player=p;
      t.after(()=>{PluginManager.emitPlayerDisconnect({player:p,username:p.getUsername()});PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());core.TaskManager.cancelTasks(p);});
      const level=50, initial=core.SkillManager.getExperienceForLevel(level);
      skill.setCurrentLevel(magic,level,false).setMaxLevels(magic,level,false).setExperience(magic,initial);
      assert.equal(skill.getCurrentLevel(magic),level); assert.equal(skill.getMaxLevel(magic),level); assert.equal(skill.getExperience(magic),initial);
      assert.equal(core.SkillManager.getLevelForExperience(initial),level); assert.ok(p.getHitpoints()>0);
      assert.notEqual(p.getAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE),true);
      for(const [id,n] of [[526,count],[561,1],[555,2],[557,2]]) inv.add(new core.Item(id,n),false);
      for(const [id,n] of [[526,count],[561,1],[555,2],[557,2]]) { assert.equal(inv.getAmount(id),n); const def=core.ItemDefinition.forId(id); assert.ok(def.getName()); assert.equal(def.isNoted(),false); assert.notEqual(PluginManager.emitCanUseItem(p,id,"use"),false); }
      for(const [id,name] of [[526,"Bones"],[561,"Nature rune"],[555,"Water rune"],[557,"Earth rune"]]) assert.equal(core.ItemDefinition.forId(id).getName().toLowerCase(),name.toLowerCase());
      const boneSlots=inv.getItems().filter(item=>item?.getId()===526); assert.equal(boneSlots.length,count); assert.ok(boneSlots.every(item=>item.getAmount()===1 && item.getMeta()===null));
      assert.equal(inv.getAmount(1963),0);
      assert.equal(p.getEquipment().getItems().some(item=>item && item.getId()>0),false,"no equipped rune source");
      for(const id of [526,561,555,557]) {const slot=inv.getSlotForItemId(id); assert.ok(slot>=0); assert.equal(inv.getItems()[slot].getId(),id); assert.equal(inv.getItems()[slot].getMeta(),null);}
      const spell=core.CacheDefinitions.getSpellByName("Bones to Bananas"); assert.ok(spell);
      const Graveyard=require("../plugins/minigames/magetrainingarena/Graveyard.MageTrainingArena");
      assert.equal(Graveyard.inGraveyard(p.getLocation()),false,"ordinary cast is outside MTA Graveyard");
      assert.equal(p.getSpellbook(),core.MagicSpellbook.NORMAL);
      assert.equal(core.GameConstants.EXPERIENCE_MULTIPLIER,1,"declared native profile uses world XP rate 1");
      const calls=[], gates=[], events=[], drops=[], dispatches=[], add=skill.addExperiences.bind(skill);
      const dispatch=PluginManager.emitSpellCast.bind(PluginManager);
      t.mock.method(PluginManager,"emitSpellCast",event=>{const result=dispatch(event); if(event.player===p) dispatches.push({name:event.spellName,widget:event.spellWidget,item:event.spellItemId,op:event.opId,handled:result}); return result;});
      const sender=p.getPacketSender(), drop=sender.sendExpDrop.bind(sender);
      t.mock.method(sender,"sendExpDrop",(which,xp)=>{if(which===magic) drops.push(xp); return drop(which,xp);});
      const gate=PluginManager.emitCanGainExperience.bind(PluginManager), emit=PluginManager.emitCustomEvent.bind(PluginManager);
      t.mock.method(PluginManager,"emitCanGainExperience",(who,which,xp)=>{const result=gate(who,which,xp); if(who===p && which===magic) gates.push({xp,allow:result.allow,multiplier:result.multiplier}); return result;});
      t.mock.method(PluginManager,"emitCustomEvent",(name,event)=>{if(name==="skills:experience-gained" && event.player===p && event.skill===magic) events.push({experience:event.experience,multiplied:event.multiplied}); return emit(name,event);});
      t.mock.method(skill,"addExperiences",(which,xp)=>{calls.push({which,xp}); return add(which,xp);});
      let complete=false;
      t.after(()=>{if(!complete) console.error("BONES_XP_FAILURE",JSON.stringify({count,base:calls.map(x=>x.xp),gates,events,drops,stored:skill.getExperience(magic)-initial,rate:core.GameConstants.EXPERIENCE_MULTIPLIER}));});
      await c.dispatch([{type:"widget_action",widgetId:spell.widgetId,groupId:spell.widgetId>>>16,childId:spell.widgetId&0xffff,slot:-1,buttonNum:1,itemId:spell.itemId}]);
      c.processTurnPackets();
      assert.deepEqual(dispatches,[{name:"Bones to Bananas",widget:spell.widgetId,item:spell.itemId,op:1,handled:false}],"real decoded spell action reaches original plugin dispatcher");
      assert.equal(calls.length,1,"one decoded cast must reach the actual XP API once");
      assert.equal(calls[0].which,magic);
      assert.equal(gates.length,1); assert.notEqual(gates[0].allow,false); assert.equal(gates[0].multiplier,1);
      assert.equal(events.length,1,"the original XP event confirms XP landed before the target");
      assert.equal(calls[0].xp,25,"one cast requests 25 base Magic XP regardless of bones");
      assert.equal(inv.getAmount(526),0); assert.equal(inv.getAmount(1963),count);
      assert.equal(inv.getAmount(561),0); assert.equal(inv.getAmount(555),0); assert.equal(inv.getAmount(557),0);
      assert.equal(skill.getExperience(magic)-initial,25); assert.deepEqual(drops,[25]); assert.deepEqual(events,[{experience:25,multiplied:true}]);
      complete=true;
    });
  });
