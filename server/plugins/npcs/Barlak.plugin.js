/**
 * Barlak in Dorgesh-Kaan buys long and curved bones (Construction experience) and giant snail and
 * tortoise shells (coins; Crafting experience for perfect ones), docs/barlak.md.
 *
 * Talk-to plays his transcript's variant for what the player carries (npc-dialogues.json, page
 * "Barlak"): the bones one when long or curved bones are in the inventory or bank, else the tortoise
 * shell one, else the snail shell one. This plugin answers the transcript's shell conditions, fills
 * its "[X] gp", and pays as his "Thanks..." line is shown.
 *
 * Wiki (Barlak, Long bone, Curved bone, Snail shell, Perfect snail shell, Tortoise shell, Perfect
 * shell): long bone 1,000 coins and 4,500 Construction XP, curved bone 2,000 coins and 6,750 XP
 * (the XP needs a house and an unboosted 30 Construction; the Carpenter's outfit does not apply),
 * banked bones are taken too; every shell 600 coins from the inventory only, perfect ones also
 * 500 Crafting XP.
 *
 * rsprox captures: rec 2964 (rev 230) t350-395, nine long bones: "I'll give you 9000gp for the bones
 * you're carrying and for any you have in your bank. ...", coins and 40,500 Construction XP with
 * "Thanks! Now, let me explain...", then the lecture in a message box, then (shells still carried)
 * straight into "That giant shell...what is it?"; two tortoise shells, 1200gp, paid with "Thanks. If
 * you find any more shells like these, please bring them to me!". Rec 4263 (rev 239) t1111-1118: one
 * tortoise shell, 600gp.
 */
const PAGE = "Barlak";
const BARLAK_NPC = "dorgesh_male_bone_seller";
const VARIANT_BONES = "with-curved-bones-or-long-bones-in-the-player-s-inventory-or-bank";
const VARIANT_SNAIL = "with-snail-shells-or-perfect-snail-shells-in-the-player-s-inventory";
const VARIANT_TORTOISE = "with-tortoise-shells-or-perfect-shells-in-the-player-s-inventory";

/** Coins and experience per item (Wiki item pages). */
const BONES = [["dorgesh_construction_bone", 1000, 4500], ["dorgesh_construction_bone_curved", 2000, 6750]];
const SHELL_PRICE = 600;
const PERFECT_SHELL_XP = 500;
const SHELLS = {
  snail: { plain: "templetrek_snail_shell", perfect: "dorgesh_snail_shell", variant: VARIANT_SNAIL },
  tortoise: { plain: "battle_tortoise_shell", perfect: "dorgesh_tortoise_shell", variant: VARIANT_TORTOISE },
};
const CONSTRUCTION_XP_LEVEL = 30;
const MAX_STACK = 0x7fffffff;

const PRICE_BLANK = /\[X\] ?gp/;
const SHELL_NAMED = new Map([["It's a giant snail shell!", "snail"], ["It's a giant battle tortoise shell!", "tortoise"]]);
const PAY_BONES = "Thanks! Now, let me explain...";
const PAY_SHELLS = [
  "Thanks. If you find any more shells like these, please bring them to me!",
  "Thanks! Now, I don't think I could use that for Construction, but maybe I could make something...",
];
const LECTURE = /^Barlak gives you a short lecture and you learn more about (Construction|Crafting)\.$/;
const LECTURE_BOX_ID = "barlak-lecture";
const CONDITION_PLAIN = "With only not-perfect shells";
const CONDITION_ONE_PERFECT = "With one perfect shell";
const CONDITION_PERFECTS = "With more than one perfect shell";
const CONDITION_SNAIL = "With snail shells or perfect snail shells in the inventory";
const CONDITION_NO_SNAIL = "With no snail shells or perfect snail shells in the inventory";

let api = null;
let core = null;
let ids = null;
let transcript = null;
/** player -> "snail" | "tortoise": the shells he is talking about. */
const talkingAbout = new WeakMap();

