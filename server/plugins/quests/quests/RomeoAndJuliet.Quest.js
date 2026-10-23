/** Romeo & Juliet: captured handovers, potion effects and private scenes. See docs/f2p-varrock-parity.md. */
module.exports = function registerRomeoAndJulietQuest(api) {
  const { Animation, Graphic, Location, World, TaskManager, CountdownTask, TemplatedInstanceArea, DialogueChainBuilder, ActionDialogue, StatementDialogue, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const ROMEO_NPC_ID = NpcIdentifiers.ROMEO;
  /** Alternate Juliet cache id; no generated NpcIdentifiers member (see summary). */
  const JULIET_ALT_NPC_ID = 6268;
  const JULIET_NPC_IDS = new Set([JULIET_ALT_NPC_ID, NpcIdentifiers.JULIET]);
  const FATHER_LAWRENCE_NPC_ID = NpcIdentifiers.FATHER_LAWRENCE;
  const APOTHECARY_NPC_ID = NpcIdentifiers.APOTHECARY;

  const QUEST_NPC_IDS = new Set([
    ROMEO_NPC_ID,
    FATHER_LAWRENCE_NPC_ID,
    APOTHECARY_NPC_ID,
    ...JULIET_NPC_IDS,
  ]);

  const VARP_ROMEO_AND_JULIET = 144;
  const STAGE_SPOKEN_TO_ROMEO = 10;
  const STAGE_SPOKEN_TO_JULIET = 20;
  const STAGE_PASSED_MESSAGE = 30;
  const STAGE_SPOKEN_TO_FATHER_LAWRENCE = 40;
  const STAGE_SPOKEN_TO_APOTHECARY = 50;
  const STAGE_JULIET_IN_CRYPT = 60;
  const STAGE_COMPLETE = 100;

  const CADAVA_BERRIES_ITEM_ID = ItemIdentifiers.CADAVA_BERRIES;
  const JULIETS_MESSAGE_ITEM_ID = ItemIdentifiers.MESSAGE;
  const CADAVA_POTION_ITEM_ID = ItemIdentifiers.CADAVA_POTION;

  const CADAVA_BUSH_LOC_IDS = new Set([
    ObjectIdentifiers.CADAVA_BUSH,
    ObjectIdentifiers.CADAVA_BUSH_2,
    ObjectIdentifiers.CADAVA_BUSH_3,
  ]);

  /** Message step ids from the "Romeo & Juliet" transcript. */
  const JULIET_GIVES_MESSAGE = "2xqCe8";
  const JULIET_GIVES_ANOTHER_MESSAGE = "KmL5hw";
  const ROMEO_TAKES_MESSAGE = "azqQuD";
  const APOTHECARY_TAKES_BERRIES = "3oxHI6";
  const APOTHECARY_GIVES_POTION = "eeTqTE";
  const APOTHECARY_TAKES_BERRIES_AGAIN = "Be9l32";
  const APOTHECARY_GIVES_POTION_AGAIN = "Cw477j";
  const JULIET_TAKES_POTION = "9YlDKS";
  const ROMEO_QUEST_COMPLETE = "PO2Wli";

  /** Final player line of the Father Lawrence sermon, which ends the audience. */
  const FATHER_SERMON_LAST_LINE = "strong overtones of death";

  const RJ = (variant) => ({ page: "Romeo & Juliet", variant });
  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const PHILLIPA_NPC_ID=NpcIdentifiers.PHILLIPA, DRAUL_NPC_ID=NpcIdentifiers.DRAUL_LEPTOC;
  const CONGREGATION_NPC_ID=5042; // cache congregation1
  const JULIET_VARBIT=1838; // romeo_juliet_in_crypt
  const MESSAGE_ATTRIBUTE="romeo-and-juliet:message-delivered";
  const POTION_VARIANT="delivering-the-potion-talking-to-juliet", CRYPT_VARIANT="rescuing-juliet-talking-to-romeo";
  const POTION_FIRST_VARIANT="making-the-cadava-potion-talking-to-the-apothecary", POTION_AGAIN_VARIANT=POTION_FIRST_VARIANT+"-again";
  const LOOK_VARIANT=POTION_AGAIN_VARIANT+"-look-at-the-potion", DRINK_VARIANT=POTION_AGAIN_VARIANT+"-drinking-the-potion-at-the-apothecary-s", OUTSIDE_VARIANT=POTION_AGAIN_VARIANT+"-attempting-to-drink-the-potion-elsewhere";
  const scenes=new Map(),timed=new Map(),pendingStart=new WeakSet(),berryHandover=new WeakSet(),mixed=new WeakSet();
  let quest;


  function romeoVariant(stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Romeo" };
    if (stage >= STAGE_JULIET_IN_CRYPT) return RJ("rescuing-juliet-talking-to-romeo");
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) return RJ("making-the-cadava-potion-talking-to-romeo");
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("finding-father-lawrence-talking-to-romeo-after-father-lawrence");
    }
    if (stage === STAGE_SPOKEN_TO_JULIET) return RJ("delivering-the-message-talking-to-romeo");
    if (stage === STAGE_PASSED_MESSAGE) return RJ("delivering-the-message-talking-to-romeo-again");
    if (stage >= STAGE_SPOKEN_TO_ROMEO) return RJ("starting-out-talking-to-romeo-again");
    return RJ("starting-out-talking-to-romeo");
  }

  function julietVariant(stage) {
    if (stage >= STAGE_JULIET_IN_CRYPT) {
      return { page: "Juliet", variant: "standard-dialogue-after-romeo-juliet" };
    }
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) return RJ("delivering-the-potion-talking-to-juliet");
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("finding-father-lawrence-talking-to-juliet-after-father-lawrence");
    }
    if (stage >= STAGE_PASSED_MESSAGE) return RJ("delivering-the-message-talking-to-juliet");
    if (stage >= STAGE_SPOKEN_TO_JULIET) return RJ("finding-juliet-talking-to-juliet-again");
    if (stage >= STAGE_SPOKEN_TO_ROMEO) return RJ("finding-juliet-talking-to-juliet");
    return { page: "Juliet", variant: "standard-dialogue-before-romeo-juliet" };
  }

  function fatherVariant(stage) {
    if (stage >= STAGE_JULIET_IN_CRYPT) {
      return { page: "Father Lawrence", variant: "standard-dialogue" };
    }
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) {
      return RJ("making-the-cadava-potion-talking-to-father-lawrence");
    }
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("finding-father-lawrence-talking-to-father-lawrence-again");
    }
    if (stage >= STAGE_SPOKEN_TO_ROMEO) {
      return RJ("finding-father-lawrence-talking-to-father-lawrence");
    }
    return { page: "Father Lawrence", variant: "standard-dialogue" };
  }

  function apothecaryVariant(stage, player) {
    if (stage === STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return RJ("making-the-cadava-potion-talking-to-the-apothecary");
    }
    if (stage === STAGE_SPOKEN_TO_APOTHECARY && !held(player, CADAVA_POTION_ITEM_ID)) {
      return RJ("making-the-cadava-potion-talking-to-the-apothecary-again");
    }
    return null;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const romeoLines = [
      "<str>I agreed to find Juliet for Romeo and tell her how</str>",
      "<str>he feels.</str>",
    ];
    const julietLines = [
      "<str>I found Juliet west of Varrock. She gave me a</str>",
      "<str>message to take back to Romeo.</str>",
    ];
    const fatherLines = [
      "<str>Father Lawrence suggested a potion that would make</str>",
      "<str>Juliet appear dead so Romeo could rescue her.</str>",
    ];

    if (stage >= STAGE_COMPLETE) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "<str>I delivered the Cadava potion and told Romeo the plan.</str>",
        "<str>He did not understand it, but rewarded me anyway.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_JULIET_IN_CRYPT) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "<str>I delivered the Cadava potion to Juliet.</str>",
        "I must tell <col=800000>Romeo</col> what has happened.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_APOTHECARY) {
      const carriedPotion = held(player, CADAVA_POTION_ITEM_ID);
      const carriedBerries = held(player, CADAVA_BERRIES_ITEM_ID);
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "<str>The Apothecary agreed to make a Cadava potion.</str>",
        carriedPotion
          ? "I should take the <col=800000>Cadava potion</col> to <col=800000>Juliet</col>."
          : carriedBerries
            ? "I should take these <col=800000>Cadava berries</col> to the <col=800000>Apothecary</col>."
            : "I need to find some <col=800000>Cadava berries</col>.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_FATHER_LAWRENCE) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "",
        ...fatherLines,
        "I need to find the <col=800000>Apothecary</col> and ask him",
        "to make a <col=800000>Cadava potion</col>.",
      ];
    }
    if (stage >= STAGE_PASSED_MESSAGE) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        "<str>I delivered Juliet's message to Romeo.</str>",
        "I should find <col=800000>Father Lawrence</col> and ask for help.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_JULIET) {
      return [
        ...romeoLines,
        "",
        ...julietLines,
        held(player, JULIETS_MESSAGE_ITEM_ID)
          ? "I should take <col=800000>Juliet's message</col> to <col=800000>Romeo</col>."
          : "I should ask <col=800000>Juliet</col> for another copy of her message.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TO_ROMEO) {
      return [
        ...romeoLines,
        "",
        "I should speak to <col=800000>Juliet</col>, west of <col=800000>Varrock</col>.",
      ];
    }
    return [
      "I can start this quest by talking to",
      "<col=800000>Romeo</col> in <col=800000>Varrock Square</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === ROMEO_NPC_ID) return romeoVariant(stage);
    if (JULIET_NPC_IDS.has(npcId)) return julietVariant(stage);
    if (npcId === FATHER_LAWRENCE_NPC_ID) return fatherVariant(stage);
    if (npcId === APOTHECARY_NPC_ID) return apothecaryVariant(stage, player);
    if (npcId === PHILLIPA_NPC_ID) return stage>=60?RJ("rescuing-juliet-talking-to-phillipa"):stage>=20?RJ("finding-juliet-talking-to-phillipa-after-agreeing-to-deliver-the-message"):RJ("finding-juliet-talking-to-phillipa");
    if (npcId === DRAUL_NPC_ID) return stage>=60?RJ("rescuing-juliet-talking-to-draul-leptoc"):stage>=50?RJ("making-the-cadava-potion-talking-to-draul-leptoc"):stage>=30?RJ("delivering-the-message-talking-to-draul-leptoc"):stage>=20?RJ("finding-juliet-talking-to-draul-leptoc-after-agreeing-to-deliver-the-message"):RJ("finding-juliet-talking-to-draul-leptoc");
    return null;
  }

  function answerCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (npcId===DRAUL_NPC_ID) {
      if(value.includes("has the message"))return held(player,JULIETS_MESSAGE_ITEM_ID);
      if(value.includes("currently has the cadava potion"))return held(player,CADAVA_POTION_ITEM_ID);
    }

    if (npcId === ROMEO_NPC_ID) {
      if (value.includes("nearby romeo")) return true;
      if (value.includes("has not started romeo & juliet")) return stage < STAGE_SPOKEN_TO_ROMEO;
      if (value.includes("has completed romeo & juliet")) return stage >= STAGE_COMPLETE;
      if (value.includes("does not have juliet's message")) return !held(player, JULIETS_MESSAGE_ITEM_ID) && !player.getAttribute(MESSAGE_ATTRIBUTE);
      if (value.includes("has juliet's message")) return held(player, JULIETS_MESSAGE_ITEM_ID) || Boolean(player.getAttribute(MESSAGE_ATTRIBUTE));
      if (value.includes("not carrying a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("is carrying a cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      return null;
    }

    if (JULIET_NPC_IDS.has(npcId)) {
      if (value.includes("still has the message")) return held(player, JULIETS_MESSAGE_ITEM_ID) || Boolean(player.getAttribute(MESSAGE_ATTRIBUTE));
      if (value.includes("lost the message")) return !held(player, JULIETS_MESSAGE_ITEM_ID) && !player.getAttribute(MESSAGE_ATTRIBUTE);
      if (value.includes("doesn't have a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("has a cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      return null;
    }

    if (npcId === FATHER_LAWRENCE_NPC_ID) {
      if (value.includes("has not made a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("not carrying a cadava potion")) return !held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("is carrying a cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("has not started romeo & juliet")) return stage < STAGE_SPOKEN_TO_ROMEO;
      if (value.includes("has started romeo & juliet and talked to juliet")) {
        // Pre-potion only: once Juliet has the potion the post-quest branch wins.
        return stage >= STAGE_SPOKEN_TO_JULIET && stage < STAGE_JULIET_IN_CRYPT;
      }
      if (value.includes("has given a cadava potion to juliet")) return stage >= STAGE_JULIET_IN_CRYPT;
      return null;
    }

    if (npcId === APOTHECARY_NPC_ID) {
      if (value.includes("has not started romeo & juliet")) return stage < STAGE_SPOKEN_TO_ROMEO;
      if (value.includes("has completed romeo & juliet")) return stage >= STAGE_COMPLETE;
      if (value.includes("does not have cadava berries")) return !held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("has cadava berries")) return held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("without any cadava berries")) return !held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("with some cadava berries")) return held(player, CADAVA_BERRIES_ITEM_ID);
      if (value.includes("with the cadava potion")) return held(player, CADAVA_POTION_ITEM_ID);
      if (value.includes("after giving juliet the cadava potion")) {
        return stage >= STAGE_JULIET_IN_CRYPT;
      }
      if (value.includes("combat path voucher and hasn't received all possible rewards")) return false;
      if (value.includes("isn't carrying a combat path voucher")) return true;
      return null;
    }

    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId===ROMEO_NPC_ID && hook==="quest:romeo-juliet:start" && quest.getStage(player)===0)pendingStart.add(player);
  }
  function handleDialogueLine(event) {
    const {player,npcId,text}=event;
    if(npcId===ROMEO_NPC_ID && text==="Oh great! And tell her that I want to kiss her a give." && pendingStart.has(player))event.after=()=>{pendingStart.delete(player);if(!quest.isStarted(player))quest.setStage(player,10);};
    if(npcId===ROMEO_NPC_ID && text==="Father Lawrence?")event.before=()=>{if(quest.getStage(player)===20&&player.getAttribute(MESSAGE_ATTRIBUTE))quest.setStage(player,30);};
    if(npcId===FATHER_LAWRENCE_NPC_ID && text.startsWith("Then Romeo can collect her from the crypt!"))event.before=()=>{if(quest.getStage(player)===30)quest.setStage(player,40);};
    if(npcId===APOTHECARY_NPC_ID && text==="I have all that, but I need some Cadava berries.")event.before=()=>{if(quest.getStage(player)===40)quest.setStage(player,50);};
    if(npcId===APOTHECARY_NPC_ID && text==="Phew! Here is what you need.")event.before=()=>mixPotion(event);
    const scene=scenes.get(player);
    if(!scene)return;
    const actorId=event.step?.speaker==="Phillipa"?PHILLIPA_NPC_ID:event.step?.speaker==="Draul Leptoc"?DRAUL_NPC_ID:event.step?.speaker==="Juliet"?NpcIdentifiers.JULIET:ROMEO_NPC_ID;
    event.before=()=>{
      const current=scene.actors.get(actorId);
      if(current){player.setPositionToFace(current.getLocation());current.setPositionToFace(player.getLocation());}
      if(text==="Right...bottoms up!")current?.performAnimation(new Animation(3284));
      if(text==="Urk!")current?.performAnimation(new Animation(836));
      if(text==="What's all that screaming?") { actor(scene,DRAUL_NPC_ID,3158,3427);camera(player,scene,[3156,3421,425],[3157,3426,125],5); }
      if(text==="Hi Romeo...I'm Phillipa!") {const cousin=actor(scene,PHILLIPA_NPC_ID,2331,4645);cousin?.getMovementQueue().addSteps(scene.sourceTile(2325,4644));}
    };
    if(scene.kind==="crypt"&&text==="Oh, be quiet...")event.after=()=>{
      frozenDialogue(player);
      later(scene,3,()=>camera(player,scene,[2330,4641,400],[2342,4655,25]));
      later(scene,5,()=>resume(player,ROMEO_NPC_ID,CRYPT_VARIANT,text));
    };
    if(scene.kind==="crypt"&&text==="We're here. Look, Juliet is over there!")event.after=()=>{
      frozenDialogue(player);camera(player,scene,[2334,4647,375],[2322,4639,250],10);
      later(scene,5,()=>camera(player,scene,[2330,4647,375],[2320,4639,250],5));
      later(scene,8,()=>camera(player,scene,[2324,4644,250],[2320,4639,200],5));
      later(scene,15,()=>camera(player,scene,[2330,4641,400],[2342,4655,25]));
      later(scene,16,()=>resume(player,ROMEO_NPC_ID,CRYPT_VARIANT,text));
    };
    if(scene.kind==="crypt"&&text==="Ohhh, ok then...")event.after=()=>{
      frozenDialogue(player);scene.actors.get(ROMEO_NPC_ID)?.getMovementQueue().addSteps(scene.sourceTile(2323,4643));
      later(scene,1,()=>camera(player,scene,[2322,4639,300],[2328,4654,25]));
      later(scene,14,()=>resume(player,ROMEO_NPC_ID,CRYPT_VARIANT,text));
    };
    if(text==="Poor Juliet...make preparations for her body to be placed in the Crypt...")event.after=()=>{
      if(quest.getStage(player)===50&&held(player,CADAVA_POTION_ITEM_ID)) {player.getInventory().deleteNumber(CADAVA_POTION_ITEM_ID,1);quest.setStage(player,60);player.getPacketSender().sendVarbit(JULIET_VARBIT,1);}
      endScene(player);
    };
  }

  function handleDialogueAction(event) {
    if (!QUEST_NPC_IDS.has(event.npcId) && event.npcId!==PHILLIPA_NPC_ID && event.npcId!==DRAUL_NPC_ID) return;
    const { player, stepId } = event;

    if(stepId==="QBkmu3"){event.handled=true;sermon(event);return;}
    if(stepId==="LEub3y"||stepId==="UCaOJi"){event.handled=true;beginScene(event,stepId==="LEub3y"?"juliet":"crypt");return;}
    if(stepId==="omBZmz"){drinkPotion(event);return;}
    if(stepId==="JoDYXh"||stepId==="tS4Bn9"||stepId==="kLjElL"){event.box={items:[CADAVA_POTION_ITEM_ID]};return;}
    if(stepId==="nn0y_2"){event.box={statement:true};return;}
    if(stepId==="mHvTuS"){event.box={statement:true};return;}
    if (stepId === JULIET_GIVES_MESSAGE || stepId === JULIET_GIVES_ANOTHER_MESSAGE) {
      if (player.getInventory().isFull() || held(player,JULIETS_MESSAGE_ITEM_ID)) {
        player.sendMessage("You need a free inventory space before Juliet can give you the message.");
      } else {
        player.getInventory().adds(JULIETS_MESSAGE_ITEM_ID, 1);
        event.box={items:[JULIETS_MESSAGE_ITEM_ID]};
        if (quest.getStage(player) < STAGE_SPOKEN_TO_JULIET) {
          quest.setStage(player, STAGE_SPOKEN_TO_JULIET);
        }
      }
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === ROMEO_TAKES_MESSAGE) {
      if (quest.getStage(player)!==20 || player.getAttribute(MESSAGE_ATTRIBUTE)) return;
      if (!held(player,JULIETS_MESSAGE_ITEM_ID)) return;
      player.getInventory().deleteNumber(JULIETS_MESSAGE_ITEM_ID,1);
      player.setAttribute(MESSAGE_ATTRIBUTE,1);
      event.box={items:[JULIETS_MESSAGE_ITEM_ID]};
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === APOTHECARY_TAKES_BERRIES || stepId === APOTHECARY_TAKES_BERRIES_AGAIN) {
      if (!held(player, CADAVA_BERRIES_ITEM_ID)) return;
      berryHandover.add(player);mixed.delete(player);event.box={items:[CADAVA_BERRIES_ITEM_ID]};
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === APOTHECARY_GIVES_POTION || stepId === APOTHECARY_GIVES_POTION_AGAIN) {
      if (!berryHandover.has(player) || !held(player,CADAVA_BERRIES_ITEM_ID)) {event.handled=true;event.end=true;return;}
      {
        player.getInventory().deleteNumber(CADAVA_BERRIES_ITEM_ID,1);berryHandover.delete(player);mixed.delete(player);
        player.getInventory().adds(CADAVA_POTION_ITEM_ID, 1);
        event.box={items:[CADAVA_POTION_ITEM_ID]};
        if (quest.getStage(player) < STAGE_SPOKEN_TO_APOTHECARY) {
          quest.setStage(player, STAGE_SPOKEN_TO_APOTHECARY);
        }
      }
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === JULIET_TAKES_POTION) {
      if (!held(player, CADAVA_POTION_ITEM_ID)) return;
      if (quest.getStage(player)!==50)return;
      event.box={items:[CADAVA_POTION_ITEM_ID]};
      event.handled = true;
      event.end = false;
      return;
    }

    if (stepId === ROMEO_QUEST_COMPLETE) {
      if (quest.getStage(player)===60 && scenes.get(player)?.kind==="crypt") endScene(player,()=>{quest.complete(player);player.getPacketSender().sendVarbit(JULIET_VARBIT,2);});
      event.handled = true;
    }
  }

  function later(key,ticks,fn) { TaskManager.submit(new CountdownTask(key,ticks,fn)); }
  function fade(player,out) { player.getPacketSender().sendSubInterface((161<<16)|1,174,1,{postScripts:[{scriptId:948,args:out?[0,255,0,0,50]:[0,0,0,255,50]}]}); }
  function frozenDialogue(player, text = "") {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0,{execute:()=>StatementDialogue.send(player,text,false)})));
  }
  function timedSpeech(player,npcId,text) {
    const sender=player.getPacketSender(),group=npcId===null?217:231;
    sender.sendChatboxInterface(group).sendString(text,(group<<16)|6).sendString("",(group<<16)|5).sendInterfaceFlagsRange((group<<16)|5,-1,-1,0);
    if(npcId===null) sender.sendPlayerHeadOnInterface((group<<16)|2);
    else sender.sendNpcHeadOnInterface(npcId,(group<<16)|2).sendString(npcId===CONGREGATION_NPC_ID?"Congregation":"",(group<<16)|4);
  }
  function tail(steps,id) {
    for(let i=0;i<steps.length;i++) {
      if(steps[i].id===id || steps[i].text===id || steps[i].player===id) return steps.slice(i+1);
      for(const nested of [steps[i].steps,...(steps[i].options??[]).map(o=>o.steps)]) { const found=nested&&tail(nested,id);if(found)return found; }
    }
    return null;
  }
  function resume(player,npcId,variant,anchor,include=false) {
    startTranscript(api,player,npcId,"Romeo & Juliet",variant,steps=>{
      const rest=tail(steps,anchor)??[];
      return include?[{type:"line",speaker:"Apothecary",text:anchor},...rest]:rest;
    });
  }
  class RomanceScene extends TemplatedInstanceArea {
    constructor(player,kind) {
      super(4,4);this.owner=player;this.kind=kind;this.origin=kind==="juliet"?[3144,3416,1]:[2320,4632,0];
      this.returnTile=kind==="juliet"?new Location(3157,3425,1):player.getLocation().clone();this.actors=new Map();
      for(let x=0;x<4;x++)for(let y=0;y<4;y++)this.setChunk(this.origin[2],x,y,{sourceChunkX:this.origin[0]/8+x,sourceChunkY:this.origin[1]/8+y,sourcePlane:this.origin[2],rotation:0});
    }
    sourceTile(x,y) { return this.tile(x-this.origin[0],y-this.origin[1],this.origin[2]); }
    canTeleport(){return false;} canAttack(){return false;}
    postLeave(actor,logout) {
      if(actor===this.owner) {
        scenes.delete(actor);TaskManager.cancelTasks(this);
        for(const npc of this.actors.values())api.removeNpc(npc);
        actor.getMovementQueue().setBlockMovement(false);actor.setUntargetable(false);
        actor.getPacketSender().sendVarbit(6719,0).sendVarbit(12393,0).sendCameraUnlock(false).sendCameraReset().closeSubInterface((161<<16)|1);
        if(logout)actor.moveTo(this.returnTile);
      }
      super.postLeave(actor,logout);
    }
  }
  function actor(scene,id,x,y) {
    const tile=scene.sourceTile(x,y),npc=api.spawnNpc({id,x:tile.getX(),y:tile.getY(),z:tile.getZ(),owner:scene.owner,ownerOnly:true,wanderRadius:0});
    if(npc){scene.enter(npc);scene.actors.set(id,npc);}return npc;
  }
  function camera(player,scene,c,l,rate=100) {
    const a=scene.sourceTile(c[0],c[1]),b=scene.sourceTile(l[0],l[1]);
    const options={rate,rate2:rate,heightRelative:false};
    player.getPacketSender().sendCameraMoveTo(a.getX(),a.getY(),c[2],options).sendCameraLookAt(b.getX(),b.getY(),l[2],options);
  }
  function endScene(player,done) {
    const scene=scenes.get(player);if(!scene)return;
    fade(player,true);player.getDialogueManager().reset();
    later(scene,3,()=>{scene.leave(player,false);player.moveTo(scene.returnTile);player.getPacketSender().sendInterfaceRemoval();if(done)later(player,2,done);});
  }
  function beginScene(event,kind) {
    const {player}=event;if(scenes.has(player))return;
    if(kind==="juliet"&&!held(player,CADAVA_POTION_ITEM_ID))return;
    const scene=new RomanceScene(player,kind);scenes.set(player,scene);
    player.getMovementQueue().reset().setBlockMovement(true);player.setUntargetable(true);
    player.getPacketSender().sendVarbit(6719,2).sendVarbit(12393,1);fade(player,true);frozenDialogue(player);
    for(let axis=0;axis<5;axis++)player.getPacketSender().sendCameraShake(axis,0,0,0);
    later(scene,3,()=>{
      const spawn=kind==="juliet"?[3157,3425]:[2333,4646];player.moveTo(scene.sourceTile(...spawn));scene.enter(player);fade(player,false);
      if(kind==="juliet") {
        actor(scene,NpcIdentifiers.JULIET,3157,3426);actor(scene,PHILLIPA_NPC_ID,3156,3426);
        camera(player,scene,[3153,3422,375],[3156,3425,175]);
      }else actor(scene,ROMEO_NPC_ID,2333,4645);
      resume(player,event.npcId,kind==="juliet"?POTION_VARIANT:CRYPT_VARIANT,event.stepId);
    });
  }
  function sermon(event) {
    const {player}=event,key={};timed.set(player,key);frozenDialogue(player);
    player.getMovementQueue().setBlockMovement(true);
    player.getPacketSender().sendCameraMoveTo(3254,3486,325,{rate:100,rate2:100,heightRelative:false}).sendCameraLookAt(3256,3476,25,{rate:100,rate2:100,heightRelative:false});
    timedSpeech(player,CONGREGATION_NPC_ID,"Zzzzzzzzz");
    for(const [tick,text] of [[5,"Yes, well, it certainly seems"],[7,"like you have a captive"],[9,"audience!"]])later(key,tick,()=>{
      player.forceChat(text);if(tick===5)timedSpeech(player,null,"Yes, well, it certainly seems like you have a captive audience!");
    });
    later(key,14,()=>{
      timed.delete(player);player.getMovementQueue().setBlockMovement(false);player.getPacketSender().sendCameraReset();
      startTranscript(api,player,FATHER_LAWRENCE_NPC_ID,"Romeo & Juliet","finding-father-lawrence-talking-to-father-lawrence",steps=>{
        const pos=steps.findIndex(s=>s.text?.startsWith("Ok, ok...what do you want"));return steps.slice(pos);
      });
    });
  }
  function mixPotion(event) {
    const {player}=event;if(!berryHandover.has(player)||mixed.has(player))return;
    mixed.add(player);const key={};timed.set(player,key);frozenDialogue(player);player.getMovementQueue().setBlockMovement(true);
    later(key,1,()=>{
      const npc=event.npc??World.getNpcsNear(player.getLocation(),16,player.getPrivateArea?.()??null).find(npc=>npc?.getId()===APOTHECARY_NPC_ID);
      npc?.performAnimation(new Animation(3283));npc?.performGraphic(new Graphic(188,0,64));player.getPacketSender().sendSoundEffect(1930,1,0);
    });
    later(key,3,()=>{
      timed.delete(player);player.getMovementQueue().setBlockMovement(false);
      resume(player,APOTHECARY_NPC_ID,quest.getStage(player)>=50?POTION_AGAIN_VARIANT:POTION_FIRST_VARIANT,"Phew! Here is what you need.",true);
    });
  }
  function drinkPotion(event) {
    const {player}=event;event.handled=true;if(!held(player,CADAVA_POTION_ITEM_ID))return;
    const key={};timed.set(player,key);frozenDialogue(player);player.getMovementQueue().setBlockMovement(true);player.setUntargetable(true);
    later(key,2,()=>{
      if(!held(player,CADAVA_POTION_ITEM_ID)){clearTimed(player);return;}
      player.getInventory().deleteNumber(CADAVA_POTION_ITEM_ID,1);player.getInventory().adds(ItemIdentifiers.VIAL,1);player.performAnimation(new Animation(829));
    });
    later(key,4,()=>player.getPacketSender().sendCameraShake(3,0,20,2));
    later(key,7,()=>{player.performAnimation(new Animation(836));timedSpeech(player,null,"Urk!");});
    later(key,13,()=>{player.sendMessage("Oh dear...you are nearly dead.");fade(player,true);});
    later(key,16,()=>player.performAnimation(Animation.DEFAULT_RESET_ANIMATION));
    later(key,18,()=>{fade(player,false);StatementDialogue.send(player,"Some time later.....",false);});
    later(key,20,()=>{
      clearTimed(player);resume(player,APOTHECARY_NPC_ID,DRINK_VARIANT,"eAglYz");
    });
  }
  function clearTimed(player) {
    const key=timed.get(player);if(key)TaskManager.cancelTasks(key);timed.delete(player);
    player.getMovementQueue().setBlockMovement(false);player.setUntargetable(false);
    player.getPacketSender().sendCameraReset().closeSubInterface((161<<16)|1);
  }
  function handleItemAction(event) {
    if(event.itemId!==CADAVA_POTION_ITEM_ID)return;
    const action=String(event.option??event.item?.getDefinition?.()?.getInventoryActions?.()?.[event.clickType-1]??"").toLowerCase();
    if(action!=="look-at"&&action!=="drink")return;
    event.handled=true;
    const at=event.player.getLocation();const inShop=at.getZ()===0&&at.getX()>=3189&&at.getX()<=3197&&at.getY()>=3400&&at.getY()<=3407;
    startTranscript(api,event.player,APOTHECARY_NPC_ID,"Romeo & Juliet",action==="look-at"?LOOK_VARIANT:inShop?DRINK_VARIANT:OUTSIDE_VARIANT);
  }
  function handleLogout({player}) {
    clearTimed(player);const scene=scenes.get(player);if(scene)scene.leave(player,true);pendingStart.delete(player);berryHandover.delete(player);mixed.delete(player);
  }
  function restoreJuliet({player}) { player.getPacketSender().sendVarbit(JULIET_VARBIT,quest.isComplete(player)?2:quest.getStage(player)>=STAGE_JULIET_IN_CRYPT?1:0); }

  // Pick Cadava berries from the bushes (reference locs 23625-23627).
  function pickCadavaBerries(event) {
    if (!CADAVA_BUSH_LOC_IDS.has(event.objectId)) return;
    const action = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (action !== "pick-from") return;
    event.handled = true;
    if (event.player.getInventory().isFull()) {
      event.player.sendMessage("You do not have room for any Cadava berries.");
      return;
    }
    event.player.getInventory().adds(CADAVA_BERRIES_ITEM_ID, 1);
    event.player.sendMessage("You pick some Cadava berries.");
  }

  quest = registerQuest(api, {
    key: "romeo_and_juliet",
    name: "Romeo & Juliet",
    varpId: VARP_ROMEO_AND_JULIET,
    startedValue: STAGE_SPOKEN_TO_ROMEO,
    completionValue: STAGE_COMPLETE,
    questPoints: 5,
    completionJingleId: 154,
    xpRewards: [],
    scrollItemId: CADAVA_POTION_ITEM_ID,
    rewardItemLabel: "Cadava potion",
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onObjectInteraction(pickCadavaBerries);
  api.onItemAction(handleItemAction);
  api.persistAttribute(MESSAGE_ATTRIBUTE,0);
  api.onPlayerLogin(restoreJuliet);
  api.onPlayerLogout(handleLogout);
};
