"use strict";

const { H, level, requireLevel, hasTool, nearby, exchange, xp, begin, roll } = require("./Context.Hunter");
const borrowed = new Set();
const ATTRIBUTE = "hunter.aerial-feed";

function talk({player,npc}) {
  if (!nearby(player,npc)) return true;
  require("./Context.Hunter").choose(player,[["Borrow or return a cormorant",()=>{if(nearby(player,npc))borrow({player});}],
    ["Feed whole fish (20 pearls)",()=>{
      if(!nearby(player,npc))return;
      if(!player.getAttribute(ATTRIBUTE)&&!exchange(player,[[H.core.ItemIdentifiers.MOLCH_PEARL,20]],[]))return;
      player.setAttribute(ATTRIBUTE,true);player.sendMessage("Your cormorant can now eat whole fish when you run out of bait.");
    }]]);
  return true;
}

function glove(player, id) {
  player.getEquipment().set(H.core.Equipment.WEAPON_SLOT, new H.core.Item(id, id > 0 ? 1 : 0));
  player.getEquipment().refreshItems();
  player.getUpdateFlag().flag(H.core.Flag.APPEARANCE);
}

function borrow({ player }) {
  if (borrowed.has(player)) { cleanup({ player }); player.sendMessage("You return the cormorant to Alry."); return true; }
  if (!requireLevel(player, 35) || !requireLevel(player, 43, H.core.Skill.FISHING)) return true;
  const E = H.core.Equipment;
  if ([E.WEAPON_SLOT, E.SHIELD_SLOT, E.HANDS_SLOT].some(slot => player.getEquipment().get(slot).getId() > 0)) {
    player.sendMessage("Remove your weapon, shield and gloves before taking a cormorant."); return true;
  }
  borrowed.add(player);
  H.players.add(player);
  glove(player, H.core.ItemIdentifiers.CORMORANTS_GLOVE_2);
  player.sendMessage("Alry lends you a cormorant. Bring king worms to feed it.");
  return true;
}

function fish({ player, npc, npcId }) {
  if (npcId !== H.core.NpcIdentifiers.FISHING_SPOT_12) return false;
  if (!borrowed.has(player)) { player.sendMessage("Ask Alry for a cormorant first."); return true; }
  if (!nearby(player, npc, 9) || !requireLevel(player, 35) || !requireLevel(player, 43, H.core.Skill.FISHING)) return true;
  const I = H.core.ItemIdentifiers;
  const bait = [I.FISH_OFFCUTS, I.FINE_FISH_OFFCUTS, I.KING_WORM,
    ...(player.getAttribute(ATTRIBUTE) ? H.data.aerialFish.map(f => f.item) : [])].find(id => player.getInventory().contains(id));
  if (!bait) { player.sendMessage("Your cormorant needs king worms or fish offcuts."); return true; }
  const range = require("./Context.Hunter").distance(player.getLocation(), npc.getLocation());
  const duration = Math.max(1, Math.ceil(range / 2));
  const started = begin(player, duration, require("./Context.Hunter").ANIM.FALCON, () => {
    if (!borrowed.has(player) || !player.getInventory().contains(bait) || !nearby(player, npc, 9)
      || !requireLevel(player, 35) || !requireLevel(player, 43, H.core.Skill.FISHING)) return;
    player.getPacketSender().sendGraphic(new H.core.Graphic(1633), npc.getLocation());
    const combined = Math.floor((level(player, H.core.Skill.FISHING) * 2 + level(player)) / 3);
    const sample = roll(0, Math.max(0, combined - 1));
    const def = [...H.data.aerialFish].reverse().find((f, i) => sample >= [82, 67, 52, 0][i]
      && level(player) >= f.hunter && level(player, H.core.Skill.FISHING) >= f.fishing) ?? H.data.aerialFish[0];
    const count = (player.getAttribute("hunter.aerial-catches") ?? 0) + 1;
    const consume = bait === I.KING_WORM || count >= 4 || count === 3 && roll(0, 1) === 1;
    if (consume && !exchange(player, [[bait, 1]], [])) return;
    player.setAttribute("hunter.aerial-catches", consume ? 0 : count);
    const fish = roll(1, 20000) === 1 ? I.GOLDEN_TENCH : def.item;
    const blessing = [I.RADAS_BLESSING_1,I.RADAS_BLESSING_2,I.RADAS_BLESSING_3,I.RADAS_BLESSING_4]
      .findIndex(id => player.getEquipment().getItems().some(item => item?.getId() === id));
    const flakes = player.getInventory().contains(I.SPIRIT_FLAKES) && exchange(player, [[I.SPIRIT_FLAKES,1]], [[fish,2]], false);
    if (flakes) exchange(player, [[I.SPIRIT_FLAKES,1]], []);
    const doubled = Math.random() < (flakes ? 0.5 : 0) + (blessing + 1) * 0.02;
    const amount = doubled ? 2 : 1;
    if (!exchange(player, [], [[fish, amount]]) && fish === I.GOLDEN_TENCH) require("./Context.Hunter").drop(player, [[fish, amount]], player.getLocation());
    const denominator = Math.max(1, 100 - (combined - 40) * 25 / 59);
    if (Math.random() < 1.5 / denominator && !exchange(player, [], [[I.MOLCH_PEARL, 1]])) require("./Context.Hunter").drop(player, [[I.MOLCH_PEARL, 1]], player.getLocation());
    for (const [tier, modifier] of [["BEGINNER",0.2],["EASY",1.7],["MEDIUM",2],["HARD",3.3],["ELITE",10]]) {
      if (require("./Context.Hunter").ownsClue(player,tier)) continue;
      const denominator = Math.floor(636833 / (100 + level(player,H.core.Skill.FISHING)) * modifier);
      if (roll(1,denominator) !== 1) continue;
      const id = I[`${require("./Context.Hunter").questComplete(player,"x_marks_the_spot") ? "SCROLL_BOX" : "CLUE_BOTTLE"}_${tier}_`];
      if (!exchange(player,[],[[id,1]])) require("./Context.Hunter").drop(player,[[id,1]],player.getLocation());
    }
    xp(player, def.hunterXp, "aerial-fishing", npcId);
    player.getSkillManager().addExperiences(H.core.Skill.FISHING, def.fishingXp);
    H.api.emitCustomEvent("fishing:success", { player, skill: H.core.Skill.FISHING, petBase: 636833 });
  });
  if (started) {
    player.getPacketSender().sendGraphic(new H.core.Graphic(1631), player.getLocation());
    player.getPacketSender().sendProjectile(player.getLocation(), npc.getLocation(), 0, duration * 30, 1632, 20, 20, null, 0, 0, 0);
  }
  return true;
}