function lookup() {
  if (ids) return ids;
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  ids = {
    barlak: core.CacheDefinitions.getNpcId(BARLAK_NPC),
    coins: core.ItemIdentifiers.COINS,
    bones: BONES.map(([name, coins, xp]) => ({ id: obj(name), coins, xp })),
    shells: Object.fromEntries(Object.entries(SHELLS).map(([kind, shell]) =>
      [kind, { plain: obj(shell.plain), perfect: obj(shell.perfect), variant: shell.variant }])),
  };
  return ids;
}

function variants() {
  if (!transcript) transcript = require("../../data/definitions/npc-dialogues.json")[PAGE]?.variants ?? {};
  return transcript;
}

function isBarlak(npcId) {
  return Number.isInteger(npcId) && npcId === lookup().barlak;
}

function bankTabs(player) {
  const tabs = [];
  for (let tab = 0; tab < core.Bank.BANK_SEARCH_TAB_INDEX; tab++) {
    const bank = player.getBank(tab);
    if (bank) tabs.push(bank);
  }
  return tabs;
}

/** Each bone's count, inventory and bank together (Wiki: he takes the banked ones too). */
function boneCounts(player) {
  const tabs = bankTabs(player);
  return lookup().bones.map((bone) => ({
    ...bone,
    count: player.getInventory().getAmount(bone.id) + tabs.reduce((sum, bank) => sum + bank.getAmount(bone.id), 0),
  }));
}

/** Shells in the inventory only (Wiki), unnoted: a noted id is another item. */
function shellCounts(player, kind) {
  const shell = lookup().shells[kind];
  const inventory = player.getInventory();
  return { plain: inventory.getAmount(shell.plain), perfect: inventory.getAmount(shell.perfect) };
}

const hasBones = (player) => boneCounts(player).some((bone) => bone.count > 0);
const hasShells = (player, kind) => { const held = shellCounts(player, kind); return held.plain + held.perfect > 0; };

/** The shells he asks about first: tortoise, then snail (the transcript's tortoise variant leads into the snail one). */
function shellKind(player) {
  return ["tortoise", "snail"].find((kind) => hasShells(player, kind)) ?? null;
}

function selectVariant({ player, npcId }) {
  if (!isBarlak(npcId) || !player) return null;
  if (hasBones(player)) return VARIANT_BONES;
  const kind = shellKind(player);
  talkingAbout.set(player, kind);
  return kind ? SHELLS[kind].variant : null;
}

function answerCondition({ player, npcId, text }) {
  if (!isBarlak(npcId) || typeof text !== "string") return null;
  const condition = text.trim();
  if (condition === CONDITION_SNAIL) return hasShells(player, "snail");
  if (condition === CONDITION_NO_SNAIL) return !hasShells(player, "snail");
  const kind = talkingAbout.get(player);
  if (!kind) return null;
  const { perfect } = shellCounts(player, kind);
  if (condition === CONDITION_PLAIN) return perfect === 0;
  if (condition === CONDITION_ONE_PERFECT) return perfect === 1;
  if (condition === CONDITION_PERFECTS) return perfect > 1;
  return null;
}

function bonesPrice(player) {
  return boneCounts(player).reduce((sum, bone) => sum + bone.count * bone.coins, 0);
}

function shellsPrice(player, kind) {
  const held = shellCounts(player, kind);
  return (held.plain + held.perfect) * SHELL_PRICE;
}

function onLine(line) {
  if (!isBarlak(line.npcId) || typeof line.text !== "string") return;
  const { player, text } = line;
  if (SHELL_NAMED.has(text)) talkingAbout.set(player, SHELL_NAMED.get(text));
  if (PRICE_BLANK.test(text)) {
    const kind = talkingAbout.get(player);
    const price = text.includes("bones") ? bonesPrice(player) : kind ? shellsPrice(player, kind) : 0;
    // Recorded as "9000gp", "1200gp" (rec 2964 t358/t383): no space, no thousands separator.
    line.text = text.replace(PRICE_BLANK, `${price}gp`);
    return;
  }
  if (text === PAY_BONES) line.before = () => payBones(player);
  else if (PAY_SHELLS.includes(text)) line.before = () => payShells(player, talkingAbout.get(player));
}

