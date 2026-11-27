/**
 * Alfred Grimhand's Barcrawl (members miniquest).
 *
 * Words: OSRS Wiki "Transcript:Alfred Grimhand's Barcrawl" and the bar
 * transcripts. Bars, drinks and prices: the wiki's Barcrawl walkthrough table
 * (208 coins in total). Cache: varp 77 barcrawl (0/1 pre-crawl guard, 2
 * post-crawl guard), varbit 13714 barcrawl_progress (quest status), varbit 5668
 * auto_smash_vials, NPC transforms 5227 -> 7285/7724 and item 455.
 *
 * The guard, the ten drinks and the card are played here because the imported
 * transcripts have no executable hand-out for the card and several bar pages
 * omit the Barcrawl option. Normal bar conversations are untouched: a bar is
 * intercepted only while the player carries the card, is mid-crawl and has not
 * yet been signed there. Per-bar signatures are a persisted attribute; varp 77
 * and varbit 13714 are the native client/quest surfaces and are re-sent on login.
 *
 * Stages: 0 unstarted, 1 card held, 2 handed in (cache DB row 4 endstate 2).
 *
 * The drinks: once the price line is continued the box closes, the coins go, and the drink plays out tick by tick
 * (each bar's `drinking`), signing the card on its way. Stat drops: the Wiki's "Temporary skill drain" table (5 plus
 * 5% of the current level, Fire Brandy 5 plus 10%) and the Barcrawl page's effects column (also Supergrog's Prayer).
 * Hitpoints: the Wiki (Heart Stopper 25%, Fire Toad Blast 5% of the current level); for Gutrot and the Hand of Death,
 * 3% fits OSRS guide footage (78 to 76 and 77 to 75 Hitpoints). A share that rounds to 0 is a blue hit of 0
 * (osrs-docs: Hit mask; 2018 guide footage). The ticks and which lines are filterable were measured in guide footage
 * from 2018, 2021 and 2024 (docs/barcrawl-drinks.md); a filterable line is sent as chat type 105, the only type the
 * client's Game: Filtered hides ([proc,filtertest]). The Hand of Death's sway swings the screen left and right (Wiki
 * transcript; RSProx's CamShake message, type 0) and is sent whatever the atmospheric camera shake setting, as the
 * cache's atmospheric group leaves it out (an inference).
 *
 * The drink runs under a held full stall that ends with its last step (Wiki: Animation stall), see playDrink. Run
 * energy waits (Wiki: Energy, an inference); poison, venom and disease halt at 0 (osrs-docs: Timers); Prayer drain,
 * restores, boost decay and special energy go on (osrs-docs: Timers, soft timers; Wiki: Special attacks, an
 * inference).
 *
 * Not from OSRS (server/AGENTS.md rule 10) and Ours: docs/barcrawl-drinks.md; the comments below name Lost City or
 * Ours where they apply.
 */