function cut(event) {
  const pair = [event.usedItemId, event.usedWithItemId];
  const fish = H.data.aerialFish.find(f => pair.includes(f.item));
  if (!fish || !pair.includes(H.core.ItemIdentifiers.KNIFE)) return;
  event.handled = true;
  if (exchange(event.player, [[fish.item, 1]], [[H.core.ItemIdentifiers.FISH_OFFCUTS, 1]]))
    event.player.getSkillManager().addExperiences(H.core.Skill.COOKING, fish.cookingXp);
}

function tench(event) {
  if (event.itemId !== H.core.ItemIdentifiers.GOLDEN_TENCH || event.target.getId() !== H.core.NpcIdentifiers.ALRY_THE_ANGLER) return;
  event.handled = true;
  if (nearby(event.player, event.target) && exchange(event.player, [[event.itemId, 1]], [[H.core.ItemIdentifiers.MOLCH_PEARL, 100]]))
    event.player.sendMessage("Alry exchanges your golden tench for 100 Molch pearls.");
}

function equipment(event) {
  if (borrowed.has(event.player) && [H.core.Equipment.WEAPON_SLOT, H.core.Equipment.SHIELD_SLOT, H.core.Equipment.HANDS_SLOT].includes(event.slot)) {
    event.allow = false; event.player.sendMessage("Return your cormorant to Alry first.");
  }
}

function process() {
  for (const player of borrowed) {
    const p = player.getLocation();
    if (p.getZ() !== 0 || p.getX() < 1350 || p.getX() > 1400 || p.getY() < 3600 || p.getY() > 3650) cleanup({ player });
  }
}

function cleanup({ player }) {
  if (!borrowed.delete(player)) return;
  const I = H.core.ItemIdentifiers;
  if ([I.CORMORANTS_GLOVE, I.CORMORANTS_GLOVE_2].includes(player.getEquipment().get(H.core.Equipment.WEAPON_SLOT).getId())) glove(player, -1);
}

module.exports = { ATTRIBUTE, talk, borrow, fish, cut, tench, equipment, process, cleanup };