function stopTalking(player) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
}

/** Whether `amount` coins fit in the inventory once `freed` slots are emptied. */
function coinsFit(player, amount, freed = 0) {
  const inventory = player.getInventory();
  const held = inventory.getAmount(lookup().coins);
  if (held > 0) return held + amount <= MAX_STACK;
  return inventory.getFreeSlots() + freed > 0;
}

/** Wiki: the Construction XP needs a house and an unboosted level 30; below that he still buys them. */
function teachesConstruction(player) {
  if (player.getSkillManager().getMaxLevel(core.Skill.CONSTRUCTION) < CONSTRUCTION_XP_LEVEL) return false;
  const house = { player, owns: true };
  api.emitCustomEvent("construction:owns-house", house);
  return house.owns !== false;
}

function payBones(player) {
  const bones = boneCounts(player).filter((bone) => bone.count > 0);
  const coins = bones.reduce((sum, bone) => sum + bone.count * bone.coins, 0);
  const inventory = player.getInventory();
  const freed = bones.filter((bone) => inventory.getAmount(bone.id) > 0).length;
  // Ours: no room for the coins (a full inventory with every bone banked), so nothing is sold.
  if (!coins || !coinsFit(player, coins, freed)) return stopTalking(player);
  for (const bone of bones) inventory.delete(bone.id, inventory.getAmount(bone.id));
  for (const bank of bankTabs(player)) {
    for (const bone of bones) {
      const banked = bank.getAmount(bone.id);
      if (banked > 0) bank.delete(bone.id, banked);
    }
  }
  inventory.add(new core.Item(lookup().coins, coins));
  if (teachesConstruction(player)) {
    player.getSkillManager().addExperiences(core.Skill.CONSTRUCTION, bones.reduce((sum, bone) => sum + bone.count * bone.xp, 0));
  }
}

function payShells(player, kind) {
  const shell = kind ? lookup().shells[kind] : null;
  const held = kind ? shellCounts(player, kind) : { plain: 0, perfect: 0 };
  const count = held.plain + held.perfect;
  if (!count || !coinsFit(player, count * SHELL_PRICE, 1)) return stopTalking(player);
  const inventory = player.getInventory();
  if (held.plain) inventory.delete(shell.plain, held.plain);
  if (held.perfect) inventory.delete(shell.perfect, held.perfect);
  inventory.add(new core.Item(lookup().coins, count * SHELL_PRICE));
  if (held.perfect) player.getSkillManager().addExperiences(core.Skill.CRAFTING, held.perfect * PERFECT_SHELL_XP);
}

/**
 * The lecture is a message box (rec 2964 t379). After the bones one he goes on to any shells carried
 * (rec 2964 t380: "That giant shell...what is it?"), which the transcript's bones variant leaves out.
 */
function onAction(event) {
  if (!isBarlak(event.npcId)) return;
  if (event.kind === "message") {
    if (event.stepId === LECTURE_BOX_ID) event.box = { statement: true };
    return;
  }
  const match = LECTURE.exec(String(event.text ?? "").trim());
  if (!match) return;
  event.handled = true;
  const steps = [{ type: "message", text: event.text, id: LECTURE_BOX_ID }];
  const kind = match[1] === "Construction" ? shellKind(event.player) : null;
  if (kind) {
    talkingAbout.set(event.player, kind);
    steps.push(...(variants()[SHELLS[kind].variant] ?? []));
  }
  event.steps = steps;
}

module.exports = {
  name: "Barlak",
  description: "Barlak in Dorgesh-Kaan buys long and curved bones for Construction XP, and giant snail and tortoise shells.",
  members: true,
  register(registry) {
    api = registry;
    core = registry.core;
    registry.onNpcDialogueVariant(selectVariant);
    registry.onNpcDialogueCondition(answerCondition);
    registry.onCustomEvent("npc-dialogue:line", onLine);
    registry.onCustomEvent("npc-dialogue:action", onAction);
  },
};