module.exports = function registerAlfredGrimhandsBarcrawlQuest(api) {
  const {
    ItemIdentifiers,
    StatementDialogue,
    DialogueChainBuilder,
    EndDialogue,
    Skill,
    HitDamage,
    HitMask,
    TaskManager,
    CountdownTask,
  } = api.core;
  const { lowerSkillByCurrent } = require("../../items/ConsumableEffects");
  const { registerQuest } = require("../QuestRuntime");
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");

  const CARD = ItemIdentifiers.BARCRAWL_CARD;
  const COINS = ItemIdentifiers.COINS;
  const VARP_BARCRAWL = 77; // 0/1 -> barbguard1_precrawl 7285, 2 -> postcrawl 7724
  const VARBIT_PROGRESS = 13714; // barcrawl_progress, 0 unstarted / 1 during / 2 complete
  const VARBIT_AUTO_SMASH = 5668; // auto_smash_vials
  const BARS_ATTRIBUTE = "alfred-grimhands-barcrawl:bars";
  const AUTO_SMASH_ATTRIBUTE = "alfred-grimhands-barcrawl:auto-smash";
  /** All Settings > Gameplay: "Automatically smash empty vials", locked until the crawl is done. */
  const AUTO_SMASH_SETTING = 380;
  const AUTO_SMASH_LOCKED = "You must have completed the Alfred Grimhand's Barcrawl miniquest to access this setting.";
  const BARBARIAN_GATE_IDS = new Set([2115, 2116]); // barbariangatel/r, 2545,3569-3570

  const ACTION_START = "barcrawl:start";
  const ACTION_RESTART = "barcrawl:restart";
  const ACTION_DRINK = "barcrawl:drink";
  const ACTION_COMPLETE = "barcrawl:complete";
  const ACTION_AUTO_SMASH_ON = "barcrawl:auto-smash-on";
  const ACTION_AUTO_SMASH_OFF = "barcrawl:auto-smash-off";
  const DRINK_PREFIX = `${ACTION_DRINK}:`;
  /** Wiki: a drained stat drops by 5 plus a share of its current level. */
  const DRAIN_FLAT = 5;
  const DRAIN_SHARE = 0.05;
  /**
   * The Hand of Death's sway: type 0, left and right (RSProx's CamShake message), then the random amount, sine
   * amplitude and sine frequency (Lost City's).
   */
  const SHAKE = [0, 0, 15, 2];
  const SHAKE_STOP = [0, 0, 0, 0];
  /**
   * What stays open while the drink plays. osrs-docs (Delays): interface clicks reach their scripts during a delay,
   * the music player works and unequipping is ignored. The rest is Lost City's: its delay drops every click on the
   * inventory and worn items (an engine check) and every button whose script needs the player (p_finduid: prayers,
   * spells, emotes, combat options). Its settings, music, quest list and Skills tab buttons do not check it, nor do
   * its friends, ignore, chat and report-abuse messages or its tab buttons, so OSRS's interfaces for those stay open,
   * with the chatbox. Its special attack bar turns the special on or off (SPECIAL_BARS). Ours: OSRS's buttons that
   * Lost City does not have are held, except the clan chat, the chat channel setup, the world map and its orb, and
   * the quick-prayer setup; the quick-prayer orb is held as the prayers are, and the special attack orb works as the
   * bar.
   */
  const OPEN_INTERFACES = [
    "settings_side", "settings", "music", "questlist", "side_journal", "questjournal", "stats", "skill_guide",
    "skill_guide_v2", "friends", "ignore", "chatchannel_current", "chatchannel_setup", "clans_sidepanel",
    "clans_guest_sidepanel", "chatbox", "reportabuse", "worldmap", "quickprayer", "toplevel", "toplevel_osrs_stretch",
    "toplevel_pre_eoc", "toplevel_osm",
  ];
  const OPEN_COMPONENTS = ["orbs:worldmap", "orbs_nomap:worldmap", "orbs_osm:worldmap"];
  const COMBAT_OPTIONS = 593;
  const PRAYER_ORBS = ["orbs:prayerbutton", "orbs_osm:prayerbutton"];
  const SPECIAL_ORBS = ["orbs:specbutton", "orbs_nomap:specbutton", "orbs_osm:specbutton", "orbs_osm_nomap:specbutton"];
  /**
   * The weapon's special attack bars on the combat options, which turn the special on or off during the drink as
   * Lost City's do (67, the offhand's, only acts on the press).
   */
  const SPECIAL_BARS = new Set([41, 57]);
  /** The settings the client changes itself before it tells the server: attack style, auto retaliate (Lost City). */
  const HELD_VARPS = [43, 172];
  const SPECIAL_VARP = 301;
  const RUN_VARP = 173;

  /**
   * Each bar's drink after the price line, by tick from the box closing: `text` a game message (`filtered`: one the
   * chat's Game: Filtered hides), `sign` the card's signature, `drain` the stat drops, `damage` the hit, `overhead`
   * the player's shout, `player` the player's chatbox line, `shake` the sway on or off.
   * `signed(name)` words the line from the NPC's name.
   */
  const BARS = [
    {
      key: "blue-moon", bit: 1 << 0, name: "Blue Moon Inn", npcs: [1312],
      drink: "Uncle Humphrey's Gutrot", cost: 50,
      effects: { drains: [Skill.ATTACK, Skill.DEFENCE, Skill.STRENGTH, Skill.SMITHING], damage: 0.03 },
      offer: [
        { npc: "Oh no not another of you guys. These barbarian barcrawls cause too much damage to my bar." },
        { npc: "You're going to have to pay 50 gold for the Uncle Humphrey's Gutrot." },
      ],
      decline: "I don't have 50 coins.",
      drinking: [
        { tick: 0, text: "You buy some Uncle Humphrey's Gutrot." },
        { tick: 3, text: "You drink the Uncle Humphrey's Gutrot." },
        { tick: 6, text: "Your insides feel terrible.", drain: true },
        { tick: 9, text: "The bartender signs your card.", sign: true },
        { tick: 12, damage: true, overhead: "Blearrgh!" },
      ],
    },
    {
      key: "blurberry", bit: 1 << 1, name: "Blurberry Bar", npcs: [6531],
      drink: "Fire Toad Blast", cost: 10,
      effects: { damage: 0.05 },
      offer: [
        { npc: "Ah, you've come to the best stop on your list! I'll give you my famous Fire Toad Blast! It'll cost you 10 coins." },
      ],
      decline: "I don't have 10 coins right now.",
      drinking: [
        { tick: 0, text: "You buy a Fire Toad Blast.", filtered: true },
        { tick: 3, text: "Your mouth and throat burn as you gulp it down.", filtered: true },
        { tick: 6, text: "Blurberry signs your card.", sign: true },
        // The 2018 footage (real time); Lost City hits a tick later.
        { tick: 8, damage: true },
      ],
    },
    {
      key: "dead-mans-chest", bit: 1 << 2, name: "Dead Man's Chest", npcs: [1314],
      drink: "Supergrog", cost: 15,
      effects: { drains: [Skill.ATTACK, Skill.DEFENCE, Skill.COOKING, Skill.HERBLORE, Skill.PRAYER] },
      offer: [
        { npc: "Haha time to be breaking out the old Supergrog. That'll be 15 coins please." },
      ],
      decline: "Sorry I don't have 15 coins.",
      drinking: [
        { tick: 0, text: "The bartender serves you a glass of strange thick dark liquid.", sign: true },
        { tick: 3, text: "You wince and drink it.", filtered: true },
        { tick: 7, text: "You stagger backwards.", filtered: true, drain: true },
        { tick: 10, text: "You think you see 2 bartenders signing 2 barcrawl cards." },
      ],
    },
    {
      key: "dragon-inn", bit: 1 << 3, name: "Dragon Inn", npcs: [1320],
      drink: "Fire Brandy", cost: 12,
      effects: { drains: [Skill.ATTACK, Skill.DEFENCE], share: 0.1 },
      offer: [
        { npc: "I suppose you'll be wanting some Fire Brandy. That'll cost you 12 coins." },
      ],
      decline: "Sorry, I don't have 12 coins.",
      drinking: [
        { tick: 0, text: "The bartender hands you a small glass and sets light to the contents." },
        { tick: 3, text: "You blow out the flame and drink it.", filtered: true },
        { tick: 7, text: "Your vision blurs and you stagger slightly.", filtered: true, drain: true },
        { tick: 10, text: "You can just about make out the bartender signing your barcrawl card.", sign: true },
      ],
    },
    {
      key: "flying-horse", bit: 1 << 4, name: "Flying Horse Inn", npcs: [1319],
      drink: "Heart Stopper", cost: 8,
      effects: { damage: 0.25 },
      offer: [
        { npc: "Fancy a bit of Heart Stopper then do you? It'll only be 8 coins." },
      ],
      decline: "Sorry, I don't have 8 coins.",
      drinking: [
        { tick: 0, text: "The bartender hands you a shot of Heart Stopper." },
        { tick: 3, text: "You grimace and drink it.", filtered: true },
        { tick: 7, text: "You clutch your chest.", filtered: true },
        { tick: 10, text: "Through your tears you see the bartender..." },
        { tick: 10, text: "signing your barcrawl card", sign: true, damage: true },
      ],
    },
    {
      key: "foresters-arms", bit: 1 << 5, name: "Forester's Arms", npcs: [1318],
      drink: "Liverbane Ale", cost: 18,
      effects: { drains: [Skill.ATTACK, Skill.DEFENCE, Skill.FIREMAKING, Skill.FLETCHING, Skill.WOODCUTTING] },
      offer: [
        { npc: "Oh you're a barbarian then. Now which of these barrels contained the Liverbane Ale? That'll be 18 coins please." },
      ],
      decline: "Sorry, I don't have 18 coins.",
      drinking: [
        { tick: 0, text: "The bartender gives you a glass of Liverbane Ale." },
        { tick: 3, text: "You gulp it down.", filtered: true },
        { tick: 7, text: "The room seems to be swaying.", drain: true },
        { tick: 10, text: "The bartender scrawls his signature on your card.", sign: true },
      ],
    },
    {
      key: "jolly-boar", bit: 1 << 6, name: "Jolly Boar Inn", npcs: [1310],
      drink: "Olde Suspiciouse", cost: 10,
      effects: { drains: [Skill.ATTACK, Skill.DEFENCE, Skill.CRAFTING, Skill.MINING, Skill.MAGIC] },
      offer: [
        { npc: "Ah, there seems to be a fair few doing that one these days. My supply of Olde Suspiciouse is starting to run low, it'll cost you 10 coins." },
      ],
      decline: "I don't have 10 coins right now.",
      drinking: [
        { tick: 0, text: "You buy a pint of Olde Suspiciouse.", filtered: true },
        { tick: 3, text: "You gulp it down.", filtered: true },
        { tick: 6, text: "Your head is spinning.", filtered: true, drain: true },
        { tick: 9, text: "The bartender signs your card.", sign: true },
        { tick: 12, player: "Thanksh very mush..." },
      ],
    },
    {
      key: "karamja", bit: 1 << 7, name: "Karamja Spirits Bar", npcs: [13655],
      drink: "Ape Bite Liqueur", cost: 7,
      offer: [
        { npc: "Ah, you'll be wanting some Ape Bite Liqueur then. It's got a lovely banana taste, and it'll only cost you 7 coins." },
      ],
      decline: "I don't have 7 coins right now.",
      drinking: [
        { tick: 0, text: "You buy some Ape Bite Liqueur.", filtered: true },
        { tick: 3, text: "You swirl it around and swallow it.", filtered: true },
        { tick: 6, text: "Zembo signs your card." },
        { tick: 9, sign: true, player: "Mmmmm, dat was luverly..." },
      ],
    },
    {
      key: "rising-sun", bit: 1 << 8, name: "Rising Sun", npcs: [1317, 10668, 1315, 1316],
      drink: "Hand of Death Cocktail", cost: 70,
      effects: { drains: [Skill.ATTACK, Skill.DEFENCE, Skill.FISHING, Skill.RANGED], damage: 0.03 },
      offer: [
        { npc: "Heehee, this'll be fun!" },
        { npc: "You'll be after our Hand of Death cocktail, then. Lots of expensive parts to the cocktail, though, so it will cost you 70 coins." },
      ],
      decline: "I don't have that much money on me.",
      drinking: [
        { tick: 0, text: "You buy a Hand of Death cocktail.", filtered: true },
        { tick: 3, text: "You drink the cocktail.", filtered: true, drain: true },
        { tick: 6, text: "You stumble around the room.", filtered: true, shake: true },
        { tick: 10, signed: (name) => `${name} giggles and signs your card.`, sign: true, shake: false, damage: true },
      ],
    },
    {
      key: "rusty-anchor", bit: 1 << 9, name: "Rusty Anchor", npcs: [1313],
      drink: "Black Skull Ale", cost: 8,
      offer: [
        { npc: "Are you sure? You look a bit skinny for that." },
        { player: "Just give me whatever I need to drink here." },
        { npc: "Ok one Black Skull Ale coming up, 8 coins please." },
      ],
      decline: "I don't have 8 coins with me.",
      drinking: [
        { tick: 0, text: "You buy a Black Skull Ale.", filtered: true, sign: true },
        { tick: 3, text: "You drink your Black Skull Ale...", filtered: true },
        { tick: 6, text: "Your vision blurs.", filtered: true },
        { tick: 9, text: "The bartender signs your card.", overhead: "Hiccup!" },
      ],
    },
  ];
  const ALL_BARS_MASK = BARS.reduce((mask, bar) => mask | bar.bit, 0);
  const BAR_BY_KEY = new Map(BARS.map((bar) => [bar.key, bar]));
  const BAR_BY_NPC_ID = new Map(BARS.flatMap((bar) => bar.npcs.map((id) => [id, bar])));

  let quest;

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const freeSlot = (player) => !inventory(player).isFull();
  const bankHasCard = (player) => (player.getBanks?.() ?? [])
    .some((bank) => Number(bank?.getAmount?.(CARD) ?? 0) > 0);

  function barMask(player) {
    return Number(player.getAttribute(BARS_ATTRIBUTE)) | 0;
  }

  function isSigned(player, bar) {
    return (barMask(player) & bar.bit) !== 0;
  }

  function signedCount(player) {
    return BARS.filter((bar) => isSigned(player, bar)).length;
  }

  function sendVar(player, stage) {
    const sender = player.getPacketSender();
    sender.sendConfig(VARP_BARCRAWL, stage >= 2 ? 2 : stage >= 1 ? 1 : 0);
    sender.sendVarbit(VARBIT_PROGRESS, stage >= 2 ? 2 : stage >= 1 ? 1 : 0);
  }

  function syncVars({ player }) {
    if (!player || !quest) return;
    sendVar(player, quest.getStage(player));
    player.getPacketSender().sendVarbit(VARBIT_AUTO_SMASH, player.getAttribute(AUTO_SMASH_ATTRIBUTE) === true ? 1 : 0);
  }

  function giveCard(player) {
    if (!has(player, CARD)) inventory(player).adds(CARD, 1);
  }

  function startCrawl(player) {
    if (quest.getStage(player) >= 1 || !freeSlot(player)) return false;
    player.setAttribute(BARS_ATTRIBUTE, 0);
    quest.setStage(player, 1);
    sendVar(player, 1);
    giveCard(player);
    return true;
  }

  function restartCrawl(player) {
    if (quest.getStage(player) !== 1 || !freeSlot(player)) return false;
    player.setAttribute(BARS_ATTRIBUTE, 0);
    giveCard(player);
    return true;
  }

  /** Takes the coins, then plays the drink (`name`: the serving NPC's, for its line), which signs the card. */
  function drinkAt(player, bar, name = "") {
    if (!bar || quest.getStage(player) !== 1 || !has(player, CARD) || isSigned(player, bar) || drinking.has(player)) return false;
    if (inventory(player).getAmount(COINS) < bar.cost) return false;
    inventory(player).deleteNumber(COINS, bar.cost);
    playDrink(player, bar, name);
    return true;
  }


  function sign(player, bar) {
    player.setAttribute(BARS_ATTRIBUTE, barMask(player) | bar.bit);
  }

  function drain(player, bar) {
    const { drains = [], share = DRAIN_SHARE } = bar.effects ?? {};
    for (const skill of drains) lowerSkillByCurrent(player, skill, DRAIN_FLAT, share);
  }

  function damageOf(player, bar) {
    return Math.floor(player.getSkillManager().getCurrentLevel(Skill.HITPOINTS) * bar.effects.damage);
  }

  /** The drink each player is having (`{ token, bar, played }`: the last tick played), until its last step. */
  const drinking = new Map();
  /** The drink's own hit until it lands, which is after the drink ends on its last step's tick. */
  const landing = new WeakMap();

  function stop(player, drink) {
    drinking.delete(player);
    player.endDelay();
    player.getCombat().releaseFullStall();
    TaskManager.cancelTasks(drink.token);
    // A sway that started and was not stopped yet.
    const { drinking: steps } = drink.bar;
    if (steps.some((step) => step.shake === true && step.tick <= drink.played)
      && steps.some((step) => step.shake === false && step.tick > drink.played)) {
      player.getPacketSender().sendCameraShake(...SHAKE_STOP);
    }
  }

  /**
   * The drink's steps on their ticks, under a held full stall that ends with the last step (Wiki: Animation stall):
   * world clicks and new walks are dropped, and hits from others and the player's own damage wait until then
   * (osrs-docs: Queues). The delay (Player.delayFor) halts poison, venom and disease at 0 (osrs-docs: Timers) and holds
   * run energy (an inference). The buttons (dropButton, dropSetting) and the Logout button (holdLogout) follow Lost
   * City.
   */
  function playDrink(player, bar, name) {
    const drink = { token: {}, bar, played: -1 };
    drinking.set(player, drink);
    const last = Math.max(...bar.drinking.map((step) => step.tick));
    player.getCombat().holdFullStall(true);
    player.getCombat().getHitQueue().holdIncomingFor(last, { ownDamage: true });
    player.delayFor(last);
    const end = () => {
      player.getCombat().releaseFullStall();
      drinking.delete(player);
    };
    for (const tick of new Set(bar.drinking.map((step) => step.tick))) {
      const steps = bar.drinking.filter((step) => step.tick === tick);
      const run = () => {
        drink.played = tick;
        for (const step of steps) playStep(player, bar, step, name);
        if (tick === last) end();
      };
      if (tick === 0) run();
      else TaskManager.submit(new CountdownTask(drink.token, tick, run));
    }
  }

  function playStep(player, bar, step, name) {
    if (step.sign) sign(player, bar);
    const text = step.signed ? step.signed(name) : step.text;
    if (text && step.filtered) player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, text);
    else if (text) player.sendMessage(text);
    if (step.drain) drain(player, bar);
    if (step.shake !== undefined) player.getPacketSender().sendCameraShake(...(step.shake ? SHAKE : SHAKE_STOP));
    if (step.damage) {
      const damage = damageOf(player, bar);
      const hit = new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE);
      landing.set(player, hit.onApplied(() => landing.get(player) === hit && landing.delete(player)));
      player.getCombat().getHitQueue().addPendingDamage([hit]);
    }
    if (step.overhead) player.forceChat(step.overhead);
    if (step.player) {
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new api.core.PlayerDialogue(0, step.player)));
    }
  }

  /**
   * Lost City: the buttons and drags the drink holds (all but OPEN_INTERFACES), sending back what the client already
   * changed, as its scripts do; an inventory drag goes back, as its engine does. A special that acts on the press
   * (the dragon battleaxe's, Excalibur's) does nothing, after the energy check; Lost City's script says in a comment
   * that OSRS strong-queues these specials, which no source confirms.
   */
  function dropButton(event) {
    const { player, packet } = event;
    if (!drinking.has(player) || !packet) return;
    if (packet.type === "widget_drag" || packet.type === "inventory_move") {
      event.handled = true;
      player.getInventory().refreshItems();
      return;
    }
    const { groups, components, prayer, special } = openInterfaces();
    if (groups.has(packet.groupId) || components.has(packet.widgetId) || togglesSpecial(player, packet)) return;
    if (prayer.has(packet.widgetId) && packet.buttonNum !== 1) return; // the quick-prayer setup
    event.handled = true;
    if (weaponSpecialPress(packet) && !affordsSpecial(player)) player.sendMessage("You don't have enough power left.");
    if (packet.groupId !== COMBAT_OPTIONS && !special.has(packet.widgetId)) return;
    const sender = player.getPacketSender();
    for (const varp of [...HELD_VARPS, SPECIAL_VARP]) sender.sendConfig(varp, sender.getVarp(varp));
  }

  /** A press of the weapon's special attack bar or of the special attack orb's first option. */
  function weaponSpecialPress(packet) {
    if (packet.groupId === COMBAT_OPTIONS) return SPECIAL_BARS.has(packet.childId);
    return openInterfaces().special.has(packet.widgetId) && packet.buttonNum === 1;
  }

  /** A weapon special press that only turns the special on or off. */
  function togglesSpecial(player, packet) {
    if (!weaponSpecialPress(packet)) return false;
    return player.isSpecialActivated() || player.getCombatSpecial()?.getTraits?.()?.skipAttack !== true;
  }

  function affordsSpecial(player) {
    const spec = player.getCombatSpecial();
    const weapon = player.getEquipment().get(api.core.Equipment.WEAPON_SLOT)?.getId?.();
    return !spec || api.core.CombatSpecial.affordable(player, spec, spec.getDrainAmountForWeaponId(weapon));
  }

  /** Lost City: the run, attack-style and auto-retaliate settings the client sends are refused and sent back. */
  function dropSetting(event) {
    if (!drinking.has(event.player) || (event.varpId !== RUN_VARP && !HELD_VARPS.includes(event.varpId))) return;
    event.handled = true;
    const sender = event.player.getPacketSender();
    if (event.varpId === RUN_VARP) sender.sendRunStatus();
    else sender.sendConfig(event.varpId, sender.getVarp(event.varpId));
  }

  let openIds;
  function openInterfaces() {
    const cache = api.core.CacheDefinitions;
    const ids = (names, lookup) => new Set(names.map((name) => lookup.call(cache, name)).filter(Number.isInteger));
    openIds ??= {
      groups: ids(OPEN_INTERFACES, cache.getInterfaceId),
      components: ids(OPEN_COMPONENTS, cache.getComponentId),
      prayer: ids(PRAYER_ORBS, cache.getComponentId),
      special: ids(SPECIAL_ORBS, cache.getComponentId),
    };
    return openIds;
  }

  /** Lost City's Logout button does nothing until the drink's last step; TSPS refuses it with its usual line. */
  function holdLogout(event) {
    if (drinking.has(event.player)) event.allow = false;
  }

  /**
   * Lost City: a dropped connection or a kick before the drink ends gets its lasting steps (the signature, the stat
   * drops, the Hitpoints) at once, as Lost City plays the drink to its end before the player leaves. At a server
   * shutdown Lost City removes the player at once and the rest is lost, as it is here.
   */
  function finishNow({ player }) {
    const hit = player && landing.get(player);
    if (hit) {
      landing.delete(player);
      player.setHitpoints(Math.max(0, player.getHitpoints() - hit.getDamage()));
    }
    const drink = player && drinking.get(player);
    if (!drink) return;
    stop(player, drink);
    for (const step of drink.bar.drinking) {
      if (step.tick <= drink.played) continue;
      if (step.sign) sign(player, drink.bar);
      if (step.drain) drain(player, drink.bar);
      if (step.damage) player.setHitpoints(Math.max(0, player.getHitpoints() - damageOf(player, drink.bar)));
    }
  }

  /**
   * Ours, a safety net: a death mid-drink stops the drink, and its card is signed. Damage is a strong queue, which
   * waits during a delay, and an item script such as a divine potion's deals damage outside it (osrs-docs:
   * Queues); here, too, only content that takes Hitpoints outside the hit queue can cause such a death.
   */
  function stopOnDeath({ player }) {
    // A death drops the drink's queued hit without it landing.
    if (player) landing.delete(player);
    const drink = player && drinking.get(player);
    if (!drink) return;
    stop(player, drink);
    sign(player, drink.bar);
  }

  function setAutoSmash(player, on) {
    player.setAttribute(AUTO_SMASH_ATTRIBUTE, on === true);
    player.getPacketSender().sendVarbit(VARBIT_AUTO_SMASH, on === true ? 1 : 0);
  }

  /** The row's lock text is the cache's own (the setting's locked message). */
  function autoSmashSettingClicked(request) {
    if (request.settingId !== AUTO_SMASH_SETTING) return;
    request.handled = true;
    const { player } = request;
    if (quest.getStage(player) < 2) {
      player.sendMessage(AUTO_SMASH_LOCKED);
      return;
    }
    setAutoSmash(player, player.getAttribute(AUTO_SMASH_ATTRIBUTE) !== true);
  }

  function completeCrawl(player) {
    if (quest.getStage(player) >= 2) return false;
    if (signedCount(player) !== BARS.length || !has(player, CARD)) return false;
    inventory(player).deleteNumber(CARD, 1);
    sendVar(player, 2);
    quest.complete(player, { scroll: false, announce: false });
    return true;
  }

  function completionSteps() {
    return [
      { npc: "So, how's the Barcrawl coming along?" },
      { player: "I tink I jusht 'bout done dem all... but I losht count..." },
      { type: "message", text: "You give the card to the barbarian.", id: "barcrawl:give-card" },
      { type: "action", action: ACTION_COMPLETE, id: "barcrawl:complete" },
      { npc: "Yep that seems fine, you can come in now. I never learned to read, but you look like you've drunk plenty. Also, one more thing..." },
      { npc: "Since you drink like a barbarian, I can show you how to smash your vials when you finish them. Do you want to do that?" },
      {
        type: "choice",
        options: [
          {
            text: "Yes please, I want to smash my vials.",
            steps: [
              { player: "Yes please, I want to smash my vials." },
              { npc: "It's all part of drinking like a barbarian! Okay, you will now smash your vials as you drink your potions." },
              { type: "action", action: ACTION_AUTO_SMASH_ON, id: "barcrawl:auto-smash-on" },
              { type: "message", text: "Vial smashing is now turned on." },
            ],
          },
          {
            text: "No thank you, I'd rather keep my vials.",
            steps: [{ player: "No thank you, I'd rather keep my vials." }],
          },
        ],
      },
    ];
  }

  function duringSteps(player) {
    const opening = [{ npc: "So, how's the Barcrawl coming along?" }];
    if (has(player, CARD)) {
      if (signedCount(player) === BARS.length) return completionSteps();
      return [
        ...opening,
        { player: "I haven't finished it yet." },
        { npc: "Well come back when you have, you lightweight." },
      ];
    }
    if (bankHasCard(player)) {
      return [
        ...opening,
        { player: "Not too bad. I've got my barcrawl card stored somewhere for safe-keeping." },
        { npc: "You need to take it with you when you're going on a barcrawl." },
      ];
    }
    if (!freeSlot(player)) {
      return [
        ...opening,
        { player: "I've lost my barcrawl card..." },
        { type: "message", text: "You need more inventory space." },
      ];
    }
    return [
      ...opening,
      { player: "I've lost my barcrawl card..." },
      { npc: "What are you like? You're gonna have to start all over now." },
      { type: "action", action: ACTION_RESTART, id: "barcrawl:restart" },
      { type: "message", text: "The guard hands you a Barcrawl card.", id: "barcrawl:card-given" },
    ];
  }

  function preCrawlSteps(player) {
    const barbarian = freeSlot(player)
      ? [
        { player: "Looks can be deceiving, I am in fact a barbarian." },
        { npc: "If you're a barbarian you need to be able to drink like one. We barbarians like a good drink." },
        { npc: "I have the perfect challenge for you... The Alfred Grimhand Barcrawl! First completed by Alfred Grimhand." },
        { type: "action", action: ACTION_START, id: "barcrawl:start" },
        { type: "message", text: "The guard hands you a Barcrawl card.", id: "barcrawl:card-given" },
        { npc: "Take that card to each of the bars named on it. The bartenders will know what it means. We're kinda well known." },
        { npc: "They'll give you their strongest drink and sign your card. When you've done all that, we'll be happy to let you in." },
      ]
      : [
        { player: "Looks can be deceiving, I am in fact a barbarian." },
        { npc: "Are you, now? Free up some space so you can carry something, and we'll see how barbarian you really are." },
      ];
    return [
      { npc: "Oi, whaddya want?" },
      {
        type: "choice",
        options: [
          {
            text: "I want to come through this gate.",
            steps: [
              { player: "I want to come through this gate." },
              { npc: "Barbarians only. Are you a barbarian? You don't look like one." },
              {
                type: "choice",
                options: [
                  { text: "Hmm, yep you've got me there.", steps: [{ player: "Hmm, yep you've got me there." }] },
                  { text: "Looks can be deceiving, I am in fact a barbarian.", steps: barbarian },
                ],
              },
            ],
          },
          {
            text: "I want some money.",
            steps: [
              { player: "I want some money." },
              { npc: "Do I look like a bank to you?" },
            ],
          },
        ],
      },
    ];
  }

  function postCrawlSteps(player) {
    if (player.getAttribute(AUTO_SMASH_ATTRIBUTE) === true) {
      return [
        { npc: "'Ello friend. I see you're drinking like a barbarian - do you want to stop smashing your vials when you finish them?" },
        {
          type: "choice",
          options: [
            {
              text: "Yes please, I want to stop smashing my vials.",
              steps: [
                { player: "Yes please, I want to stop smashing my vials." },
                { npc: "You're a funny sort of barbarian! But okay, you will no longer smash your vials as you drink your potions." },
                { type: "action", action: ACTION_AUTO_SMASH_OFF, id: "barcrawl:auto-smash-off" },
                { type: "message", text: "Vial smashing is now turned off." },
              ],
            },
            {
              text: "No thank you, I like smashing them.",
              steps: [
                { player: "No thank you, I like smashing them." },
                { npc: "That's a proper barbarian spirit, that is." },
              ],
            },
          ],
        },
      ];
    }
    return [
      { npc: "'Ello friend. Do you want me to show you how to smash your vials when you finish drinking them?" },
      {
        type: "choice",
        options: [
          {
            text: "Yes please, I want to smash my vials.",
            steps: [
              { player: "Yes please, I want to smash my vials." },
              { npc: "It's all part of drinking like a barbarian! Okay, you will now smash your vials as you drink your potions." },
              { type: "action", action: ACTION_AUTO_SMASH_ON, id: "barcrawl:auto-smash-on" },
              { type: "message", text: "Vial smashing is now turned on." },
            ],
          },
          {
            text: "No thank you, I'd rather keep my vials.",
            steps: [{ player: "No thank you, I'd rather keep my vials." }],
          },
        ],
      },
    ];
  }

  function talkGuard(event) {
    if (!event?.player) return;
    event.handled = true;
    const stage = quest.getStage(event.player);
    const steps = stage >= 2 ? postCrawlSteps(event.player)
      : stage === 1 ? duringSteps(event.player)
        : preCrawlSteps(event.player);
    startDialogue(api, event, steps);
  }

  function talkBar(event, bar) {
    if (!bar || !event.player) return;
    // A drink in progress counts as signed (its clicks are dropped anyway).
    if (quest.getStage(event.player) !== 1 || !has(event.player, CARD) || isSigned(event.player, bar) || drinking.has(event.player)) return;
    event.handled = true;
    const player = event.player;
    const steps = [
      { player: "I'm doing Alfred Grimhand's Barcrawl." },
      ...bar.offer,
    ];
    if (inventory(player).getAmount(COINS) >= bar.cost) {
      // The drink closes the box and plays out by itself.
      steps.push({ type: "action", action: ACTION_DRINK, id: `${DRINK_PREFIX}${bar.key}` });
    } else {
      steps.push({ player: bar.decline });
    }
    startDialogue(api, event, steps);
  }

  function npcOption(event) {
    const index = Number(event.clickType) - 1;
    return index >= 0 ? event.definition?.getActions?.()[index] ?? null : null;
  }

  function handleNpcInteraction(event) {
    if (!event?.player) return;
    const option = npcOption(event);
    if (event.npcId === 7285 || event.npcId === 7724 || event.definition?.getName?.() === "Barbarian guard") {
      if (option === "Toggle-vials") {
        event.handled = true;
        const on = event.player.getAttribute(AUTO_SMASH_ATTRIBUTE) !== true;
        setAutoSmash(event.player, on);
        event.player.sendMessage(on ? "Vial smashing is now turned on." : "Vial smashing is now turned off.");
        return;
      }
      if (option === "Talk-to") talkGuard(event);
      return;
    }
    const bar = BAR_BY_NPC_ID.get(event.npcId);
    if (bar && option === "Talk-to") talkBar(event, bar);
  }

  function handleAction(event) {
    if (!event?.player) return;
    if (event.kind === "message") {
      if (event.stepId === "barcrawl:card-given") event.box = { items: [CARD] };
      return;
    }
    const player = event.player;
    if (event.action === ACTION_START) {
      event.handled = true;
      startCrawl(player);
    } else if (event.action === ACTION_RESTART) {
      event.handled = true;
      restartCrawl(player);
    } else if (event.action === ACTION_DRINK) {
      event.handled = true;
      drinkAt(player, BAR_BY_KEY.get(String(event.stepId ?? "").slice(DRINK_PREFIX.length)), event.definition?.getName?.() ?? "");
    } else if (event.action === ACTION_COMPLETE) {
      event.handled = true;
      completeCrawl(player);
    } else if (event.action === ACTION_AUTO_SMASH_ON) {
      event.handled = true;
      setAutoSmash(player, true);
    } else if (event.action === ACTION_AUTO_SMASH_OFF) {
      event.handled = true;
      setAutoSmash(player, false);
    }
  }

  function readCard(event) {
    const player = event?.player;
    if (!player) return;
    if (quest.getStage(player) >= 2) {
      StatementDialogue.send(player, "You are too drunk to be able to read the barcrawl card.");
      return;
    }
    const lines = BARS.map((bar) => `${bar.name}: ${isSigned(player, bar) ? "signed" : "not signed"}`);
    const pages = [lines.slice(0, 4), lines.slice(4, 8), lines.slice(8)];
    const dialogue = new DialogueChainBuilder().add(
      ...pages.map((page, index) => new StatementDialogue(index, `Alfred Grimhand's Barcrawl<br>${page.join("<br>")}`)),
      new EndDialogue(pages.length),
    );
    player.getDialogueManager().startDialogues(dialogue);
  }

  function handleGateToggle(request) {
    if (!request?.player || !BARBARIAN_GATE_IDS.has(Number(request.objectId))) return;
    if (quest.getStage(request.player) >= 2) return;
    const gate = request.location ?? request.object?.getLocation?.();
    if (!gate) return;
    const gateX = Number(gate.getX?.() ?? gate.x);
    const playerX = Number(request.player.getLocation?.().getX?.() ?? 0);
    // The course is east of the gate: block a player on or west of it (opening a
    // gate walks the player onto its west tile first, so `==` is still outside).
    if (playerX > gateX) return;
    request.handled = true;
    request.player.sendMessage("You need to complete Alfred Grimhand's Barcrawl to enter.");
  }

  quest = registerQuest(api, {
    key: "alfred-grimhands-barcrawl",
    name: "Alfred Grimhand's Barcrawl",
    varbitId: VARBIT_PROGRESS,
    startedValue: 1,
    completionValue: 2,
    questPoints: 0,
  });
  api.persistAttribute(BARS_ATTRIBUTE, 0);
  api.persistAttribute(AUTO_SMASH_ATTRIBUTE, false);

  api.onNpcInteraction(handleNpcInteraction);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction("Barcrawl card", { Read: readCard });
  api.onCustomEvent("door:toggle", handleGateToggle);
  api.onPlayerLogin(syncVars);
  api.onCustomEvent("player:bootstrap-complete", syncVars);
  api.onCustomEvent("settings:setting-clicked", autoSmashSettingClicked);
  api.onCustomEvent("player:widget-action", dropButton);
  api.onCustomEvent("player:inventory-move", dropButton);
  api.onCustomEvent("player:varp-transmit", dropSetting);
  api.onCanLogout(holdLogout);
  api.onPlayerLogout(finishNow);
  api.onCustomEvent("player:dying", stopOnDeath);

  const internals = {
    BARS,
    ALL_BARS_MASK,
    barMask,
    isSigned,
    signedCount,
    startCrawl,
    restartCrawl,
    drinkAt,
    completeCrawl,
    setAutoSmash,
    autoSmashSettingClicked,
    handleAction,
    handleGateToggle,
    syncVars,
  };
  return internals;
};

