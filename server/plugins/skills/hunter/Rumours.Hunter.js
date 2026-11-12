"use strict";
const C = require("./Context.Hunter"), { H } = C;
const tasks = require("../data/rumour-data.json"), loot = require("../data/sack-loot.json");
const ATTRIBUTE = "hunter.rumours";
const pendingSacks = new WeakMap();
function state(player) {
  let s = player.getAttribute(ATTRIBUTE);
  if (!s || typeof s !== "object" || Array.isArray(s)) player.setAttribute(ATTRIBUTE, s = { assignments: {}, active: null, completed: 0, outfit: 0 });
  return s;
}
function masters() {
  const N = H.core.NpcIdentifiers;
  return [[N.HUNTMASTER_GILMAN_NOVICE_,46,"basic",50],[N.GUILD_HUNTER_CERVUS_ADEPT_,57,"adept",50],
    [N.GUILD_HUNTER_ORNUS_ADEPT_,57,"adept",50],[N.GUILD_HUNTER_ACO_EXPERT_,72,"expert",55],
    [N.GUILD_HUNTER_TECO_EXPERT_,72,"expert",55],[N.GUILD_HUNTER_WOLF_MASTER_,91,"master",60]];
}
function eligible(player, task) {
  const N = H.core.NpcIdentifiers;
  return player.getSkillManager().getMaxLevel(H.core.Skill.HUNTER) >= task.level
    && (!["CHINCHOMPA","CARNIVOROUS_CHINCHOMPA","EMBERTAILED_JERBOA"].includes(task.npc) || C.questComplete(player,"eagles_peak"))
    && (task.npc !== "SWAMP_LIZARD" || C.questComplete(player,"priest_in_peril"))
    && (task.npc !== "HERBIBOAR" || C.questComplete(player,"bone_voyage") && player.getSkillManager().getMaxLevel(H.core.Skill.HERBLORE) >= 31)
    && (Number.isInteger(N[task.npc]) || task.npc === "RAZOR_BACKED_KEBBIT");
}
// The six hunters' first names, in masters() order. They sign the status message ("Aco was the source of the rumour.").
const HUNTER_NAMES = ["Gilman", "Cervus", "Ornus", "Aco", "Teco", "Wolf"];
// How a hunter offers a rumour, from rsprox captures 1108/1115 (Cervus, Aco). {creature} is the lowercase creature name.
const OFFERS = [
  "There's been rumours of a rare {creature} coming in. Once you find it, bring back {part}.",
  "I've heard rumours of a strange {creature} that you could check out for me. Once you find it, bring back {part}.",
  "Could you check out the validity of this report for me? Someone thinks they've seen an odd {creature}. Once you find it, bring back {part}.",
  "We've got rumours circling about an odd {creature}. You can follow up on that if you'd like? Once you find it, bring back {part}.",
  "We've got reports of a slightly different {creature} in the local population. Once you find it, bring back {part}.",
  "Looks like we need some information on a unique specimen amongst the local {creature} population. Once you find it, bring back {part}.",
];
const TOO_LOW = "I don't think you'd be able to hunt the creatures on my list. Rumour has it you're not the most experienced hunter.";
const NEEDS_VERITY = "Looks like you could do with talking to Verity first, given you're new to this whole business.";
/** How the hunters word the part: fur, claws, hooves, wings, horn and tail are captured; feathers, ear and tooth follow the same pattern (unverified). */
function partPhrase(itemName) {
  const name = itemName.toLowerCase();
  if (/fur|fluff|tuft/.test(name)) return "some of its fur";
  if (/claw/.test(name)) return "one of its claws";
  if (/hoof/.test(name)) return "one of its hooves";
  if (/wing/.test(name)) return "one of its wings";
  if (/horn/.test(name)) return "its horn";
  // Feathers before tail: the wagtail's "Tailfeathers" is not a tail. The tail, ear and tooth phrases follow the pattern (tail is captured).
  if (/feather/.test(name)) return "some of its feathers";
  if (/tail/.test(name)) return "its tail";
  if (/ear/.test(name)) return "one of its ears";
  if (/tooth|teeth/.test(name)) return "one of its teeth";
  return `its ${name}`;
}
function say(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = H.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text), new EndDialogue(1)));
}
function target(task) {
  const part = H.core.ItemDefinition.forId(H.core.ItemIdentifiers[task.part]).getName();
  return { creature: task.name.toLowerCase(), part: partPhrase(part) };
}
/** "Rumour" on a guild hunter: hand in a found part (the next click offers another), else offer or remind. */
function assign(player, index, npcId = masters()[index][0]) {
  const s = state(player), master = masters()[index], current = s.assignments[index];
  if (!s.unlocked) { say(player, npcId, NEEDS_VERITY); return; }
  if (player.getSkillManager().getMaxLevel(H.core.Skill.HUNTER) < master[1]
    || index === 5 && !C.questComplete(player,"at_first_light")) { say(player, npcId, TOO_LOW); return; }
  if (current) {
    const task = tasks[current.task], part = H.core.ItemIdentifiers[task.part];
    s.active = index;
    if (!(current.found && player.getInventory().contains(part))) {
      // Captured wording (rsprox 1104, Gilman), including its "a" before a vowel.
      const { creature, part: phrase } = target(task);
      say(player, npcId, `You're hunting for me at the moment. This rumour was about a ${creature}. You'll need to bring back ${phrase}.`);
      return;
    }
    const I = H.core.ItemIdentifiers, sack = I[`HUNTERS_LOOT_SACK_${master[2].toUpperCase()}_`];
    if (!C.exchange(player, [[part,1]], [[sack,1]])) { player.getInventory().full(); return; }
    // Content may change the rumour's XP ("hunter:rumour-reward" { player, tier, xp }, a league relic's double).
    const reward = { player, tier: master[2], xp: (player.getSkillManager().getMaxLevel(H.core.Skill.HUNTER)+5)*master[3] };
    H.api?.emitCustomEvent?.("hunter:rumour-reward", reward);
    player.getSkillManager().addExperiences(H.core.Skill.HUNTER,reward.xp);
    s.completed++; s.previous = current.task; delete s.assignments[index];
    player.sendMessage(`You have completed <col=ff3045>${s.completed}</col> rumours for the Hunter Guild.`);
    // "hunter:rumour-completed" { player, completed }: one more (a league's "Complete 10 Hunter Rumours").
    H.api?.emitCustomEvent?.("hunter:rumour-completed", { player, completed: s.completed });
    say(player, npcId, "Thanks for that. I'll mark off that report for you. Would you like another rumour?");
    return;
  }
  const blocked = Object.values(s.assignments).map(a=>a.task);
  const pool = tasks.map((task,i)=>[task,i]).filter(([task,i])=> task.masters.includes(index) && eligible(player,task)
    && !blocked.includes(i) && (s.repeat !== false || i !== s.previous));
  if (!pool.length) { player.sendMessage("No eligible rumours remain. Switch hunters or clear your assignments with Gilman."); return; }
  const [task,id] = pool[C.roll(0,pool.length-1)];
  s.assignments[index] = { task:id, count:0, found:false }; s.active = index;
  const { creature, part } = target(task);
  say(player, npcId, OFFERS[C.roll(0,OFFERS.length-1)].replace("{creature}", creature).replace("{part}", part));
}
function interact({player,npcId,npc}) {
  const index=masters().findIndex(m=>m[0]===npcId);
  if(index<0)return false;
  if (!C.nearby(player,npc)) return true;
  if(index===0) C.choose(player,[["Request or complete a rumour",()=>assign(player,index,npcId)],
    ["Clear all my rumours",()=>C.choose(player,[["Yes, clear all assignments",()=>{const s=state(player);s.assignments={};s.active=null;}],["Keep my assignments",()=>{}]],npc)]],npc);
  else assign(player,index,npcId);
  return true;
}
/** The "Rumour" op: straight to the offer or hand-in, with no menu even on Gilman (rsprox 1108: op 3, one dialogue). */
function rumour({player,npcId,npc}) {
  const index=masters().findIndex(m=>m[0]===npcId);
  if(index<0)return false;
  if(C.nearby(player,npc))assign(player,index,npcId);
  return true;
}
// Guild Scribe Verity's introduction (rsprox 1104 and 1695). The "Yes please." / "No thanks." menu's wording is a guess: only "Yes please." was captured.
const VERITY_GREETING = "Oh, hello there newcomer. I'm Guild Scribe Verity. Do you need me to explain the work we do here?";
const VERITY_TUTORIAL = [
  ["player", "Yes please."],
  ["npc", "So it's nice and simple. Just chat to any of the hunters in here to help them out. They're all following reports that I've split up amongst them."],
  ["player", "Reports?"],
  ["npc", "Indeed. There are all sorts of interesting creatures to hunt out there. Sometimes we get reports of a particularly unique example. When that happens, one of the hunters will set out to find it."],
  ["npc", "If you do decide to take a job from any of the hunters, they'll tell you what type of creature they're looking into. Hunt that creature until you encounter the unique specimen."],
  ["npc", "Once you've caught it, bring some proof back to the hunter that sent you out in the first place. I'm sure they'll reward you for your time."],
  ["player", "I see. Thanks for the information."],
];
/** One chain of NPC and player pages; "then" runs after the last page is dismissed. */
function converse(player, npcId, lines, then) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue, EndDialogue } = H.core;
  const chain = new DialogueChainBuilder();
  lines.forEach(([who, text], i) => chain.add(who === "npc" ? new NpcDialogue(i, npcId, text) : new PlayerDialogue(i, text)));
  chain.add(then ? new ActionDialogue(lines.length, { execute: then }) : new EndDialogue(lines.length));
  player.getDialogueManager().startDialogues(chain);
}
function explain(player, npcId) {
  converse(player, npcId, VERITY_TUTORIAL, () => { state(player).unlocked = true; });
}
function introduce(player, npcId) {
  const { DialogueChainBuilder, NpcDialogue, OptionDialogue } = H.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, VERITY_GREETING),
    new OptionDialogue(1, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) explain(player, npcId);
        else state(player).unlocked = true;
      },
    }, "Yes please.", "No thanks."),
  ));
}
/** Talk-to or Rumour-settings: the introduction until she has given it, then the consecutive-rumours menu. */
function verity({player,npc,npcId}) {
  if(!C.nearby(player,npc))return true;
  const s=state(player);
  if(!s.unlocked){introduce(player,npcId);return true;}
  C.choose(player,[["Allow consecutive rumours",()=>{s.repeat=true;player.sendMessage("Consecutive rumours enabled.");}],
    ["Avoid consecutive rumours",()=>{s.repeat=false;player.sendMessage("Consecutive rumours disabled.");}],
    ["Check my rumour",()=>check({player})],
    ["Explain Hunters' Rumours again",()=>explain(player,npcId)]],npc);
  return true;
}
function check({player}) {
  const s=state(player), a=s.assignments[s.active];
  if(a){const {creature,part}=target(tasks[a.task]);
    player.sendMessage(`Your current rumour target is ${/^[aeiou]/.test(creature)?"an":"a"} ${creature}. You'll need to bring back ${part}. ${HUNTER_NAMES[s.active]} was the source of the rumour.`);}
  else player.sendMessage("You have no active Hunter rumour.");
  return true;
}
// The rare part line, in the game's green, with its jingle.
const PART_FOUND = "<col=229628>You find a rare piece of the creature! You should take it back to the Hunter Guild.";
const PART_DROPPED = "<col=229628>You find a rare piece of the creature! Though without space in your inventory, it drops to the ground.";
const PITY_FULL = "Free an inventory slot to receive the rare creature part on your next catch.";
const PART_SOUND = 2655, PART_DESPAWN_TICKS = 200;
function success({player,npcId,method,creature}) {
  if(method === "herbiboar-tracking")return;
  const s=state(player),a=s.assignments[s.active];if(!a)return;
  const task=tasks[a.task];if(creature ? task.npc!==creature : H.core.NpcIdentifiers[task.npc]!==npcId || npcId===undefined)return;
  a.count++;
  const part=H.core.ItemIdentifiers[task.part],I=H.core.ItemIdentifiers;
  if(tasks.some(t=>player.getInventory().contains(I[t.part])))return;
  const category=method==="herbiboar"?"herbiboar": ["orange","red","black","swamp","tecu"].includes(method)?"net":method;
  const rates={bird:[20,40,38],box:[50,100,94],butterfly:[40,80,76],deadfall:[15,30,28],falconry:[10,20,18],net:[25,50,46],pit:[15,30,28],tracking:[15,30,28],herbiboar:[7,14,12]};
  const rate=rates[category];if(!rate)return;
  const outfit=C.outfit(player),pity=a.count>=rate[outfit?2:1];
  if(!pity&&Math.random()>=(outfit?1.05:1)/rate[0])return;
  const room=C.exchange(player,[],[[part,1]]);
  // A pity part needs a free slot: with a full inventory it is lost and comes again on the next catch.
  // Ours: the line that says so (live's wording is unknown).
  if(!room&&pity){player.sendMessage(PITY_FULL);return;}
  // Without room the part lands under the player, theirs alone, for 200 ticks.
  if(!room)H.core.ItemOnGroundManager.registerLocation(player,new H.core.Item(part,1),player.getLocation().clone(),player.getPrivateArea(),{goesGlobal:false,despawnDelay:PART_DESPAWN_TICKS});
  a.found=true;
  player.sendMessage(room?PART_FOUND:PART_DROPPED);
  player.getPacketSender().sendSound(PART_SOUND,1,0);
}
function owns(player,id) {
  if(player.getInventory().contains(id)||C.hasTool(player,id)||Array.from({length:H.core.Bank.TOTAL_BANK_TABS},(_,tab)=>tab===H.core.Bank.BANK_SEARCH_TAB_INDEX?null:player.getBank(tab)).some(bank=>bank?.contains(id)))return true;
  // A reclaimable kit is still owned; receiving another must not duplicate it on retrieval.
  const grave={player,grave:null,office:[]};H.api.emitCustomEvent("gravestones:state",grave);
  if([...(grave.grave?.items??[]),...grave.office].some(item=>item?.id===id&&item.amount>0))return true;
  const retrieval={player,items:[]};H.api.emitCustomEvent("item-retrieval:items",retrieval);
  return retrieval.items.some(item=>item.itemId===id&&item.amount>0);
}
function cascade(player, skill, rows) {
  const l=C.level(player,skill);
  for(const[id,low,high,required=1]of rows)if(l>=required&&Math.random()<C.probability(low,high,l))return id;
  return rows.at(-1)[0];
}
function sackRewards(player,tier) {
  const I=H.core.ItemIdentifiers,s=state(player),rows=loot[tier],rewards=[];
  // Content may change the sack's loot rolls ("hunter:sack-rolls" { player, tier, rolls }, a league relic's double); not its rare rolls.
  const request={player,tier,rolls:({basic:5,adept:7,expert:9,master:11})[tier]};
  H.api?.emitCustomEvent?.("hunter:sack-rolls",request);
  for(let i=0;i<request.rolls;i++) {
    const count=rows.length+(tier==='basic'?1:2),which=C.roll(0,count-1);
    let id,amount;
    if(which<rows.length){const r=rows[which];id=I[r[0]];if(r[4])id=H.core.ItemDefinition.forId(id).getNoteId();amount=C.roll(r[2],r[3]);}
    else {amount=4;id=which===rows.length?cascade(player,H.core.Skill.WOODCUTTING,[[I.MAGIC_LOGS,-60,60,50],[I.YEW_LOGS,-50,90,36],[I.MAHOGANY_LOGS,-40,130,24],[I.MAPLE_LOGS,0,160],[I.TEAK_LOGS,999,999]]):
      cascade(player,H.core.Skill.HERBLORE,[[I.GRIMY_LANTADYME,-30,60,34],[I.GRIMY_CADANTINE,-10,70,13],[I.GRIMY_KWUARM,10,85],[I.GRIMY_AVANTOE,20,100],[I.GRIMY_IRIT_LEAF,30,115],[I.GRIMY_RANARR_WEED,10,170],[I.GRIMY_TARROMIN,70,-20],[I.GRIMY_HARRALANDER,999,999]]);id=H.core.ItemDefinition.forId(id).getNoteId();}
    rewards.push([id,amount]);
  }
  if(tier!=='basic') {
    if(!s.enhanced&&C.roll(1,50)===1)rewards.push([I.ENHANCED_QUETZAL_WHISTLE_BLUEPRINT,1]);
    if(s.enhanced&&['expert','master'].includes(tier)&&!s.perfected&&C.roll(1,50)===1)rewards.push([I.PERFECTED_QUETZAL_WHISTLE_BLUEPRINT,1]);
    if(!owns(player,I.HUNTSMANS_KIT)&&C.roll(1,50)===1)rewards.push([I.HUNTSMANS_KIT,1]);
    if(C.roll(1,50)===1)rewards.push([[I.GUILD_HUNTER_HEADWEAR,I.GUILD_HUNTER_TOP,I.GUILD_HUNTER_LEGS,I.GUILD_HUNTER_BOOTS][s.outfit%4],1]);
  }
  // Wiki (Hunters' Rumours): the torn enhanced blueprint at 100 rumours comes "from any hunters' loot sack", the torn
  // perfected one at 250 "from any expert or master hunters' loot sack".
  if(s.completed>=100&&!s.enhanced&&!s.tornEnhanced)rewards.push([I.TORN_ENHANCED_QUETZAL_WHISTLE_BLUEPRINT,1]);
  if(['expert','master'].includes(tier)&&s.completed>=250&&!s.perfected&&!s.tornPerfected)rewards.push([I.TORN_PERFECTED_QUETZAL_WHISTLE_BLUEPRINT,1]);
  return rewards;
}
function open({player,itemId}) {
  const I=H.core.ItemIdentifiers,tier=Object.keys(loot).find(t=>I[`HUNTERS_LOOT_SACK_${t.toUpperCase()}_`]===itemId);
  if(!tier)return false;
  if(!player.getInventory().contains(itemId))return true;
  let pending=pendingSacks.get(player);if(!pending)pendingSacks.set(player,pending=new Map());
  if(!pending.has(itemId))pending.set(itemId,sackRewards(player,tier));
  // An unsuccessful opening retains its rolls. Recheck kit ownership at delivery too:
  // another sack may have supplied one since this reward was rolled. Keep every other roll.
  const rewards=pending.get(itemId).filter(([id])=>id!==I.HUNTSMANS_KIT||!owns(player,id));
  if(!C.exchange(player,[[itemId,1]],rewards)){player.getInventory().full();return true;}
  for(const[id,amount]of rewards)H.api.emitCustomEvent("collection-log:obtain",{player,itemId:id,amount});
  const s=state(player);
  for(const[id]of rewards){if(id===I.ENHANCED_QUETZAL_WHISTLE_BLUEPRINT)s.enhanced=true;if(id===I.PERFECTED_QUETZAL_WHISTLE_BLUEPRINT)s.perfected=true;
    if(id===I.TORN_ENHANCED_QUETZAL_WHISTLE_BLUEPRINT)s.tornEnhanced=true;if(id===I.TORN_PERFECTED_QUETZAL_WHISTLE_BLUEPRINT)s.tornPerfected=true;
    if([I.GUILD_HUNTER_HEADWEAR,I.GUILD_HUNTER_TOP,I.GUILD_HUNTER_LEGS,I.GUILD_HUNTER_BOOTS].includes(id))s.outfit++;}
  pending.delete(itemId);
  if(['expert','master'].includes(tier))H.api.emitCustomEvent("hunter:success",{player,skill:H.core.Skill.HUNTER,npcId:H.core.NpcIdentifiers.QUETZIN,method:"rumour-sack",petChance:tier==='master'?1000:2000});
  return true;
}
/** `hunter:rumours-completed` { player, completed }: how many rumours the player has finished. */
function completedCount(request){if(request?.player)request.completed=state(request.player).completed|0;}
module.exports={ATTRIBUTE,state,VERITY_TUTORIAL,masters,interact,rumour,partPhrase,OFFERS,verity,check,success,open,assign,sackRewards,tasks,completedCount};
