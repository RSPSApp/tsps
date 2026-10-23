/** Misthalin Mystery: OSRS Wiki and supplied live capture. See docs/misthalin-mystery.md. */
module.exports = function registerMisthalinMysteryQuest(api) {
  const { Skill, Location, Direction, ObjectDefinition, PrivateArea, Boundary, Animation, Graphic, CountdownTask, TaskManager, DialogueChainBuilder, ActionDialogue, StatementDialogue, GameObject, ObjectManager, Item, ItemOnGroundManager, Equipment, HitDamage, HitMask, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
  const { crossingFor } = require("../../objects/WallDoor.Doors");

  ObstacleRunner.init(api);

  const PAGE = "Misthalin Mystery";

  const ABIGALE_NPC_IDS = new Set([
    NpcIdentifiers.ABIGALE,
    NpcIdentifiers.ABIGALE_2,
    NpcIdentifiers.ABIGALE_3,
  ]);
  const HEWEY_NPC_IDS = new Set([NpcIdentifiers.HEWEY, NpcIdentifiers.HEWEY_2]);
  const KILLER_NPC_IDS = new Set([
    NpcIdentifiers.KILLER,
    NpcIdentifiers.KILLER_2,
    NpcIdentifiers.SHADY_FIGURE,
  ]);
  const MANDY_NPC_IDS = new Set([
    NpcIdentifiers.MANDY,
    NpcIdentifiers.MANDY_2,
    NpcIdentifiers.MANDY_3,
  ]);
  const SID_NPC_IDS = new Set([NpcIdentifiers.SID, NpcIdentifiers.SID_2]);
  const LACEY_NPC_ID = NpcIdentifiers.LACEY;
  const TAYTEN_NPC_ID = NpcIdentifiers.TAYTEN;
  const MANDY_NPC_ID = NpcIdentifiers.MANDY_2; // 7630, the survivor outside the manor.

  const VARP_MISTHALIN_MYSTERY = 1535;
  const STAGE_VARBIT = 3468;
  const CANDLES_ATTRIBUTE = "misthalin-mystery:candles";
  const PIANO_GROUP = 554, GEM_GROUP = 555, NOTES_GROUP = 70;
  const PIANO_BUTTONS = Array.from({length: 15}, (_,i) => (PIANO_GROUP<<16)|(20+i));
  const GEM_BUTTONS = new Map([[19,"Sapphire"],[3,"Diamond"],[11,"Zenyte"],[23,"Emerald"],[7,"Onyx"],[15,"Ruby"]]);
  const STAGE_STARTED = 5;
  const STAGE_BRIEFED = 10;
  const STAGE_SID_DEAD = 20;
  const STAGE_BUCKET_FILLED = 25;
  const STAGE_INSIDE_MANOR = 30;
  const STAGE_TAYTEN_DEAD = 35;
  const STAGE_NOTE1_READ = 40;
  const STAGE_PAINTING_SLASHED = 45;
  const STAGE_RUBY_ROOM_OPEN = 50;
  const STAGE_CANDLES_LIT = 55;
  const STAGE_FUSE_LIT = 60;
  const STAGE_WALL_BLOWN = 65;
  const STAGE_LACEY_DEAD = 70;
  const STAGE_NOTE2_READ = 75;
  const STAGE_PIANO_SOLVED = 80;
  const STAGE_EMERALD_ROOM_OPEN = 85;
  const STAGE_MANDY_DEAD = 90;
  const STAGE_NOTE3_READ = 95;
  const STAGE_PANEL_REVEALED = 100;
  const STAGE_GEM_PANEL_SOLVED = 105;
  const STAGE_SAPPHIRE_ROOM_OPEN = 110;
  const STAGE_BOSS_BEATEN = 115;
  const STAGE_HEWEY_DEAD = 120;
  const STAGE_ABIGALE_KILLED = 125;
  const STAGE_MANDY_WAITING = 130;
  const STAGE_COMPLETE = 135;

  const MANOR_KEY_ITEM_ID = ItemIdentifiers.MANOR_KEY_2; // 21052
  const RUBY_KEY_ITEM_ID = ItemIdentifiers.RUBY_KEY_2; // 21053
  const EMERALD_KEY_ITEM_ID = ItemIdentifiers.EMERALD_KEY_2; // 21054
  const SAPPHIRE_KEY_ITEM_ID = ItemIdentifiers.SAPPHIRE_KEY_2; // 21055
  const NOTE1_ITEM_ID = ItemIdentifiers.NOTES_5; // 21056, library note
  const NOTE2_ITEM_ID = ItemIdentifiers.NOTES_6; // 21057, outside note
  const NOTE3_ITEM_ID = ItemIdentifiers.NOTES_7; // 21058, kitchen note
  const KILLER_KNIFE_ITEM_ID = ItemIdentifiers.KILLERS_KNIFE_2; // 21059
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER;
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE;
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX;

  const COLOURED_KEY_ITEM_IDS = new Set([
    RUBY_KEY_ITEM_ID,
    EMERALD_KEY_ITEM_ID,
    SAPPHIRE_KEY_ITEM_ID,
  ]);

  const WATER_BARREL_LOC_IDS = new Set([
    ObjectIdentifiers.A_BARREL_OF_RAINWATER_2, // 30124
    ObjectIdentifiers.BARREL_138, // 30123, emptied barrel
  ]);
  const FRONT_DOOR_LOC_IDS = new Set([
    ObjectIdentifiers.LARGE_DOOR_94, // 30110
    ObjectIdentifiers.LARGE_DOOR_95, // 30111
  ]);
  const BOAT_LOC_IDS = new Set([
    ObjectIdentifiers.ROWBOAT_9, // 30108, Lumbridge shore
    ObjectIdentifiers.ROWBOAT_10, // 30109, island
  ]);
  const LOCKED_DOOR_LOC_IDS = new Set([
    ObjectIdentifiers.DOOR_555, // 30113, jade
    ObjectIdentifiers.DOOR_556, // 30114, opal
    ObjectIdentifiers.DOOR_557, // 30115, dragonstone
  ]);
  const PAINTING_LOC_IDS = new Set([
    ObjectIdentifiers.PAINTING_22, // 30125, unslashed
    ObjectIdentifiers.PAINTING_23, // 30126, slashed
  ]);
  const WRONG_PAINTING_LOC_IDS = new Set([
    ObjectIdentifiers.PAINTING_24,
    ObjectIdentifiers.PAINTING_25,
    ObjectIdentifiers.PAINTING_26,
    ObjectIdentifiers.PAINTING_27,
    ObjectIdentifiers.PORTRAIT_11,
  ]);
  const CANDLE_LOC_IDS = new Set([
    ObjectIdentifiers.UNLIT_CANDLE, // 30129
    ObjectIdentifiers.CANDLE_2, // 30130, lit
  ]);
  /**
   * The four candles share varp 1535 bits 8-11 (varbits 4039-4042), so lighting one
   * has to set its own varbit or the client keeps the unlit model. The placement id
   * is the only thing that tells the four apart; the resolved 30129/30130 ids are
   * shared.
   */
  const CANDLE_VARBIT_BY_PLACEMENT = new Map([
    [29652, 4039],
    [29653, 4040],
    [29654, 4041],
    [29655, 4042],
  ]);
  // 29659 resolves to 30136 unlit at stage90 and 30137 once revealed. 30138 is
  // the manor's decorative lit fireplaces, which are not the riddle.
  const FIREPLACE_LOC_IDS = new Set([
    ObjectIdentifiers.FIREPLACE_24, // 30136
    ObjectIdentifiers.FIREPLACE_25, // 30137
  ]);
  const PIANO_LOC_IDS = new Set([
    ObjectIdentifiers.PIANO_9, // 30134
    ObjectIdentifiers.PIANO_10, // 30135
  ]);
  const DAMAGED_WALL_LOC_IDS = new Set([
    ObjectIdentifiers.DAMAGED_WALL_4, // 30131, climbs at 1647/1648
    ObjectIdentifiers.DAMAGED_WALL_5,
    ObjectIdentifiers.DAMAGED_WALL_6,
  ]);
  const DOOR_KEY_BY_LOC = new Map([
    [ObjectIdentifiers.DOOR_558, RUBY_KEY_ITEM_ID], // 30116
    [ObjectIdentifiers.DOOR_559, EMERALD_KEY_ITEM_ID], // 30117
    [ObjectIdentifiers.DOOR_561, SAPPHIRE_KEY_ITEM_ID], // 30119
  ]);

  const NOTE_LINES = new Map([
    [
      NOTE1_ITEM_ID,
      [
        "Isn't murder just a work of art?",
        "Beautiful, yet haunting, like the blade of a knife.",
        "As we wander through the valley of death.",
      ],
    ],
    [
      NOTE2_ITEM_ID,
      ["It's like music to my ears!", "The glorious sounds, spelling out your fate!"],
    ],
    [
      NOTE3_ITEM_ID,
      [
        "Hear at first these words.",
        "Each murder you witness helplessly from start to end.",
        "As you fail to solve the final letters of this quiz.",
        "Razor sharp like a gemstone is the blade of my knife.",
        "The last sound you hear will be your scream's echo.",
        "Heed that I will have the final word in this thriller.",
      ],
    ],
  ]);
  const NOTE_READ_STAGES = new Map([
    [NOTE1_ITEM_ID, [STAGE_TAYTEN_DEAD, STAGE_NOTE1_READ]],
    [NOTE2_ITEM_ID, [STAGE_LACEY_DEAD, STAGE_NOTE2_READ]],
    [NOTE3_ITEM_ID, [STAGE_MANDY_DEAD, STAGE_NOTE3_READ]],
  ]);

  const PIANO_ORDER = ["D", "E", "A", "D"];
  const GEM_ORDER = ["Sapphire", "Diamond", "Zenyte", "Emerald", "Onyx", "Ruby"];


  let quest;
  const mandyByPlayer = new Map();
  const litCandlesByPlayer = new Map();
  const pianoProgressByPlayer = new Map();
  const puzzleOpen = new WeakMap();
  const gemProgressByPlayer = new Map();
  const doorKeyByPlayer = new WeakMap();
  const rowingPlayers = new WeakSet();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  /**
   * The manor's riddle scenery is placed as varbit-gated multi-loc bases (barrel 29649,
   * painting 29650, piano 29658, walls 29656/29657, fireplace 29659, notes 2266/2267/
   * 29648, candles 29652-29655) whose children are the 3012x/3013x ids below. Dispatch
   * on the player-resolved child, not the raw placement id.
   */
  const islands = new Map();
  const KNIFE_REACTION_NPC_ID = 7639; // cache invisible mistmyst knife target; capture carries its reaction text.
  const MIRROR_SCENERY_ID = 30143, EMPTY_MIRROR_SCENERY_ID = 30144;
  const CLOSED_WARDROBE_ID = 30141, OPEN_WARDROBE_ID = 30142;
  const MIRROR_ID = 7436; // cache mistmyst_mirror, 7640 inert / 7641 Push
  const KNIFE_PROJECTILE_ID = 214, WARDROBE_SHADOW_ID = 483;
  const ISLAND_ACTORS = [
    [NpcIdentifiers.SID,7430,1615,4832],[NpcIdentifiers.TAYTEN,7431,1639,4838],
    [NpcIdentifiers.LACEY,7432,1629,4850],[NpcIdentifiers.MANDY,7433,1626,4840],
    [NpcIdentifiers.SHADY_FIGURE,7435,1644,4819],[MIRROR_ID,MIRROR_ID,1622,4828],
  ];
  const WARDROBES = [[1622,4834,1],[1627,4831,2],[1624,4825,3],[1619,4828,0]];
  function later(key,ticks,fn) { TaskManager.submit(new CountdownTask(key,ticks,fn)); }
  function controls(player,active,reset=true) {
    player.getMovementQueue().reset().setBlockMovement(active);player.setUntargetable(active);
    player.getPacketSender().sendVarbit(12393,active?1:0).sendVarbit(6719,active?2:0);
    if(!active&&reset)player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
  }
  function camera(player,position,look,rate=232,rate2=rate) {
    const options={rate,rate2,heightRelative:false};
    if(position)player.getPacketSender().sendCameraMoveTo(...position,options);
    if(look)player.getPacketSender().sendCameraLookAt(...look,options);
  }
  function freezeScene(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0,{execute:()=>StatementDialogue.send(player,"",false)})));
  }
  function playScene(player,area,anchor) {
    const scene=SCENES[area.scene];
    startTranscript(api,player,scene.npc,PAGE,scene.variant,steps=>{
      const visible=steps.filter(step=>step.type!=="unavailable");
      return anchor?visible.slice(visible.findIndex(step=>step.id===anchor||step.text===anchor||step.player===anchor)+1):visible;
    });
  }
  function pauseScene(event,ticks) {
    const {player}=event,area=island(player),name=area.scene,anchor=event.stepId??event.text;
    freezeScene(player);event.handled=true;
    later(area.cameraKey,ticks,()=>{if(area.scene===name)playScene(player,area,anchor);});
  }
  function protectScene(event) {
    // World input otherwise clears the dialogue before blocked movement rejects it.
    if(island(event.player)?.scene||rowingPlayers.has(event.player))event.handled=true;
  }
  class Manor extends PrivateArea {
    constructor(player){super([new Boundary(1600,1663,4792,4863,0)]);this.owner=player;this.actors=new Map();this.scene=null;this.fighting=false;this.reflections=0;this.pushing=false;}
    canTeleport(){return !this.scene&&!this.fighting;}
    canAttack(){return false;}
    process(actor){
      if(actor!==this.owner||this.scene)return;
      const at=actor.getLocation(),stage=quest.getStage(actor);
      if((stage===STAGE_BRIEFED||stage===15)&&at.getX()<=1618&&at.getY()>=4827){quest.setStage(actor,15);murderScene(actor,"sid");}
      if(stage===STAGE_SAPPHIRE_ROOM_OPEN&&at.getX()<=1627&&at.getX()>=1620&&at.getY()>=4826&&at.getY()<=4833)murderScene(actor,"intro");
      if(stage===STAGE_WALL_BLOWN&&at.getY()>=4847&&at.getX()<=1636)murderScene(actor,"lacey");
      if(stage===STAGE_FUSE_LIT&&at.getX()<=1640&&!this.exploding)explodeWall(this);
    }
    postLeave(actor,logout){
      if(actor===this.owner){TaskManager.cancelTasks(this);if(this.cameraKey)TaskManager.cancelTasks(this.cameraKey);if(this.resetKey)TaskManager.cancelTasks(this.resetKey);islands.delete(actor);const mandy=mandyByPlayer.get(actor);if(mandy)api.removeNpc(mandy);mandyByPlayer.delete(actor);if(!rowingPlayers.has(actor)){controls(actor,false);actor.getPacketSender().sendInterfaceRemoval();}}
      super.postLeave(actor,logout);
    }
    destroy(){if(this.isDestroyed())return;for(const npc of this.actors.values())api.removeNpc(npc);super.destroy();}
  }
  function explodeWall(area){
    area.exploding=true;const player=area.owner;
    later(area,1,()=>player.getPacketSender().sendSubInterface((161<<16)|1,174,1,{postScripts:[{scriptId:948,args:[0,255,0,0,50]}]}));
    later(area,2,()=>{controls(player,true);player.getPacketSender().sendCameraShake(4,4,0,1);});
    later(area,4,()=>{
      quest.setStage(player,STAGE_WALL_BLOWN);player.getPacketSender().sendSoundEffect(1487,1,0).sendSubInterface((161<<16)|1,174,1,{postScripts:[{scriptId:948,args:[0,0,0,255,50]}]});
    });
    later(area,5,()=>{controls(player,false);player.getPacketSender().sendCameraShake(4,0).closeSubInterface((161<<16)|1);});
  }
  function island(player){return islands.get(player)??null;}
  function spawnActor(area,key,id,x,y){
    const old=area.actors.get(key);if(old)api.removeNpc(old);
    const npc=api.spawnNpc({id,x,y,z:0,owner:area.owner,ownerOnly:true,wanderRadius:0});
    if(npc){area.enter(npc);area.actors.set(key,npc);}return npc;
  }
  function enterIsland(player){
    let area=island(player);if(area)return area;
    area=new Manor(player);islands.set(player,area);area.enter(player);
    for(const [key,id,x,y] of ISLAND_ACTORS)spawnActor(area,key,id,x,y);
    if(quest.getStage(player)>=STAGE_HEWEY_DEAD&&quest.getStage(player)<STAGE_MANDY_WAITING){
      spawnActor(area,NpcIdentifiers.ABIGALE_3,NpcIdentifiers.ABIGALE_3,1623,4831);
      spawnActor(area,NpcIdentifiers.HEWEY_2,NpcIdentifiers.HEWEY_2,1624,4831);
      dropKillerKnife(player);
    }
    ensureMandy(player);return area;
  }
  const SCENES={
    sid:{variant:"arriving-to-the-manor-sid-s-demise",npc:NpcIdentifiers.SID,tile:[1615,4828],camera:[1614,4826,300],look:[1616,4831,275],delay:1},
    tayten:{variant:"arriving-to-the-manor-tayten-s-demise",npc:NpcIdentifiers.TAYTEN,tile:[1635,4838],camera:[1634,4841,1250],look:[1637,4838,250],delay:12},
    lacey:{variant:"the-second-riddle-run-in-with-lacey",npc:LACEY_NPC_ID,tile:[1631,4849],camera:[1625,4847,375],look:[1632,4850,375]},
    mandy:{variant:"the-third-riddle-mandy-in-the-kitchen",npc:NpcIdentifiers.MANDY,tile:[1630,4840],camera:[1634,4848,1400],look:[1627,4840,250],delay:4},
    intro:{variant:"showdown-confronting-the-killer",npc:NpcIdentifiers.KILLER,tile:[1625,4827],camera:[1619,4824,1250],look:[1623,4830,300],delay:6},
    reveal:{variant:"showdown-defeating-the-killer",npc:NpcIdentifiers.KILLER,tile:[1622,4830],camera:[1619,4824,1250],look:[1623,4830,300],delay:6},
    rescue:{variant:"showdown-leaving-the-manor",npc:NpcIdentifiers.MANDY,tile:[1625,4827],camera:[1620,4826,1300],look:[1626,4833,150],delay:7},
  };
  function murderScene(player,name){
    const area=enterIsland(player);if(area.scene)return;
    if(area.resetKey)TaskManager.cancelTasks(area.resetKey);
    area.scene=name;area.cameraKey={};controls(player,true);const scene=SCENES[name];
    for(let axis=0;axis<5;axis++)player.getPacketSender().sendCameraShake(axis,0,0,0);
    player.moveTo(new Location(...scene.tile,0));camera(player,scene.camera,scene.look);
    if(name==="sid")spawnActor(area,NpcIdentifiers.KILLER,NpcIdentifiers.KILLER_2,1619,4835);
    if(name==="tayten"){
      area.actors.get(NpcIdentifiers.TAYTEN)?.setPositionToFace(new Location(1640,4838,0));
      later(area.cameraKey,4,()=>{
        const killer=spawnActor(area,NpcIdentifiers.KILLER,NpcIdentifiers.KILLER_2,1637,4836);
        killer?.setPositionToFace(new Location(1637,4837,0));
        ObjectManager.register(new GameObject(ObjectIdentifiers.WARDROBE_5,new Location(1637,4835,0),10,3,area),true);
      });
      later(area.cameraKey,7,()=>area.actors.get(NpcIdentifiers.KILLER)?.getMovementQueue().addSteps(new Location(1638,4838,0)));
      later(area.cameraKey,8,()=>ObjectManager.register(new GameObject(ObjectIdentifiers.WARDROBE_4,new Location(1637,4835,0),10,3,area),true));
      later(area.cameraKey,10,()=>{
        const killer=area.actors.get(NpcIdentifiers.KILLER);
        killer?.setPositionToFace(new Location(1639,4838,0));killer?.performAnimation(new Animation(7328));
      });
    }
    if(name==="lacey")spawnActor(area,NpcIdentifiers.KILLER,NpcIdentifiers.KILLER,1630,4850);
    if(name==="mandy")spawnActor(area,NpcIdentifiers.KILLER,NpcIdentifiers.KILLER,1625,4840);
    if(name==="intro")spawnActor(area,NpcIdentifiers.KILLER,NpcIdentifiers.KILLER,1623,4831);
    if(name==="reveal"){
      const mirror=area.actors.get(MIRROR_ID);if(mirror){mirrorScenery(area,mirror.getLocation(),false);mirror.moveTo(new Location(1622,4828,0));mirror.setNpcTransformationId(7640);mirrorScenery(area,mirror.getLocation(),true);}
      const reaction=area.actors.get(KNIFE_REACTION_NPC_ID);later(area,2,()=>{if(reaction)api.removeNpc(reaction);area.actors.delete(KNIFE_REACTION_NPC_ID);});
      spawnActor(area,NpcIdentifiers.KILLER,NpcIdentifiers.KILLER,1623,4831);
    }
    if(scene.delay){freezeScene(player);later(area.cameraKey,scene.delay,()=>playScene(player,area));}
    else playScene(player,area);
  }
  function endMurder(player,stage){
    const area=island(player);if(!area)return;
    const victimKey={sid:NpcIdentifiers.SID,tayten:NpcIdentifiers.TAYTEN}[area.scene];
    const resetDelay={sid:3,tayten:2,lacey:2,mandy:2,intro:11,reveal:2,rescue:2}[area.scene];
    if(["sid","tayten","lacey","mandy"].includes(area.scene)){
      const killer=area.actors.get(NpcIdentifiers.KILLER);if(killer)api.removeNpc(killer);area.actors.delete(NpcIdentifiers.KILLER);
    }
    if(area.cameraKey)TaskManager.cancelTasks(area.cameraKey);
    area.scene=null;if(stage!==undefined&&quest.getStage(player)<stage)quest.setStage(player,stage);
    controls(player,false,false);
    if(resetDelay){area.resetKey={};later(area.resetKey,resetDelay,()=>{
      if(victimKey!==undefined){const victim=area.actors.get(victimKey);if(victim)api.removeNpc(victim);area.actors.delete(victimKey);}
      player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
    });}
    if(stage===STAGE_MANDY_WAITING){const actor=area.actors.get(NpcIdentifiers.MANDY);if(actor)api.removeNpc(actor);area.actors.delete(NpcIdentifiers.MANDY);ensureMandy(player);}
  }
  function wardrobe(area,where,open){ObjectManager.register(new GameObject(open?OPEN_WARDROBE_ID:CLOSED_WARDROBE_ID,new Location(where[0],where[1],0),10,where[2],area),true);}
  function mirrorScenery(area,at,visible){ObjectManager.register(new GameObject(visible?MIRROR_SCENERY_ID:EMPTY_MIRROR_SCENERY_ID,at,10,0,area),true);}
  function startMirrorFight(player){
    const area=island(player);if(!area)return;endMurder(player,111);area.fighting=true;area.reflections=0;
    const killer=area.actors.get(NpcIdentifiers.KILLER);if(killer){api.removeNpc(killer);area.actors.delete(NpcIdentifiers.KILLER);}
    const mirror=area.actors.get(MIRROR_ID);if(mirror)mirror.setNpcTransformationId(7641);
    area.mirrorDirection=[0,-1];
    spawnActor(area,KNIFE_REACTION_NPC_ID,KNIFE_REACTION_NPC_ID,1623,4829);
    mirrorScenery(area,new Location(1622,4823,0),false);if(mirror)mirrorScenery(area,mirror.getLocation(),true);
    // The first warning follows the intro's 11-tick camera reset by 10 ticks.
    later(area,21,()=>shadow(area));
  }
  function shadow(area){
    if(!area.fighting||area.isDestroyed())return;
    area.warning=WARDROBES[Math.floor(Math.random()*WARDROBES.length)];
    const graphic=new Graphic(WARDROBE_SHADOW_ID);
    graphic.height=1; // The three-argument constructor interprets 1 as Priority.MEDIUM.
    area.owner.getPacketSender().sendGraphic(graphic,new Location(area.warning[0],area.warning[1],0));
    later(area,14,()=>throwKnife(area));
  }
  function throwKnife(area){
    if(!area.fighting)return;
    const player=area.owner,where=area.warning,mirror=area.actors.get(MIRROR_ID),at=mirror?.getLocation();if(!at)return;
    wardrobe(area,where,true);
    const source=new Location(where[0],where[1],0);
    const opposite=new Location(where[0]===1627?1619:where[0]===1619?1627:where[0],where[1]===4834?4825:where[1]===4825?4834:where[1],0);
    const aligned=where[0]===at.getX()||where[1]===at.getY();
    const dx=Math.sign(where[0]-at.getX()),dy=Math.sign(where[1]-at.getY());
    const reflects=aligned&&area.mirrorDirection[0]===dx&&area.mirrorDirection[1]===dy;
    const target=aligned?at:opposite,distance=Math.max(Math.abs(source.getX()-target.getX()),Math.abs(source.getY()-target.getY()));
    // Rsprox V2 heights are world units; the legacy sender multiplies its height arguments by four.
    player.getPacketSender().sendProjectile(source,target,0,41+distance*5+(aligned?5:0),KNIFE_PROJECTILE_ID,163/4,146/4,aligned?mirror:null,41,15,11);
    if(aligned)player.getPacketSender().sendProjectile(at,reflects?source:new Location(1619,4832,0),0,82+(reflects?distance*10+10:90),KNIFE_PROJECTILE_ID,163/4,146/4,null,82,15,11);
    player.getPacketSender().sendSoundEffect(2707,1,0);
    const reaction=area.actors.get(KNIFE_REACTION_NPC_ID);if(reflects)later(area,1,()=>reaction?.moveTo(source));
    later(area,4,()=>{
      wardrobe(area,where,false);
      if(reflects){
        area.reflections++;reaction?.forceChat(area.reflections===2?"Aaaargh!":"Ow!");player.getPacketSender().sendSoundEffect(510,1,0);
        // The invisible cache target has40HP; three10-damage returns leave it alive.
        later(area,1,()=>reaction?.getCombat().getHitQueue().addPendingDamage([new HitDamage(10,HitMask.RED).setSplatTypes(17,17)]));
      }
      if(area.reflections>=3){area.fighting=false;quest.setStage(player,STAGE_BOSS_BEATEN);murderScene(player,"reveal");}
      else later(area,1,()=>shadow(area));
    });
  }
  function pushMirror(event){
    const area=island(event.player);if(!area?.fighting||event.npc!==area.actors.get(MIRROR_ID))return false;
    if(area.pushing)return true;
    const player=event.player,mirror=event.npc,at=mirror.getLocation(),p=player.getLocation();
    let dx=Math.sign(at.getX()-p.getX()),dy=Math.sign(at.getY()-p.getY());
    if(Math.abs(at.getX()-p.getX())>Math.abs(at.getY()-p.getY()))dy=0;else dx=0;
    if(dx===0&&dy===0)return true;
    const to=new Location(at.getX()+dx,at.getY()+dy,0);
    // Keep the mirror within the captured push limits inside the wardrobe room.
    if(to.getX()<1622||to.getX()>1624||to.getY()<4828||to.getY()>4831){player.sendMessage("The mirror can't go any further in that direction.");return true;}
    area.pushing=true;player.performAnimation(new Animation(3065));
    later(area,1,()=>{
      mirrorScenery(area,at,false);mirror.moveTo(to);mirrorScenery(area,to,true);
      area.mirrorDirection=[dx,dy];
      mirror.setFace(Direction.fromDeltas(dx,dy));mirror.faceTile(new Location(to.getX()+dx,to.getY()+dy,0));
      player.getPacketSender().sendSoundEffect(1395,1,0);player.moveTo(at.clone());
    });
    later(area,2,()=>{area.pushing=false;player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);});return true;
  }
  function dropKillerKnife(player){
    const area=island(player);if(!area||area.knifeDropped||held(player,KILLER_KNIFE_ITEM_ID)||player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId()===KILLER_KNIFE_ITEM_ID)return;
    area.knifeDropped=true;ItemOnGroundManager.registerLocation(player,new Item(KILLER_KNIFE_ITEM_ID,1),new Location(1624,4830,0));
  }
  function fightAbigale(event){
    const {player}=event;if(quest.getStage(player)!==STAGE_HEWEY_DEAD)return false;
    const weapon=player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId()??-1;
    const variant=weapon===KILLER_KNIFE_ITEM_ID?"showdown-fighting-abigale-fight-abigale-while-wielding-the-killer-s-knife":weapon<0?"showdown-fighting-abigale-attempt-to-fight-abigale-without-wielding-a-weapon":"showdown-fighting-abigale-attempt-to-fight-abigale-while-wielding-other-weapons";
    startTranscript(api,player,NpcIdentifiers.KILLER,PAGE,variant);return true;
  }
  function sceneLine(event){
    const {player,text}=event,area=island(player);
    if((ABIGALE_NPC_IDS.has(event.npcId)||HEWEY_NPC_IDS.has(event.npcId))&&text==="Okay, I'll see what I can do.")event.before=()=>{if(quest.getStage(player)===STAGE_STARTED)quest.setStage(player,STAGE_BRIEFED);};
    if(text.includes("You need [3 more spaces/2 more spaces/another space]")){
      const missing=3-freeSlots(player);event.text=text.replace("[3 more spaces/2 more spaces/another space]",missing===1?"another space":`${missing} more spaces`);
    }
    if(!area)return;
    if(area.scene==="sid"){
      if(event.step?.speaker==="Killer")event.speakerId=NpcIdentifiers.KILLER_2;
      if(event.step?.speaker==="Sid"&&!["Woo, party on bro!","Woah, that wind totally just felt like someone breathing on my neck!"].includes(text))event.speakerId=NpcIdentifiers.SID_2;
    }
    if(area.scene==="sid"&&text==="Woo, party on bro!")event.before=()=>{
      camera(player,[1614,4826,300],null,10,15);camera(player,null,[1616,4831,275],20,20);
    };
    if(area.scene==="tayten"&&text==="Nooooo!")event.before=()=>area.actors.get(NpcIdentifiers.TAYTEN)?.performAnimation(new Animation(836));
    if(area.scene==="reveal"&&text==="What!? How!? There was another killer!?")event.after=()=>{
      pauseScene(event,5);later(area.cameraKey,1,()=>camera(player,null,[1624,4831,275],5));
    };
    const endings={sid:["I wonder what it was that I saw fall into that barrel?",STAGE_SID_DEAD],tayten:["What's this? A note? I guess I should read it.",STAGE_TAYTEN_DEAD],lacey:["That monster! I have to stop them! Let's see what that new note says.",STAGE_LACEY_DEAD],mandy:["Another note. This guy really likes playing games, but this is going to be a game he won't win!",STAGE_MANDY_DEAD]};
    const ending=endings[area.scene];if(ending&&text===ending[0])event.after=()=>endMurder(player,ending[1]);
    if(area.scene==="intro"&&text.startsWith("So, this is the end of the line for you."))event.after=()=>startMirrorFight(player);
    if(area.scene==="reveal"&&text==="This could be my chance to take advantage of the situation...")event.after=()=>endMurder(player,STAGE_HEWEY_DEAD);
    if(text==="Well thank Saradomin that's over! I should get out of here.")event.after=()=>endMurder(player,STAGE_ABIGALE_KILLED);
  }
  function sceneAction(event){
    const area=island(event.player);if(!area)return false;
    const {player,stepId}=event;
    const killer=area.actors.get(NpcIdentifiers.KILLER),victim=area.actors.get(area.scene==="sid"?NpcIdentifiers.SID:area.scene==="tayten"?NpcIdentifiers.TAYTEN:area.scene==="lacey"?NpcIdentifiers.LACEY:NpcIdentifiers.MANDY);
    if(stepId==="ZjjuVp"){
      killer?.getMovementQueue().addSteps(new Location(1618,4835,0));killer?.getMovementQueue().addSteps(new Location(1615,4833,0));
      pauseScene(event,7);later(area.cameraKey,6,()=>killer?.setPositionToFace(new Location(1615,4832,0)));return true;
    }
    if(stepId==="ScleeY"){
      killer?.performAnimation(new Animation(7328));later(area.cameraKey,1,()=>victim?.setNpcTransformationId(NpcIdentifiers.SID_2));
    }
    if(stepId==="hRO-iS"){
      victim?.getMovementQueue().addSteps(new Location(1615,4830,0));
      camera(player,[1618,4836,500],[1615,4832,500],10);pauseScene(event,4);return true;
    }
    if(stepId==="yX2amu")victim?.performAnimation(new Animation(836));
    if(stepId==="sbWPCY"){
      killer?.getMovementQueue().addSteps(new Location(1615,4837,0));pauseScene(event,7);
      later(area.cameraKey,7,()=>{if(killer)api.removeNpc(killer);area.actors.delete(NpcIdentifiers.KILLER);quest.setStage(player,STAGE_SID_DEAD);});return true;
    }
    if(stepId==="qIQhiW"){
      pauseScene(event,16);
      later(area.cameraKey,3,()=>killer?.getMovementQueue().addSteps(new Location(1636,4838,0)));
      later(area.cameraKey,6,()=>killer?.performAnimation(new Animation(827)));
      later(area.cameraKey,9,()=>{killer?.getMovementQueue().addSteps(new Location(1637,4837,0));killer?.getMovementQueue().addSteps(new Location(1637,4836,0));});
      later(area.cameraKey,12,()=>{killer?.performAnimation(new Animation(545));killer?.setPositionToFace(new Location(1637,4835,0));});
      later(area.cameraKey,13,()=>{killer?.performAnimation(new Animation(828));ObjectManager.register(new GameObject(ObjectIdentifiers.WARDROBE_5,new Location(1637,4835,0),10,3,area),true);});
      later(area.cameraKey,14,()=>{if(killer)api.removeNpc(killer);area.actors.delete(NpcIdentifiers.KILLER);});
      later(area.cameraKey,16,()=>quest.setStage(player,STAGE_TAYTEN_DEAD));
      later(area,17,()=>ObjectManager.register(new GameObject(ObjectIdentifiers.WARDROBE_4,new Location(1637,4835,0),10,3,area),true));return true;
    }
    if(stepId==="juop9h"){camera(player,[1622,4837,1400],[1627,4840,250],10);pauseScene(event,8);return true;}
    if(stepId==="Eh_VF5"){
      pauseScene(event,16);later(area.cameraKey,14,()=>camera(player,[1634,4848,1400],[1627,4840,250],10));return true;
    }
    if(["HVer_D","8gRjEC","-ARK2C"].includes(stepId)){killer?.setPositionToFace(victim.getLocation());killer?.performAnimation(new Animation(7328));victim?.performAnimation(new Animation(836));}
    if(stepId==="EaQMnJ"){killer?.setNpcTransformationId(NpcIdentifiers.ABIGALE_2);area.actors.set(NpcIdentifiers.ABIGALE_3,killer);}
    if(stepId==="ib3C6A"){
      spawnActor(area,NpcIdentifiers.KILLER_2,NpcIdentifiers.KILLER_2,1625,4831);
      pauseScene(event,5);later(area.cameraKey,3,()=>camera(player,[1622,4828,300],[1627,4831,275],5));return true;
    }
    if(stepId==="Zo5pdP")area.actors.get(NpcIdentifiers.KILLER_2)?.setNpcTransformationId(NpcIdentifiers.HEWEY_2);
    if(stepId==="8gRhnK"){killer?.performAnimation(new Animation(7328));area.actors.get(NpcIdentifiers.KILLER_2)?.performAnimation(new Animation(836));}
    if(stepId==="YSPZnz"){dropKillerKnife(player);killer?.setNpcTransformationId(NpcIdentifiers.ABIGALE_3);event.handled=true;return true;}
    if(stepId==="DWcgf8"){player.performAnimation(new Animation(7328));area.actors.get(NpcIdentifiers.ABIGALE_3)?.performAnimation(new Animation(836));event.handled=true;return true;}
    if(stepId==="zuIzHC")spawnActor(area,NpcIdentifiers.MANDY,NpcIdentifiers.MANDY,1627,4839);
    if(stepId==="InRnIQ")area.actors.get(NpcIdentifiers.MANDY)?.getMovementQueue().addSteps(new Location(1627,4843,0));
    if(stepId==="93tvkK"){
      const mandy=area.actors.get(NpcIdentifiers.MANDY);mandy?.performAnimation(new Animation(832));
      later(area,2,()=>{mandy?.performAnimation(new Animation(828));mandy?.setNpcTransformationId(NpcIdentifiers.MANDY_3);});
    }
    if(stepId==="grfbWR"){
      const mandy=area.actors.get(NpcIdentifiers.MANDY);mandy?.moveTo(new Location(1622,4833,0));mandy?.getMovementQueue().addSteps(new Location(1623,4832,0));
    }
    if(stepId==="g0BaZV"){area.actors.get(NpcIdentifiers.MANDY)?.performAnimation(new Animation(7642));area.actors.get(NpcIdentifiers.MANDY)?.performGraphic(new Graphic(1212));area.actors.get(NpcIdentifiers.ABIGALE_3)?.performAnimation(new Animation(836));}
    if(stepId==="zBqqmI"){event.handled=true;return true;}
    if(stepId==="JzkmeZ"){
      if(held(player,KILLER_KNIFE_ITEM_ID))player.getInventory().deleteNumber(KILLER_KNIFE_ITEM_ID,1);
      if(player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId()===KILLER_KNIFE_ITEM_ID)player.getEquipment().deleteNumber(KILLER_KNIFE_ITEM_ID,1);
      endMurder(player,STAGE_MANDY_WAITING);event.box={statement:true};return true;
    }
    return false;
  }

  function resolvedObjectId(event) {
    if (event.definition?.id != null) return event.definition.id;
    if (event.object) {
      const definition = ObjectDefinition.forPlayer(event.object.getId(), event.player);
      if (definition) return definition.id;
    }
    return event.objectId;
  }

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function grantItem(player, itemId) {
    if (held(player, itemId)) return;
    if (freeSlots(player) < 1) return;
    player.getInventory().adds(itemId, 1);
  }

  function hasAnyColouredKey(player) {
    for (const key of COLOURED_KEY_ITEM_IDS) {
      if (held(player, key)) return true;
    }
    return false;
  }

  function hasAnyNote(player) {
    return (
      held(player, NOTE1_ITEM_ID) || held(player, NOTE2_ITEM_ID) || held(player, NOTE3_ITEM_ID)
    );
  }

  /** Cross the edge blocked by the door's face, between its tile and its neighbour. */
  function crossDoor(event) {
    const { player, object } = event;
    if (ObstacleRunner.isBusy(player)) return;
    const position = player.getLocation();
    const crossing = crossingFor(object, position);
    if (!crossing || !Location.isSameTile(position, crossing.approach)) return;
    ObstacleRunner.run(event, [{ wait: 1 }, { walk: [[crossing.destination.x, crossing.destination.y]] }]);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Abigale</col>",
        "by the shore in <col=800000>Lumbridge Swamp</col>.",
        "",
        "There are no requirements for this quest.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Abigale and her friends were attacked in a manor on an island off</str>",
        "<str>the coast of Lumbridge Swamp.</str>",
        "<str>I took the boat to the island and solved the killer's riddles.</str>",
        "<str>I unmasked Abigale and Hewey and helped Mandy defeat them.</str>",
        "",
        "I was rewarded with an <col=800000>uncut ruby</col>, an <col=800000>uncut emerald</col>",
        "and an <col=800000>uncut sapphire</col>, plus <col=800000>600 Crafting XP</col>.",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    const lines = [
      "<str>Abigale and her friends were attacked in a manor on an island</str>",
      "<str>off the coast of Lumbridge Swamp.</str>",
      "",
    ];
    if (stage < STAGE_SID_DEAD) {
      lines.push("I agreed to take the <col=800000>boat</col> from the south-eastern shore to the island.");
      return lines;
    }
    lines.push("<str>I saw the killer murder Sid at the water barrel.</str>");
    if (stage < STAGE_INSIDE_MANOR) {
      lines.push("I need to find a way into the <col=800000>manor</col>.");
      return lines;
    }
    lines.push("<str>I entered the manor and found the first clues left by the killer.</str>");
    if (stage < STAGE_WALL_BLOWN) {
      lines.push("I must solve the <col=800000>riddles</col> hidden around the manor.");
      return lines;
    }
    lines.push("<str>I followed the killer's clues through the manor.</str>");
    if (stage < STAGE_HEWEY_DEAD) {
      lines.push("I must confront the <col=800000>killer</col> in the sapphire room.");
      return lines;
    }
    lines.push("<str>The killer was Abigale, helped by Hewey. Hewey is dead.</str>");
    if (stage < STAGE_MANDY_WAITING) {
      lines.push("I should take Hewey's <col=800000>knife</col> and defeat Abigale.");
      return lines;
    }
    lines.push("<str>With Mandy's help I defeated Abigale and Hewey.</str>");
    lines.push("I should meet <col=800000>Mandy</col> outside the manor.");
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 600);
    player.getInventory().adds(ItemIdentifiers.UNCUT_RUBY, 1);
    player.getInventory().adds(ItemIdentifiers.UNCUT_EMERALD, 1);
    player.getInventory().adds(ItemIdentifiers.UNCUT_SAPPHIRE, 1);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (ABIGALE_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HEWEY_DEAD) return "showdown-defeating-the-killer";
      if (stage >= STAGE_BRIEFED) {
        return "starting-out-talking-to-abigale-or-hewey-talking-to-abigale-or-hewey-again";
      }
      return "starting-out-talking-to-abigale-or-hewey";
    }
    if (HEWEY_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HEWEY_DEAD) return "showdown-defeating-the-killer";
      if (stage >= STAGE_BRIEFED) {
        return "starting-out-talking-to-abigale-or-hewey-talking-to-abigale-or-hewey-again";
      }
      return "starting-out-talking-to-abigale-or-hewey";
    }
    if (SID_NPC_IDS.has(npcId)) {
      return stage >= STAGE_BRIEFED && stage < STAGE_BUCKET_FILLED
        ? "arriving-to-the-manor-sid-s-demise"
        : null;
    }
    if (npcId === TAYTEN_NPC_ID) {
      return stage >= STAGE_INSIDE_MANOR && stage <= STAGE_TAYTEN_DEAD
        ? "arriving-to-the-manor-tayten-s-demise"
        : null;
    }
    if (npcId === LACEY_NPC_ID) {
      return stage >= STAGE_FUSE_LIT && stage <= STAGE_LACEY_DEAD
        ? "the-second-riddle-run-in-with-lacey"
        : null;
    }
    if (MANDY_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "finishing-up-talking-to-mandy-again";
      if (stage >= STAGE_MANDY_WAITING) return "finishing-up";
      if (stage >= STAGE_EMERALD_ROOM_OPEN && stage < STAGE_MANDY_DEAD) {
        return "the-third-riddle-mandy-in-the-kitchen";
      }
      return null;
    }
    if (KILLER_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_BRIEFED && stage < STAGE_BUCKET_FILLED) {
        return "arriving-to-the-manor-sid-s-demise";
      }
      if (stage >= STAGE_FUSE_LIT && stage <= STAGE_LACEY_DEAD) {
        return "the-second-riddle-run-in-with-lacey";
      }
      if (stage >= STAGE_SAPPHIRE_ROOM_OPEN && stage < STAGE_BOSS_BEATEN) {
        return "showdown-confronting-the-killer";
      }
      if (stage >= STAGE_BOSS_BEATEN && stage < STAGE_HEWEY_DEAD) {
        return "showdown-when-the-killer-takes-damage";
      }
      if (stage >= STAGE_HEWEY_DEAD && stage < STAGE_ABIGALE_KILLED) {
        return "showdown-defeating-the-killer";
      }
      return null;
    }
    return null;
  }

  /** Answer the page's prose conditions. `stepId` disambiguates repeated wording. */
  function answerCondition({ player, text, stepId, pages }) {
    // Conditions on other pages that happen to share wording ("already has the key") are not ours.
    if (Array.isArray(pages) && !pages.some((entry) => entry?.page === PAGE)) return null;
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    const has = (itemId) => inventory.getAmount(itemId) > 0;
    if (value.includes("insufficient inventory space")) return freeSlots(player) < 3;
    if (value.includes("at least three inventory spaces")) return freeSlots(player) >= 3;
    if (value.includes("no inventory space")) return inventory.isFull();
    if (value.includes("does not have inventory space")) return inventory.isFull();
    if (value.includes("space but already has a bucket")) {
      return !inventory.isFull() && has(BUCKET_ITEM_ID);
    }
    if (value.includes("does not have the manor key")) return !has(MANOR_KEY_ITEM_ID);
    if (value.includes("has the manor key")) return has(MANOR_KEY_ITEM_ID);
    if (value.includes("has inventory space")) return !inventory.isFull();
    if (value.includes("already has the key")) {
      if (stepId === "jv36xs") return has(MANOR_KEY_ITEM_ID);
      if (stepId === "rqIawh") return has(SAPPHIRE_KEY_ITEM_ID);
      return has(MANOR_KEY_ITEM_ID) || has(SAPPHIRE_KEY_ITEM_ID);
    }
    if (value.includes("already has the note")) {
      if (stepId === "cUhUGo") return has(NOTE1_ITEM_ID);
      if (stepId === "cTwCFK") return has(NOTE2_ITEM_ID);
      if (stepId === "2iN6Be") return has(NOTE3_ITEM_ID);
      return hasAnyNote(player);
    }
    if (value.includes("already has a knife")) return has(KNIFE_ITEM_ID);
    if (value.includes("already has the ruby key")) return has(RUBY_KEY_ITEM_ID);
    if (value.includes("does not have the necessary key")) return !hasAnyColouredKey(player);
    if (value.includes("has the necessary key")) return hasAnyColouredKey(player);
    if (value.includes("already has a tinderbox")) return has(TINDERBOX_ITEM_ID);
    if (value.includes("before getting the note")) return quest.getStage(player) < STAGE_LACEY_DEAD;
    if (value.includes("before reading the note")) return quest.getStage(player) < STAGE_NOTE2_READ;
    if (value.includes("already found the key")) return has(EMERALD_KEY_ITEM_ID);
    if (value.includes("code was incorrect")) return quest.getStage(player) < STAGE_GEM_PANEL_SOLVED;
    if (value.includes("code was correct")) return quest.getStage(player) >= STAGE_GEM_PANEL_SOLVED;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== "quest:misthalin-mystery:start") return;
    if (!ABIGALE_NPC_IDS.has(npcId) && !HEWEY_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  /**
   * The transcript message/action ids that carry an item or a stage side effect.
   * Stage transitions that gate further interactions are set in the object handlers
   * so a closed dialogue can never strand the player, the grants happen here.
   */
  function handleAction(event) {
    const { player, stepId } = event;
    if(sceneAction(event))return;
    const itemBoxes={p7I0Im:MANOR_KEY_ITEM_ID,"-D_iey":NOTE1_ITEM_ID,Qund0e:NOTE2_ITEM_ID,w3FghJ:NOTE3_ITEM_ID,AyZSfz:RUBY_KEY_ITEM_ID,Wh5PPN:EMERALD_KEY_ITEM_ID,AvBeLS:SAPPHIRE_KEY_ITEM_ID};
    if(itemBoxes[stepId]!==undefined)event.box={items:[itemBoxes[stepId]]};
    if(["AP3JKx","6p6UXM","yX2amu"].includes(stepId))event.box={statement:true};
    if (stepId === "7jM3EA") {
      if (quest.getStage(player) >= STAGE_MANDY_WAITING && !quest.isComplete(player) && freeSlots(player)>=3) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === "p7I0Im") {
      grantItem(player, MANOR_KEY_ITEM_ID);
      return;
    }
    if (stepId === "-D_iey") {
      grantItem(player, NOTE1_ITEM_ID);
      return;
    }
    if (stepId === "Qund0e") {
      grantItem(player, NOTE2_ITEM_ID);
      return;
    }
    if (stepId === "w3FghJ") {
      grantItem(player, NOTE3_ITEM_ID);
      return;
    }
    if (stepId === "ySyaiG") {
      grantItem(player, KNIFE_ITEM_ID);
      return;
    }
    if (stepId === "kJcYsv") {
      grantItem(player, TINDERBOX_ITEM_ID);
      return;
    }
    if (stepId === "AyZSfz") {
      grantItem(player, RUBY_KEY_ITEM_ID);
      return;
    }
    if (stepId === "Wh5PPN") {
      grantItem(player, EMERALD_KEY_ITEM_ID);
      return;
    }
    if (stepId === "AvBeLS") {
      grantItem(player, SAPPHIRE_KEY_ITEM_ID);
      return;
    }
    if (stepId === "i5vdZV") {
      const key=doorKeyByPlayer.get(player);doorKeyByPlayer.delete(player);
      if(!key||!held(player,key.item))return;
      player.getInventory().deleteNumber(key.item,1);quest.setStage(player,key.stage);return;
    }
    if (stepId === "6KwKGJ" && quest.getStage(player) < STAGE_FUSE_LIT) {
      quest.setStage(player, STAGE_FUSE_LIT);
      return;
    }
    if (stepId === "6p6UXM" && quest.getStage(player) < STAGE_PANEL_REVEALED) {
      quest.setStage(player, STAGE_PANEL_REVEALED);
      return;
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function boardRowboat(event) {
    const { player, objectId } = event;
    if (rowingPlayers.has(player)) return;
    if (objectId === ObjectIdentifiers.ROWBOAT_9) {
      if (quest.getStage(player) < STAGE_BRIEFED) {
        startTranscript(
          api,
          player,
          NpcIdentifiers.ABIGALE,
          PAGE,
          "starting-out-trying-to-use-the-rowboat-before-starting-the-quest"
        );
        return;
      }
    }
    const toIsland=objectId===ObjectIdentifiers.ROWBOAT_9;
    TaskManager.cancelTasks(player);
    rowingPlayers.add(player);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.getPacketSender().sendVarbit(12393,1).sendSubInterface((161<<16)|1,174,1,{postScripts:[{scriptId:948,args:[0,255,0,0,50]}]});
    // Capture: fade at4164, message/teleport4166, fade-in4167, close4169; approach walking is separate.
    later(player,2,()=>{
      startTranscript(api,player,NpcIdentifiers.ABIGALE,PAGE,toIsland?"starting-out-board-rowboat-to-the-island":"starting-out-board-rowboat-to-lumbridge-swamp");
      if(toIsland){player.moveTo(new Location(1637,4802,0));enterIsland(player);}
      else{const area=island(player);if(area)area.leave(player,false);player.moveTo(new Location(3240,3142,0));}
    });
    later(player,3,()=>{
      rowingPlayers.delete(player);
      player.getMovementQueue().setBlockMovement(false);
      player.getPacketSender().sendVarbit(12393,0).sendSubInterface((161<<16)|1,174,1,{postScripts:[{scriptId:948,args:[0,0,0,255,50]}]});
    });
    later(player,5,()=>player.getPacketSender().closeSubInterface((161<<16)|1));
  }

  function searchBarrel(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SID_DEAD) {
      murderScene(player,"sid");
      return;
    }
    if (stage === STAGE_SID_DEAD) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.SID,
        PAGE,
        "arriving-to-the-manor-searching-the-barrel-of-rainwater-search-the-barrel-without-emptying-it"
      );
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.SID,
      PAGE,
      "arriving-to-the-manor-searching-the-barrel-of-rainwater-searching-the-drained-barrel"
    );
  }

  function fillBucket(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SID_DEAD) {
      murderScene(player,"sid");
      return;
    }
    if (stage !== STAGE_SID_DEAD) {
      player.sendMessage("You have already filled the bucket.");
      return;
    }
    player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
    player.getInventory().adds(BUCKET_OF_WATER_ITEM_ID, 1);
    startTranscript(
      api,
      player,
      NpcIdentifiers.SID,
      PAGE,
      "arriving-to-the-manor-searching-the-barrel-of-rainwater-use-bucket-with-the-barrel"
    );
    quest.setStage(player, STAGE_BUCKET_FILLED);
  }

  function enterManor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INSIDE_MANOR) {
      startTranscript(api, player, NpcIdentifiers.KILLER, PAGE, "arriving-to-the-manor-entering-the-manor");
      if (!held(player, MANOR_KEY_ITEM_ID)) return;
      player.getInventory().deleteNumber(MANOR_KEY_ITEM_ID, 1);
      quest.setStage(player, STAGE_INSIDE_MANOR);
    }
    crossDoor(event);
  }

  function colouredDoor(event, requiredKeyId, unlockedAt) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < unlockedAt) {
      if (!held(player, requiredKeyId)) {
        player.sendMessage("The door is securely locked.");
        return;
      }
      doorKeyByPlayer.set(player,{item:requiredKeyId,stage:unlockedAt});
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-opening-colourful-handle-doors"
      );
      crossDoor(event);
      return;
    }
    crossDoor(event);
  }

  function taytenDoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INSIDE_MANOR) {
      player.sendMessage("The door is securely locked.");
      return;
    }
    if (stage === STAGE_INSIDE_MANOR) {
      murderScene(player,"tayten");
      return;
    }
    crossDoor(event);
  }

  function diamondDoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_EMERALD_ROOM_OPEN) {
      player.sendMessage("The door is securely locked.");
      return;
    }
    if (stage < STAGE_MANDY_DEAD) {
      murderScene(player,"mandy");
      return;
    }
    crossDoor(event);
  }

  function sapphireDoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SAPPHIRE_ROOM_OPEN) {
      if (!held(player, SAPPHIRE_KEY_ITEM_ID)) {
        player.sendMessage("The door is securely locked.");
        return;
      }
      doorKeyByPlayer.set(player,{item:SAPPHIRE_KEY_ITEM_ID,stage:STAGE_SAPPHIRE_ROOM_OPEN});
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-opening-colourful-handle-doors"
      );
      crossDoor(event);
      return;
    }
    if(stage===STAGE_SAPPHIRE_ROOM_OPEN){murderScene(player,"intro");return;}
    if(stage===111)return;
    if(stage===STAGE_BOSS_BEATEN){murderScene(player,"reveal");return;}
    if(stage===STAGE_ABIGALE_KILLED){murderScene(player,"rescue");return;}
    crossDoor(event);
  }

  function takeTool(event, variant) {
    startTranscript(api, event.player, NpcIdentifiers.KILLER, PAGE, variant);
  }

  function takeBucket(event) {
    const { player } = event;
    if (held(player, BUCKET_ITEM_ID) || freeSlots(player) < 1) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "arriving-to-the-manor-taking-the-bucket"
      );
      return;
    }
    player.getInventory().adds(BUCKET_ITEM_ID, 1);
    if(quest.getStage(player)===STAGE_BRIEFED)quest.setStage(player,15);
    player.sendMessage("You take the bucket.");
  }

  function takeClue(event, requiredStage, npcId, variant) {
    const { player } = event;
    if (quest.getStage(player) < requiredStage) {
      player.sendMessage("There's nothing here.");
      return;
    }
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function searchPainting(event) {
    const { player } = event;
    const objectId = resolvedObjectId(event);
    const stage = quest.getStage(player);
    if (PAINTING_LOC_IDS.has(objectId) && stage >= STAGE_PAINTING_SLASHED) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-searching-the-slashed-painting"
      );
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.KILLER,
      PAGE,
      "the-first-riddle-slashing-the-wrong-painting"
    );
  }

  function slashPainting(event) {
    const { player } = event;
    if (
      resolvedObjectId(event) === ObjectIdentifiers.PAINTING_22 &&
      quest.getStage(player) === STAGE_NOTE1_READ
    ) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-slashing-the-painting"
      );
      quest.setStage(player, STAGE_PAINTING_SLASHED);
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.KILLER,
      PAGE,
      "the-first-riddle-slashing-the-wrong-painting"
    );
  }

  function lightCandle(event) {
    const { player, location } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RUBY_ROOM_OPEN) {
      player.sendMessage("You have no reason to light this candle.");
      return;
    }
    if (stage > STAGE_RUBY_ROOM_OPEN) {
      player.sendMessage("You have already lit this candle.");
      return;
    }
    const lit = litCandlesByPlayer.get(player) ?? new Set();
    const varbit = CANDLE_VARBIT_BY_PLACEMENT.get(event.object?.getId?.() ?? event.objectId);
    const tile = varbit ?? `${location.x},${location.y}`;
    if (lit.has(tile)) {
      player.sendMessage("You have already lit this candle.");
      return;
    }
    lit.add(tile);
    litCandlesByPlayer.set(player, lit);
    let mask=0;for(const bit of lit)if(typeof bit==="number")mask|=1<<(bit-4039);
    player.setAttribute(CANDLES_ATTRIBUTE,mask);
    if (varbit !== undefined) player.getPacketSender().sendVarbit(varbit, 1);
    if (lit.size >= 4) {
      if (stage === STAGE_RUBY_ROOM_OPEN) quest.setStage(player, STAGE_CANDLES_LIT);
      resendLitCandles(player);
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-lighting-the-last-candle"
      );
      return;
    }
    startTranscript(api, player, NpcIdentifiers.KILLER, PAGE, "the-first-riddle-lighting-a-candle");
  }

  /** Restore the independently persisted candle bits on login. */
  function resendLitCandles(player) {
    for (const id of litCandlesByPlayer.get(player) ?? []) {
      if (typeof id === "number") player.getPacketSender().sendVarbit(id, 1);
    }
  }

  function lightFuse(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_CANDLES_LIT) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-attempting-to-light-the-fuse-while-the-candles-are-unlit"
      );
      return;
    }
    if (stage >= STAGE_FUSE_LIT) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-attempting-to-light-the-fuse-after-it-has-been-lit"
      );
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.KILLER,
      PAGE,
      "the-first-riddle-attempting-to-light-the-fuse-once-the-candles-are-lit"
    );
    quest.setStage(player, STAGE_FUSE_LIT);
    resendLitCandles(player);
  }

  function climbWall(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_WALL_BLOWN) {
      player.sendMessage("The wall hasn't been damaged enough to climb.");
      return;
    }
    const position = player.getLocation();
    const x = position.getX() <= 1647 ? 1648 : 1647;
    ObstacleRunner.run(event,[{sound:2453,delay:30},{move:[x,4829,position.getZ()],anim:840,delay:30,speed:[30,100],ticks:4}]);
  }

  function observeTree(event) {
    const { player } = event;
    if (quest.getStage(player) === STAGE_WALL_BLOWN) {
      murderScene(player,"lacey");
      return;
    }
    startTranscript(
      api,
      player,
      LACEY_NPC_ID,
      PAGE,
      "the-second-riddle-observing-tree-after-lacey-is-killed"
    );
  }

  function playPiano(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_PIANO_SOLVED) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-second-riddle-playing-the-piano-searching-the-piano-after-unlocking-it"
      );
      return;
    }
    if (stage < STAGE_NOTE2_READ) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-second-riddle-playing-the-piano"
      );
      return;
    }
    openPianoPrompt(player);
  }

  function searchFireplace(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage === STAGE_PANEL_REVEALED) {
      player.sendMessage(
        "You find a panel of switches inside the hidden compartment. Each switch is crafted from a different gemstone."
      );
      openGemPrompt(player);
      return;
    }
    if (stage >= STAGE_GEM_PANEL_SOLVED) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-third-riddle-searching-the-fireplace-after-solving-the-riddle"
      );
      return;
    }
    player.sendMessage("You find nothing of interest.");
  }

  function handleObjectInteraction(event) {
    const objectId = resolvedObjectId(event);
    if (BOAT_LOC_IDS.has(objectId)) {
      event.handled = true;
      boardRowboat(event);
      return;
    }
    if (WATER_BARREL_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchBarrel(event);
      return;
    }
    if (FRONT_DOOR_LOC_IDS.has(objectId)) {
      event.handled = true;
      enterManor(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_554) {
      event.handled = true;
      taytenDoor(event);
      return;
    }
    if (LOCKED_DOOR_LOC_IDS.has(objectId)) {
      event.handled = true;
      event.player.sendMessage("The door is securely locked.");
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_560) {
      event.handled = true;
      diamondDoor(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_561) {
      event.handled = true;
      sapphireDoor(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_558) {
      event.handled = true;
      colouredDoor(event, RUBY_KEY_ITEM_ID, STAGE_RUBY_ROOM_OPEN);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_559) {
      event.handled = true;
      colouredDoor(event, EMERALD_KEY_ITEM_ID, STAGE_EMERALD_ROOM_OPEN);
      return;
    }
    if (objectId === ObjectIdentifiers.NOTE_3) {
      event.handled = true;
      takeClue(event, STAGE_TAYTEN_DEAD, NpcIdentifiers.TAYTEN, "arriving-to-the-manor-taking-the-note");
      return;
    }
    if (objectId === ObjectIdentifiers.NOTE_4) {
      event.handled = true;
      takeClue(event, STAGE_LACEY_DEAD, LACEY_NPC_ID, "the-second-riddle-taking-the-note");
      return;
    }
    if (objectId === ObjectIdentifiers.NOTE_5) {
      event.handled = true;
      takeClue(event, STAGE_MANDY_DEAD, NpcIdentifiers.MANDY, "the-third-riddle-taking-the-note");
      return;
    }
    if (objectId === ObjectIdentifiers.TABLE_258) {
      event.handled = true;
      takeTool(event, "arriving-to-the-manor-taking-the-knife-from-the-table");
      return;
    }
    if (objectId === ObjectIdentifiers.SHELVES_92) {
      event.handled = true;
      takeTool(event, "the-first-riddle-taking-a-tinderbox-from-the-shelves");
      return;
    }
    if (objectId === ObjectIdentifiers.COL_FF9040_BUCKET_COL) {
      event.handled = true;
      takeBucket(event);
      return;
    }
    if (objectId === ObjectIdentifiers.STAIRCASE_164) {
      event.handled = true;
      startTranscript(
        api,
        event.player,
        NpcIdentifiers.KILLER,
        PAGE,
        "arriving-to-the-manor-climbing-the-staircase"
      );
      return;
    }
    if (PAINTING_LOC_IDS.has(objectId) || WRONG_PAINTING_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchPainting(event);
      return;
    }
    if (PIANO_LOC_IDS.has(objectId)) {
      event.handled = true;
      playPiano(event);
      return;
    }
    if (FIREPLACE_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchFireplace(event);
      return;
    }
    if (DAMAGED_WALL_LOC_IDS.has(objectId)) {
      event.handled = true;
      climbWall(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DEAD_TREE_26) {
      event.handled = true;
      observeTree(event);
    }
  }

  function handleItemOnObject(event) {
    const objectId = resolvedObjectId(event);
    if (event.itemId === BUCKET_ITEM_ID) {
      if (!WATER_BARREL_LOC_IDS.has(objectId)) return;
      event.handled = true;
      fillBucket(event);
      return;
    }
    if (event.itemId === KNIFE_ITEM_ID) {
      if (PAINTING_LOC_IDS.has(objectId) || WRONG_PAINTING_LOC_IDS.has(objectId)) {
        event.handled = true;
        slashPainting(event);
        return;
      }
      if (FIREPLACE_LOC_IDS.has(objectId)) {
        event.handled = true;
        if (quest.getStage(event.player) !== STAGE_NOTE3_READ) {
          event.player.sendMessage("You have no reason to do that.");
          return;
        }
        startTranscript(
          api,
          event.player,
          NpcIdentifiers.MANDY,
          PAGE,
          "the-third-riddle-using-a-knife-on-the-fireplace"
        );
        quest.setStage(event.player, STAGE_PANEL_REVEALED);
      }
      return;
    }
    if (event.itemId === TINDERBOX_ITEM_ID) {
      if (CANDLE_LOC_IDS.has(objectId)) {
        event.handled = true;
        lightCandle(event);
        return;
      }
      if (objectId === ObjectIdentifiers.BARREL_139) {
        event.handled = true;
        lightFuse(event);
      }
      return;
    }
    if (!COLOURED_KEY_ITEM_IDS.has(event.itemId)) return;
    const requiredKey = DOOR_KEY_BY_LOC.get(objectId);
    if (!requiredKey) return;
    event.handled = true;
    if (event.itemId !== requiredKey) {
      startTranscript(
        api,
        event.player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-opening-colourful-handle-doors-using-the-wrong-key-on-a-coloured-handle-door"
      );
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_561) {
      sapphireDoor(event);
      return;
    }
    const unlockedAt =
      requiredKey === RUBY_KEY_ITEM_ID ? STAGE_RUBY_ROOM_OPEN : STAGE_EMERALD_ROOM_OPEN;
    colouredDoor(event, requiredKey, unlockedAt);
  }

  /**
   * Doors.plugin.js registers before quest plugins, so it would swap the manor's quest
   * doors before this plugin's object hook runs. It emits door:toggle first; claim the
   * door here and run the quest's own door logic.
   */
  function claimQuestDoor(request) {
    if (request.handled) return;
    const { objectId } = request;
    if (FRONT_DOOR_LOC_IDS.has(objectId)) {
      request.handled = true;
      enterManor(request);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_554) {
      request.handled = true;
      taytenDoor(request);
      return;
    }
    if (LOCKED_DOOR_LOC_IDS.has(objectId)) {
      request.handled = true;
      request.player.sendMessage("The door is securely locked.");
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_560) {
      request.handled = true;
      diamondDoor(request);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_561) {
      request.handled = true;
      sapphireDoor(request);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_558) {
      request.handled = true;
      colouredDoor(request, RUBY_KEY_ITEM_ID, STAGE_RUBY_ROOM_OPEN);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_559) {
      request.handled = true;
      colouredDoor(request, EMERALD_KEY_ITEM_ID, STAGE_EMERALD_ROOM_OPEN);
    }
  }

  function handleItemAction(event) {
    const lines = NOTE_LINES.get(event.itemId);
    if (!lines) return;
    if (event.option && !/read/i.test(event.option)) return;
    event.handled = true;
    const sender=event.player.getPacketSender();
    sender.sendInterface(NOTES_GROUP);
    sender.sendInterfaceFlagsRange((NOTES_GROUP<<16)|104,-1,-1,2);
    for(let child=2;child<=102;child++)sender.sendString(lines[child-3]??"",(NOTES_GROUP<<16)|child);
    const [readableAt, readStage] = NOTE_READ_STAGES.get(event.itemId);
    if (quest.getStage(event.player) === readableAt) {
      quest.setStage(event.player, readStage);
    }
  }

  // ==========================================================================
  // Puzzles
  // ==========================================================================

  function resetPuzzle(player, group) {
    const first=group===PIANO_GROUP?4044:4051,count=group===PIANO_GROUP?4:6;
    for(let i=0;i<count;i++)player.getPacketSender().sendVarbit(first+i,0);
    player.getPacketSender().sendVarbit(group===PIANO_GROUP?4049:4050,0);
    pianoProgressByPlayer.delete(player);gemProgressByPlayer.delete(player);
  }
  function openPianoPrompt(player) {
    resetPuzzle(player,PIANO_GROUP);puzzleOpen.set(player,PIANO_GROUP);
    player.getPacketSender().sendInterface(PIANO_GROUP).sendInterfaceFlagsRange((PIANO_GROUP<<16)|34,-1,-1,2);
    for(let child=20;child<=33;child++)player.getPacketSender().sendInterfaceFlagsRange((PIANO_GROUP<<16)|child,-1,-1,2);
  }
  function openGemPrompt(player) {
    resetPuzzle(player,GEM_GROUP);puzzleOpen.set(player,GEM_GROUP);
    player.getPacketSender().sendInterface(GEM_GROUP);
    for(const child of GEM_BUTTONS.keys())player.getPacketSender().sendInterfaceFlagsRange((GEM_GROUP<<16)|child,-1,-1,2);
  }
  function puzzleButton(event) {
    const {player,buttonId}=event,group=buttonId>>>16,child=buttonId&65535;
    if(group===NOTES_GROUP){event.handled=true;player.getPacketSender().sendInterfaceRemoval();return;}
    if(puzzleOpen.get(player)!==group)return;
    event.handled=true;
    if(group===PIANO_GROUP&&child===34){puzzleOpen.delete(player);resetPuzzle(player,group);player.getPacketSender().sendInterfaceRemoval();return;}
    if(group===PIANO_GROUP&&child>=20&&child<=33&&quest.getStage(player)===STAGE_NOTE2_READ) playPianoNote(player,"CDEFGAB"[(child-20)%7],child-20);
    if(group===GEM_GROUP&&GEM_BUTTONS.has(child)&&quest.getStage(player)===STAGE_PANEL_REVEALED)flipGem(player,GEM_BUTTONS.get(child));
  }
  function playPianoNote(player,note,key=0) {
    player.sendMessage(`You play ${"AEF".includes(note)?"an":"a"} ${note}.`);
    const sounds=[3696,3698,3700,3701,3703,3705,3707,3708,3710,3712,3713,3715,3717,3719];
    player.getPacketSender().sendSoundEffect(sounds[key],1,0);
    const entered=pianoProgressByPlayer.get(player)??[],seen=[];
    entered.push(note);pianoProgressByPlayer.set(player,entered);
    for(const n of entered){const i=PIANO_ORDER.findIndex((v,j)=>v===n&&!seen.includes(j));if(i>=0)seen.push(i);}
    for(const i of seen)player.getPacketSender().sendVarbit(4044+i,1);
    if(entered.length<4){player.getPacketSender().sendVarbit(4049,entered.length);return;}
    const correct=entered.join("")===PIANO_ORDER.join("");resetPuzzle(player,PIANO_GROUP);puzzleOpen.delete(player);player.getPacketSender().sendInterfaceRemoval();
    if(correct){quest.setStage(player,STAGE_PIANO_SOLVED);player.sendMessage("There is a clicking sound as the compartment on the piano unlocks.");}
    else {player.sendMessage("There is a clicking sound as the lock on the piano's compartment resets.");startTranscript(api,player,NpcIdentifiers.MANDY,PAGE,"the-second-riddle-playing-the-piano",steps=>[{player:"I don't think that's right.. Perhaps the clue the killer left behind could help?"}]);}
  }
  function flipGem(player,gem) {
    player.sendMessage(`You flip the ${gem.toLowerCase()} switch.`);player.getPacketSender().sendSoundEffect(2266,1,0);
    const entered=gemProgressByPlayer.get(player)??[];entered.push(gem);gemProgressByPlayer.set(player,entered);
    player.getPacketSender().sendVarbit(4051+GEM_ORDER.indexOf(gem),1);
    if(entered.length<6){player.getPacketSender().sendVarbit(4050,entered.length);return;}
    const correct=entered.join(",")===GEM_ORDER.join(",");resetPuzzle(player,GEM_GROUP);puzzleOpen.delete(player);player.getPacketSender().sendInterfaceRemoval();
    if(correct){quest.setStage(player,STAGE_GEM_PANEL_SOLVED);player.sendMessage("There is a clicking sound as the compartment in the fireplace unlocks.");}
    else {player.sendMessage("There is a clicking sound as the lock on the panel resets.");startTranscript(api,player,NpcIdentifiers.KILLER,PAGE,"the-third-riddle-entering-a-code");}
  }

  // ==========================================================================
  // Mandy (owner-only post-quest spawn) and session lifecycle
  // ==========================================================================

  function ensureMandy(player) {
    if (quest.getStage(player) < STAGE_MANDY_WAITING || mandyByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: MANDY_NPC_ID,
      x: 1637,
      y: 4823,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) {mandyByPlayer.set(player,npc);const area=island(player);if(area)area.enter(npc);}
  }

  function handleLogout({ player }) {
    if (!player) return;
    TaskManager.cancelTasks(player);
    if(rowingPlayers.delete(player)){
      player.getMovementQueue().setBlockMovement(false);
      player.getPacketSender().sendVarbit(12393,0).closeSubInterface((161<<16)|1);
    }
    const area=island(player);if(area)area.leave(player,true);
    const mandy = mandyByPlayer.get(player);
    if (mandy) api.removeNpc(mandy);
    mandyByPlayer.delete(player);
    litCandlesByPlayer.delete(player);
    pianoProgressByPlayer.delete(player);
    gemProgressByPlayer.delete(player);
  }

  function handleLogin({ player }) {
    // The client (and this player's loc/NPC resolvers) pick the manor's multi-loc
    // scenery and the static quest NPCs from varp 1535; without this they all fall
    // back to their stage-0 variants after a relog.
    player.getPacketSender().sendVarbit(STAGE_VARBIT,quest.getStage(player));
    const mask=Number(player.getAttribute(CANDLES_ATTRIBUTE))||(quest.getStage(player)>=STAGE_CANDLES_LIT?15:0);
    litCandlesByPlayer.set(player,new Set(Array.from(CANDLE_VARBIT_BY_PLACEMENT.values()).filter(id=>mask&(1<<(id-4039)))));
    resendLitCandles(player);
    refreshQuestList(player);
    const at=player.getLocation();
    if(at.getX()>=1600&&at.getX()<=1663&&at.getY()>=4792&&at.getY()<=4863){if(quest.getStage(player)===111)quest.setStage(player,STAGE_SAPPHIRE_ROOM_OPEN);if(quest.getStage(player)===15)quest.setStage(player,STAGE_BRIEFED);enterIsland(player);}
    ensureMandy(player);
  }

  quest = registerQuest(api, {
    key: "misthalin_mystery",
    name: "Misthalin Mystery",
    varpId: VARP_MISTHALIN_MYSTERY,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 600, label: "Crafting" }],
    scrollItemId: KILLER_KNIFE_ITEM_ID,
    completionJingleId: 153,
    rewardItemLabel: "An Uncut Ruby",
    otherRewards: ["An Uncut Emerald", "An Uncut Sapphire"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", sceneLine);
  api.onCustomEvent("player:world-input", protectScene);
  api.onCustomEvent("interface:close", protectScene);
  api.onNpcInteraction("<col=00ffff>Mirror</col>",{Push:pushMirror});
  api.onNpcInteraction("Abigale",{Fight:fightAbigale});
  api.onCustomEvent("door:toggle", claimQuestDoor);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction(handleItemAction);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  api.persistAttribute(CANDLES_ATTRIBUTE,0);
  api.onInterfaceActionButton([...PIANO_BUTTONS,...Array.from(GEM_BUTTONS.keys(),child=>(GEM_GROUP<<16)|child),(NOTES_GROUP<<16)|104],puzzleButton);
};
