"use strict";
const C = require("./Context.Hunter"), { H } = C;
const tasks = require("./RumourData.json"), loot = require("./SackLoot.json");
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
function assign(player, index) {
  const s = state(player), master = masters()[index], current = s.assignments[index];
  if (!s.unlocked) { player.sendMessage("Speak to Guild Scribe Verity to learn about Hunters' Rumours first."); return; }
  if (player.getSkillManager().getMaxLevel(H.core.Skill.HUNTER) < master[1]
    || index === 5 && !C.questComplete(player,"at_first_light")) { player.sendMessage("You do not meet this hunter's requirements."); return; }
  if (current) {
    const task = tasks[current.task], part = H.core.ItemIdentifiers[task.part];
    s.active = index;
    if (current.found && player.getInventory().contains(part)) {
      const I = H.core.ItemIdentifiers, sack = I[`HUNTERS_LOOT_SACK_${master[2].toUpperCase()}_`];
      if (!C.exchange(player, [[part,1]], [[sack,1]])) { player.getInventory().full(); return; }
      const amount = (player.getSkillManager().getMaxLevel(H.core.Skill.HUNTER)+5)*master[3];
      player.getSkillManager().addExperiences(H.core.Skill.HUNTER,amount);
      s.completed++; s.previous = current.task; delete s.assignments[index];
      player.sendMessage(`Rumour completed! You have completed ${s.completed} rumours.`);
    } else { player.sendMessage(`Your active rumour is ${task.name}. Bring back ${H.core.ItemDefinition.forId(part).getName()}.`); return; }
  }
  const blocked = Object.values(s.assignments).map(a=>a.task);
  const pool = tasks.map((task,i)=>[task,i]).filter(([task,i])=> task.masters.includes(index) && eligible(player,task)
    && !blocked.includes(i) && (s.repeat !== false || i !== s.previous));
  if (!pool.length) { player.sendMessage("No eligible rumours remain. Switch hunters or clear your assignments with Gilman."); return; }
  const [task,id] = pool[C.roll(0,pool.length-1)];
  s.assignments[index] = { task:id, count:0, found:false }; s.active = index;
  player.sendMessage(`Your new rumour is ${task.name}. Hunt it until you find its rare creature part.`);
}
function interact({player,npcId,npc}) {
  const index=masters().findIndex(m=>m[0]===npcId);
  if(index<0)return false;
  if (!C.nearby(player,npc)) return true;
  if(index===0) C.choose(player,[["Request or complete a rumour",()=>assign(player,index)],
    ["Clear all my rumours",()=>C.choose(player,[["Yes, clear all assignments",()=>{const s=state(player);s.assignments={};s.active=null;}],["Keep my assignments",()=>{}]],npc)]],npc);
  else assign(player,index);
  return true;
}
function verity({player,npc}) {
  if(!C.nearby(player,npc))return true;
  const s=state(player);s.unlocked=true;
  C.choose(player,[["Allow consecutive rumours",()=>{s.repeat=true;player.sendMessage("Consecutive rumours enabled.");}],
    ["Avoid consecutive rumours",()=>{s.repeat=false;player.sendMessage("Consecutive rumours disabled.");}],
    ["Check my rumour",()=>check({player})]],npc);
  return true;
}
function check({player}) {
  const s=state(player), a=s.assignments[s.active];
  player.sendMessage(a ? `Your active rumour is ${tasks[a.task].name}.` : "You have no active Hunter rumour.");
  return true;
}
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
  if(!C.exchange(player,[],[[part,1]])) {
    if(pity){player.sendMessage("Free an inventory slot to receive the rare creature part on your next catch.");return;}
    C.drop(player,[[part,1]],player.getLocation());
  }
  a.found=true;
  player.sendMessage("You find a rare piece of the creature! Take it back to the Hunter Guild.");
}
function owns(player,id) {return player.getInventory().contains(id)||C.hasTool(player,id)||Array.from({length:H.core.Bank.TOTAL_BANK_TABS},(_,tab)=>player.getBank(tab)).some(bank=>bank?.contains(id));}
function cascade(player, skill, rows) {
  const l=C.level(player,skill);
  for(const[id,low,high,required=1]of rows)if(l>=required&&Math.random()<C.probability(low,high,l))return id;
  return rows.at(-1)[0];
}
function sackRewards(player,tier) {
  const I=H.core.ItemIdentifiers,s=state(player),rows=loot[tier],rewards=[];
  for(let i=0;i<({basic:5,adept:7,expert:9,master:11})[tier];i++) {
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
    if(s.completed>=100&&!s.enhanced&&!s.tornEnhanced)rewards.push([I.TORN_ENHANCED_QUETZAL_WHISTLE_BLUEPRINT,1]);
    if(s.completed>=250&&!s.perfected&&!s.tornPerfected)rewards.push([I.TORN_PERFECTED_QUETZAL_WHISTLE_BLUEPRINT,1]);
  }
  return rewards;
}
function open({player,itemId}) {
  const I=H.core.ItemIdentifiers,tier=Object.keys(loot).find(t=>I[`HUNTERS_LOOT_SACK_${t.toUpperCase()}_`]===itemId);
  if(!tier)return false;
  if(!player.getInventory().contains(itemId))return true;
  let pending=pendingSacks.get(player);if(!pending)pendingSacks.set(player,pending=new Map());
  if(!pending.has(itemId))pending.set(itemId,sackRewards(player,tier));
  const rewards=pending.get(itemId);
  if(!C.exchange(player,[[itemId,1]],rewards)){player.getInventory().full();return true;}
  const s=state(player);
  for(const[id]of rewards){if(id===I.ENHANCED_QUETZAL_WHISTLE_BLUEPRINT)s.enhanced=true;if(id===I.PERFECTED_QUETZAL_WHISTLE_BLUEPRINT)s.perfected=true;
    if(id===I.TORN_ENHANCED_QUETZAL_WHISTLE_BLUEPRINT)s.tornEnhanced=true;if(id===I.TORN_PERFECTED_QUETZAL_WHISTLE_BLUEPRINT)s.tornPerfected=true;
    if([I.GUILD_HUNTER_HEADWEAR,I.GUILD_HUNTER_TOP,I.GUILD_HUNTER_LEGS,I.GUILD_HUNTER_BOOTS].includes(id))s.outfit++;}
  pending.delete(itemId);
  if(['expert','master'].includes(tier))H.api.emitCustomEvent("hunter:success",{player,skill:H.core.Skill.HUNTER,npcId:H.core.NpcIdentifiers.QUETZIN,method:"rumour-sack",petChance:tier==='master'?1000:2000});
  return true;
}
module.exports={ATTRIBUTE,state,masters,interact,verity,check,success,open,assign,sackRewards,tasks};
