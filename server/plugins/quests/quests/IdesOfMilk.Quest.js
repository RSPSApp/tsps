/** The Ides of Milk: OSRS capture 4153 (revision 238); cache revision 241 ids.
 * Capture facts and verification: docs/ides-of-milk.md.
 */
module.exports = function registerIdesOfMilkQuest(api) {
  const {
    Animation,
    StatementDialogue,
    DialogueChainBuilder,
    Skill,
    HitDamage,
    HitMask,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Boundary,
    Area,
    PrivateArea,
    GameObject,
    ObjectManager,
    MeleeCombatMethod,
    PendingHit,
    Graphic,
    Task,
    TaskManager,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, openBook } = require("../QuestRuntime");

  const PAGE = "The Ides of Milk";
  const START_HOOK = "quest:the-ides-of-milk:start";

  const CASSIUS_NPC_ID = NpcIdentifiers.CASSIUS_2; // 15632
  const GILLIE_NPC_ID = NpcIdentifiers.GILLIE_GROATS; // 4628
  const SETH_NPC_ID = NpcIdentifiers.SETH_GROATS; // 1351
  const DUKE_NPC_ID = NpcIdentifiers.DUKE_HORACIO; // 815
  const BULL_NPC_ID = NpcIdentifiers.BULL; // 15625, the pre-reveal "Bull"
  const QUEST_BRUTUS_NPC_ID = NpcIdentifiers.BRUTUS; // cowboss, as captured in the quest
  const MAPPED_BULL_NPC_ID = 15624; // cache cowboss_mapped, morphs on cowquest

  const SHELVES_OBJECT_ID = ObjectIdentifiers.SHELVES_180; // 60785, "Shelves" Search
  // The pen gate's two leaves ("Gate" Release) at the north-east of the cow field.
  const BULL_GATE_LEAVES = [
    { id: ObjectIdentifiers.GATE_319, x: 3263, y: 3294 }, // 60760
    { id: ObjectIdentifiers.GATE_322, x: 3262, y: 3294 }, // 60763
  ];
  const BULL_GATE_OBJECT_IDS = new Set(BULL_GATE_LEAVES.map((leaf) => leaf.id));

  const BOOK_ITEM_ID = ItemIdentifiers.THE_GROATS_PRINCIPLES; // 33126
  const FIRST_SAMPLE_ITEM_ID = ItemIdentifiers.MILK_SAMPLE; // 33128
  const SECOND_SAMPLE_ITEM_ID = ItemIdentifiers.MILK_SAMPLE_3; // 33130
  const COWBELL_AMULET_ITEM_ID = ItemIdentifiers.COWBELL_AMULET; // 33103
  const CHARGED_COWBELL_AMULET_ITEM_ID = ItemIdentifiers.COWBELL_AMULET_2; // 33104
  const MAGIC_LAMP_ITEM_ID = ItemIdentifiers.MAGIC_LAMP; // 33117
  const LAMP_XP = 1000;

  const VARP_COWQUEST = 5412; // "cowquest_main"
  const VARBIT_COWQUEST = 20106; // "cowquest"

  const STAGE_ACCEPTED = 1;
  const STAGE_EMPIRE = 2;
  const STAGE_STARTED = 3;
  const STAGE_GROATS = 4;
  const STAGE_BOOK = 4;
  const STAGE_SAMPLE = 6;
  const STAGE_SAMPLED = 8;
  const STAGE_PERMIT = 10;
  const STAGE_DUKE = 12;
  const STAGE_GILLIE_SAMPLE = 14;
  const STAGE_SECOND_DRUNK = 16;
  const STAGE_BULL_TASK = 18;
  const STAGE_BRUTUS_DEAD = 20;
  const STAGE_GILLIE_TOLD = 21;
  const STAGE_COMPLETE = 22;

  const BULL_TILE = { x: 3261, y: 3287, z: 0 }; // capture4153, spawn tick541
  const GILLIE_TILE = { x: 3254, y: 3274, z: 0 };
  const GILLIE_TALK_RANGE = 3;

  // Cassius/Seth flags the wiki conditions branch on.
  const SETH_TALKED_ATTRIBUTE = "quest.the_ides_of_milk.seth";
  const GILLIE_TALKED_ATTRIBUTE = "quest.the_ides_of_milk.gillie";
  const REWARD_ATTRIBUTE = "quest.the_ides_of_milk.reward";
  const LAMP_USED_ATTRIBUTE = "quest.the_ides_of_milk.lamp";

  // Condition step ids on the "The Ides of Milk" page.
  const CONDITION_IDS = new Set([
    "nFcTGN", "UGwoXz", "P1dfHS", "iRWhJf", "3dp-G-", "MeCHpF", "g99Opl", "Si4XUQ",
    "aOfzEg", "iVxuGF", "8iIMZ6", "1qWPVz", "Q-sZIb", "mn6454", "wgvV7v", "CltN0x",
    "bo0hmW", "jS5Ned", "gROlcY", "rQeSSv", "m2cjiq", "0MczJn", "eeHo4c",
  ]);

  const STAGE_SCHEMA_ATTRIBUTE = "ides-of-milk:stage-schema";
  const LEGACY_STAGES = [0, 3, 4, 4, 6, 8, 10, 12, 14, 18, 18, 20, 21];
  const GILLIE_INFORMATION_VARBIT = 20107;
  const SETH_INFORMATION_VARBIT = 20108;
  const REWARD_VARBIT = 20109;
  const LAMP_VARBIT = 20110;
  const COMBAT_SKILLS = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER];
  const GILLIE_CONFRONT_PREFIX = "Why don't you go and talk to him about it";

  let quest;

  const bullsByPlayer = new WeakMap();
  const fightsByPlayer = new WeakMap();
  const DONT_ASK_ATTRIBUTE = "ides-of-milk:dont-ask-again";
  const DONT_ASK_VARBIT = 20160;
  const EXIT_GATE_IDS = new Set([ObjectIdentifiers.GATE_323, ObjectIdentifiers.GATE_324]);
  const ANIMATION = { eat: 829, cough: 11267, attack: 13783, charge: 13778, stomp: 13785, spawn: 13790 };
  const STOMP_GRAPHIC = { ground: 3588, bull: 3589 };

  class BullPen extends Area {
    constructor() { super([new Boundary(3259, 3268, 3294, 3301, 0)]); }
    canAttack(attacker, target) {
      if (attacker.getId?.() === MAPPED_BULL_NPC_ID || target.getId?.() === MAPPED_BULL_NPC_ID) return false;
      return null;
    }
  }

  function later(owner, ticks, action) {
    class DelayedAction extends Task {
      constructor() { super(ticks, owner, false); }
      execute() { this.stop(); action(); }
    }
    const task = new DelayedAction();
    TaskManager.submit(task);
    return task;
  }

  class BullArena extends PrivateArea {
    constructor(player) {
      super([new Boundary(3240, 3268, 3265, 3301, 0)]);
      this.player = player;
      this.bull = null;
      this.meleeRemaining = 3;
      this.nextSpecial = "charge";
      this.stompsRemaining = 0;
    }
    canAttack(attacker, target) {
      return (attacker === this.player && target === this.bull) || (attacker === this.bull && target === this.player);
    }
    npcAggression(player, npc) { return player === this.player && npc === this.bull; }
    postLeave(mobile, logout) {
      if (mobile === this.player) {
        TaskManager.cancelTasks(this);
        fightsByPlayer.delete(mobile);
        bullsByPlayer.delete(mobile);
        mobile.getPacketSender().sendVarbit(12393, 0);
        mobile.getPacketSender().sendVarbit(6719, 0);
        mobile.getMovementQueue().setBlockMovement(false);
        mobile.setUntargetable(false);
      }
      super.postLeave(mobile, logout);
    }
  }

  function stompTiles(at, target) {
    const x = at.getX() + 1, y = at.getY() + 1;
    const dx = Math.sign(target.getX() - x), dy = Math.sign(target.getY() - y) || (dx ? 0 : 1);
    const cornerX = x + 2 * dx, cornerY = y + 2 * dy;
    if (!dx) return [-1, 0, 1].map(offset => [x + offset, cornerY]);
    if (!dy) return [-1, 0, 1].map(offset => [cornerX, y + offset]);
    return [[cornerX, cornerY], [cornerX - dx, cornerY], [cornerX - 2 * dx, cornerY],
      [cornerX, cornerY - dy], [cornerX, cornerY - 2 * dy]];
  }

  class BrutusCombat extends MeleeCombatMethod {
    attackDistance(npc) { return npc.getArea() instanceof BullArena ? 16 : super.attackDistance(npc); }
    nextAttack(npc, player) {
      const arena = npc.getArea();
      if (!(arena instanceof BullArena) || !player) return null;
      const at = npc.getLocation(), target = player.getLocation();
      const distance = Math.max(at.getX() - target.getX(), target.getX() - at.getX() - 2, at.getY() - target.getY(), target.getY() - at.getY() - 2);
      return arena.stompsRemaining > 0 ? "stomp" : distance > 1 ? "charge" : arena.meleeRemaining > 0 ? null : arena.nextSpecial;
    }
    attackSpeed(npc) {
      return npc.getArea() instanceof BullArena ? (this.nextAttack(npc, npc.getCombat().getTarget()) ? 8 : 5) : super.attackSpeed(npc);
    }
    start(npc, player) {
      const arena = npc.getArea();
      if (!(arena instanceof BullArena)) return super.start(npc, player);
      const at = npc.getLocation().clone();
      arena.special = this.nextAttack(npc, player);
      if (!arena.special) {
        arena.meleeRemaining--;
        npc.performAnimation(new Animation(ANIMATION.attack));
        return;
      }
      const charge = arena.special === "charge";
      const aimed = player.getLocation().clone();
      if (!charge && arena.stompsRemaining === 0) {
        arena.stompTiles = stompTiles(at, aimed);
        arena.stompsRemaining = quest.isComplete(player) ? 3 : 1 + Math.floor(Math.random() * 3);
      }
      const tiles = arena.stompTiles;
      if (!charge) arena.stompsRemaining--;
      if (charge || arena.stompsRemaining === 0) {
        // shortcut: Wiki gives the 1–6 melee / 1–3 stomp ranges, not their distribution; verify with more fights.
        arena.meleeRemaining = quest.isComplete(player) ? 4 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 6);
        arena.nextSpecial = quest.isComplete(player) ? (charge ? "stomp" : "charge") : Math.random() < 0.5 ? "charge" : "stomp";
      }
      npc.setPositionToFace(aimed);
      npc.forceChat(charge ? "*growls*" : "*snorts*");
      npc.performAnimation(new Animation(charge ? ANIMATION.charge : ANIMATION.stomp, charge ? 60 : 30));
      const deltaX = aimed.getX() - at.getX() - 1, deltaY = aimed.getY() - at.getY() - 1;
      // The recording's charge is cardinal; choose the facing axis before the four-tile dash.
      const dx = Math.abs(deltaX) > Math.abs(deltaY) ? Math.sign(deltaX) : 0;
      const dy = dx ? 0 : Math.sign(deltaY) || 1;
      const end = new Location(Math.max(3241, Math.min(3265, at.getX() + 4 * dx)),
        Math.max(3266, Math.min(3293, at.getY() + 4 * dy)), 0);
      later(arena, charge && quest.isComplete(player) ? 3 : 4, () => {
        if (arena.isDestroyed() || npc.getHitpoints() <= 0 || player.getArea() !== arena) return;
        const current = player.getLocation();
        const underBull = current.getX() >= at.getX() && current.getX() <= at.getX() + 2 &&
          current.getY() >= at.getY() && current.getY() <= at.getY() + 2;
        const hit = charge
          ? !underBull && current.getX() >= Math.min(at.getX(), end.getX()) && current.getX() <= Math.max(at.getX(), end.getX()) + 2 &&
            current.getY() >= Math.min(at.getY(), end.getY()) && current.getY() <= Math.max(at.getY(), end.getY()) + 2
          : tiles.some(([x, y]) => current.getX() === x && current.getY() === y);
        if (!charge) {
          npc.performGraphic(new Graphic(STOMP_GRAPHIC.bull));
          for (const [x, y] of tiles) player.getPacketSender().sendGraphic(new Graphic(STOMP_GRAPHIC.ground), new Location(x, y, 0));
        } else npc.moveTo(end);
        if (hit) {
          const hp = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
          // shortcut: quest scaling is documented as roughly 30–40%; capture low-level hits to establish exact rounding.
          const min = Math.min(15, Math.max(1, Math.floor(hp * 0.3)));
          const max = Math.min(19, Math.max(1, Math.floor(hp * 0.4)));
          const damage = min + Math.floor(Math.random() * (max - min + 1));
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED).setSource(npc)]);
        }
      });
    }
    hits(npc, target) {
      if (!(npc.getArea() instanceof BullArena)) return super.hits(npc, target);
      if (npc.getArea().special) return [];
      const hit = new PendingHit(npc, target, this);
      hit.setTotalDamage(Math.min(3, hit.getTotalDamage(), quest.isComplete(target) ? 3 : Math.max(0, target.getHitpoints() - 1)));
      return [hit];
    }
  }
  const lampPending = new WeakMap();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function grantItem(player, itemId) {
    if (held(player, itemId)) return true;
    if (freeSlots(player) < 1) return false;
    player.getInventory().adds(itemId, 1);
    return true;
  }

  function hasEquippedAmulet(player) {
    // Cache wearPos 2 (neck/amulet); the charged and empty amulets share it.
    return (player.getEquipment?.()?.getItems?.() ?? []).some((item) =>
      item?.getId?.() === COWBELL_AMULET_ITEM_ID || item?.getId?.() === CHARGED_COWBELL_AMULET_ITEM_ID);
  }

  function hasAmulet(player) {
    return held(player, COWBELL_AMULET_ITEM_ID) || held(player, CHARGED_COWBELL_AMULET_ITEM_ID)
      || hasEquippedAmulet(player);
  }

  function sethTalked(player) {
    return Boolean(player.getAttribute(SETH_TALKED_ATTRIBUTE));
  }

  function gillieTalked(player) {
    return Boolean(player.getAttribute(GILLIE_TALKED_ATTRIBUTE));
  }

  function nearGillie(player) {
    const location = player.getLocation();
    return (
      Math.max(Math.abs(location.getX() - GILLIE_TILE.x), Math.abs(location.getY() - GILLIE_TILE.y)) <=
      GILLIE_TALK_RANGE && location.getZ() === 0
    );
  }

  /** Both Groatses spoken to: Cassius' report (and the book) unlock. */
  function advanceToGroats(player) {
    if (sethTalked(player) && gillieTalked(player) && quest.getStage(player) < STAGE_GROATS) {
      quest.setStage(player, STAGE_GROATS);
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Cassius asked me to research the Groats family's milk</str>",
        "<str>methods so he could start a milk empire of his own.</str>",
        "<str>His milk came from the Groats herd and tasted awful, and</str>",
        "<str>I slew the bull Brutus to save Gillie's herd.</str>",
        "<str>Cassius cut ties with me, but Gillie rewarded my help.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Cassius</col>",
        "by the <col=800000>Lumbridge pond</col>, south of the windmill.",
        "",
        "There are no requirements for this quest.",
      ];
    }
    const lines = [
      "Cassius wants me to learn how the <col=800000>Groats</col> family",
      "make their animals so productive.",
      "",
    ];
    lines.push(
      sethTalked(player)
        ? "<str>I spoke to Seth Groats about his principles.</str>"
        : "I should speak to <col=800000>Seth Groats</col> in the farmhouse north of the cow field."
    );
    lines.push(
      gillieTalked(player)
        ? "<str>I spoke to Gillie Groats about keeping her cows happy.</str>"
        : "I should speak to <col=800000>Gillie Groats</col> in the cow field."
    );
    if (stage >= STAGE_BOOK && stage < STAGE_SAMPLE && held(player, BOOK_ITEM_ID)) {
      lines.push("<str>I found Seth's book of principles on the shelves.</str>");
      lines.push("I should take the <col=800000>book</col> to <col=800000>Cassius</col>.");
    } else if (stage === STAGE_GROATS) {
      lines.push("I should search the <col=800000>shelves</col> for Seth's book.");
    }
    if (stage >= STAGE_SAMPLE && stage < STAGE_PERMIT) {
      lines.push("<str>Cassius gave me a sample of his milk to try.</str>");
      if (stage >= STAGE_SAMPLED) lines.push("<str>The milk was awful and made me cough.</str>");
    }
    if (stage >= STAGE_PERMIT && stage < STAGE_DUKE) {
      lines.push("I should take <col=800000>Cassius' sample</col> to the <col=800000>Duke</col>.");
    }
    if (stage >= STAGE_DUKE && stage < STAGE_BULL_TASK) {
      lines.push("<str>The Duke said to speak to Gillie Groats about the permit.</str>");
      lines.push("I should drink the sample in front of <col=800000>Gillie Groats</col>.");
    }
    if (stage === STAGE_BULL_TASK && !fightsByPlayer.has(player)) {
      lines.push("<str>Gillie asked me to deal with the aggressive bull.</str>");
      lines.push("I should open the <col=800000>gate</col> north-east of Gillie.");
    }
    if (stage >= STAGE_BULL_TASK && stage < STAGE_BRUTUS_DEAD && fightsByPlayer.has(player)) {
      lines.push("<str>I released the bull into the field.</str>");
      lines.push("I should defeat the <col=800000>bull</col>.");
    }
    if (stage >= STAGE_BRUTUS_DEAD && stage < STAGE_COMPLETE) {
      lines.push("<str>I defeated the bull, which turned out to be Brutus.</str>");
      lines.push("I should tell <col=800000>Gillie Groats</col>.");
    }
    if (stage >= STAGE_GILLIE_TOLD) {
      lines.push("<str>Gillie told me to confront Cassius about the bull.</str>");
      lines.push("I should speak to <col=800000>Cassius</col>.");
    }
    return lines;
  }

  /** Which transcript variant each speaker plays, by stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === CASSIUS_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-cassius";
      if (stage >= STAGE_GILLIE_TOLD) return "facing-the-bull-returning-to-cassius";
      if (stage >= STAGE_DUKE) {
        return held(player, SECOND_SAMPLE_ITEM_ID)
          ? "talking-to-the-duke-talking-to-cassius"
          : "returning-to-cassius-talking-to-cassius-again";
      }
      if (stage === STAGE_PERMIT) return "returning-to-cassius-talking-to-cassius-again";
      if (stage === STAGE_SAMPLED) return "returning-to-cassius-after-sampling-the-milk-resume";
      if (stage === STAGE_SAMPLE) {
        return held(player, FIRST_SAMPLE_ITEM_ID)
          ? "returning-to-cassius-talking-to-cassius-before-sampling-the-milk"
          : "returning-to-cassius-reclaiming-the-milk-sample";
      }
      if (stage === 5) return "returning-to-cassius-reclaiming-the-milk-sample";
      if (stage >= STAGE_GROATS) return "returning-to-cassius";
      if (stage >= STAGE_STARTED) {
        return "starting-off-talking-to-cassius-again-before-talking-to-both-gillie-and-seth";
      }
      return null;
    }
    if (npcId === GILLIE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return selectPostQuestGillieVariant(player);
      if (stage >= STAGE_GILLIE_TOLD) return "facing-the-bull-talking-to-gillie-again";
      if (stage >= STAGE_BRUTUS_DEAD) return "facing-the-bull-talking-to-gillie";
      if (stage >= STAGE_BULL_TASK) return "talking-to-the-duke-talking-to-gillie-again-2";
      if (stage === STAGE_GILLIE_SAMPLE) return "talking-to-the-duke-talking-to-gillie-again";
      if (stage === STAGE_DUKE) return "talking-to-the-duke-talking-to-gillie";
      if (stage >= STAGE_STARTED && stage <= STAGE_GROATS) return "starting-off-talking-to-gillie";
      if (stage === STAGE_SECOND_DRUNK) return "talking-to-the-duke-drinking-the-second-sample";
      return null;
    }
    if (npcId === SETH_NPC_ID) {
      if (stage <= 0 || stage >= STAGE_COMPLETE) return null;
      return sethTalked(player) ? "starting-off-talking-to-seth-again" : "starting-off-talking-to-seth";
    }
    if (npcId === DUKE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage === STAGE_PERMIT) return "talking-to-the-duke";
      if (stage >= STAGE_DUKE) return "talking-to-the-duke-talking-to-the-duke-again";
      return null;
    }
    return null;
  }

  /** Post-quest Gillie: the amulet and lamp hand-outs, and reclaims. */
  function selectPostQuestGillieVariant(player) {
    if (!player.getAttribute(REWARD_ATTRIBUTE)) return "post-quest-talking-to-gillie";
    if (!player.getAttribute(LAMP_USED_ATTRIBUTE) && !held(player, MAGIC_LAMP_ITEM_ID)) {
      return "post-quest-talking-to-gillie-again-if-the-player-doesn-t-have-the-lamp-and-hasn-t-used-it-yet";
    }
    if (!hasAmulet(player)) return "post-quest-talking-to-gillie-without-a-cowbell-amulet";
    return null;
  }

  /** Answer the page's prose conditions (all identified by step id). */
  function answerCondition({ player, stepId }) {
    if (!CONDITION_IDS.has(stepId)) return null;
    if (stepId === "nFcTGN") return false; // no quest speedrunning worlds here
    if (stepId === "UGwoXz") return !sethTalked(player);
    if (stepId === "P1dfHS") return sethTalked(player);
    if (stepId === "iRWhJf") return player.isIronman?.() === true;
    if (stepId === "3dp-G-") return player.isIronman?.() !== true;
    if (stepId === "MeCHpF") return !sethTalked(player) || held(player, BOOK_ITEM_ID);
    if (stepId === "aOfzEg" || stepId === "8iIMZ6") return !held(player, BOOK_ITEM_ID);
    if (stepId === "iVxuGF") return held(player, BOOK_ITEM_ID);
    if (stepId === "mn6454" || stepId === "jS5Ned") return !held(player, SECOND_SAMPLE_ITEM_ID);
    if (stepId === "bo0hmW" || stepId === "gROlcY") return held(player, SECOND_SAMPLE_ITEM_ID);
    if (stepId === "g99Opl" || stepId === "1qWPVz" || stepId === "wgvV7v") return freeSlots(player) < 1;
    if (stepId === "Si4XUQ" || stepId === "Q-sZIb" || stepId === "CltN0x") return freeSlots(player) >= 1;
    if (stepId === "rQeSSv" || stepId === "eeHo4c") return freeSlots(player) < 1;
    // Gillie's amulet is handed over earlier in this same transcript, so the
    // lamp's space check must count that slot.
    if (stepId === "m2cjiq") return freeSlots(player) - (hasAmulet(player) ? 0 : 1) < 1;
    if (stepId === "0MczJn") return freeSlots(player) - (hasAmulet(player) ? 0 : 1) >= 1;
    return null;
  }

  /** Condition branch picked: record the Groats visit and the Gillie agreement. */
  function handleConditionStep({ player, stepId }) {
    if (stepId === "UGwoXz" || stepId === "P1dfHS") {
      player.setAttribute(GILLIE_TALKED_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(GILLIE_INFORMATION_VARBIT, 1);
      advanceToGroats(player);
      return;
    }
  }

  /** Lines that mark the end of a milestone conversation (no action id exists). */
  function handleDialogueLine(event) {
    const { npcId, player, text } = event;
    const stage = quest.getStage(player);
    if (npcId === CASSIUS_NPC_ID && text === "Of milk." && stage === STAGE_ACCEPTED) {
      event.before = () => quest.setStage(player, STAGE_EMPIRE);
    } else if (npcId === CASSIUS_NPC_ID && String(text).startsWith("Not to mention, my associate Brutus") && stage < STAGE_STARTED) {
      event.before = () => quest.setStage(player, STAGE_STARTED);
    } else if (npcId === SETH_NPC_ID && String(text).startsWith("Anyway, feel free to grab me book") && stage >= STAGE_STARTED) {
      event.before = () => {
        player.setAttribute(SETH_TALKED_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(SETH_INFORMATION_VARBIT, 1);
        advanceToGroats(player);
      };
    } else if (npcId === DUKE_NPC_ID && stage === STAGE_PERMIT && String(text).startsWith("Why not speak to Gillie Groats?")) {
      event.before = () => quest.setStage(player, STAGE_DUKE);
    } else if (npcId === GILLIE_NPC_ID && stage === STAGE_DUKE && text === "It definitely won't hurt your chances.") {
      event.before = () => quest.setStage(player, STAGE_GILLIE_SAMPLE);
    } else if (npcId === GILLIE_NPC_ID && stage === STAGE_SECOND_DRUNK && String(text).startsWith("Perhaps you'd be interested in dealing with him?")) {
      event.before = () => quest.setStage(player, STAGE_BULL_TASK);
    } else if (npcId === GILLIE_NPC_ID && stage === STAGE_BRUTUS_DEAD && String(text).startsWith(GILLIE_CONFRONT_PREFIX)) {
      event.before = () => quest.setStage(player, STAGE_GILLIE_TOLD);
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== CASSIUS_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_ACCEPTED);
  }

  /** The transcript's item/stage side effects, keyed by message/action id. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (event.npcId && ![CASSIUS_NPC_ID, SETH_NPC_ID, GILLIE_NPC_ID, BULL_NPC_ID].includes(event.npcId)) return;
    if (stepId === "bkgpn5" && (player.getSkillManager().getCombatLevel?.() ?? 15) >= 15) event.handled = true;
    if (stepId === "y7Vpgm") {
      grantItem(player, BOOK_ITEM_ID);
      event.box = { items: [BOOK_ITEM_ID] };
      return;
    }
    if (stepId === "CPf4Gm") {
      if (!held(player, BOOK_ITEM_ID) || quest.getStage(player) !== STAGE_BOOK) { event.end = true; return; }
      player.getInventory().deleteNumber(BOOK_ITEM_ID, 1);
      quest.setStage(player, 5);
      event.box = { items: [BOOK_ITEM_ID] };
      return;
    }
    if (stepId === "Z5eNNH") {
      if (!grantItem(player, FIRST_SAMPLE_ITEM_ID)) { event.end = true; return; }
      if (quest.getStage(player) === 5) quest.setStage(player, STAGE_SAMPLE);
      event.box = { items: [FIRST_SAMPLE_ITEM_ID] };
      return;
    }
    if (stepId === "HHZ-6k") {
      grantItem(player, FIRST_SAMPLE_ITEM_ID);
      if (quest.getStage(player) === 5) quest.setStage(player, STAGE_SAMPLE);
      event.box = { items: [FIRST_SAMPLE_ITEM_ID] };
      return;
    }
    if (stepId === "gAirRb") {
      if (!grantItem(player, SECOND_SAMPLE_ITEM_ID)) { event.end = true; return; }
      if (quest.getStage(player) === STAGE_SAMPLED) quest.setStage(player, STAGE_PERMIT);
      event.box = { items: [SECOND_SAMPLE_ITEM_ID] };
      return;
    }
    if (stepId === "4bCa8j") {
      grantItem(player, SECOND_SAMPLE_ITEM_ID);
      return;
    }
    if (stepId === "mKQNRL" || stepId === "kaznTu") {
      if (stepId === "kaznTu") {
        player.setAttribute(DONT_ASK_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(DONT_ASK_VARBIT, 1);
      }
      spawnBull(player);
      event.handled = true;
      return;
    }
    if (stepId === "K6Gvs6") {
      if (!grantItem(player, COWBELL_AMULET_ITEM_ID)) { event.end = true; return; }
      player.setAttribute(REWARD_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(REWARD_VARBIT, 1);
      event.box = { items: [CHARGED_COWBELL_AMULET_ITEM_ID] };
      return;
    }
    if (stepId === "YGE9x4" || stepId === "hoJ1qn") {
      grantItem(player, MAGIC_LAMP_ITEM_ID);
      event.box = { items: [MAGIC_LAMP_ITEM_ID] };
      return;
    }
    if (stepId === "2ePb5b") {
      if (!hasAmulet(player)) grantItem(player, COWBELL_AMULET_ITEM_ID);
      return;
    }
    if (stepId === "O4owU9") {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player) && quest.getStage(player) === STAGE_GILLIE_TOLD) {
        quest.complete(player);
      }
      return;
    }
    if (stepId === "9FVdU5") {
      event.handled = true;
      return; // The drink owns this one-time, delayed reaction.
    }
    if (stepId === "HSM347") {
      event.handled = true;
      event.box = { statement: true };
    }
    if (stepId === "fc4Kit") {
      event.handled = true;
    }
  }

  /** The capture swaps the entire cow field into a private fight, not the bull's pen. */
  function spawnArenaBull(arena) {
    if (arena.isDestroyed() || arena.bull) return;
    const npc = api.spawnNpc({ id: QUEST_BRUTUS_NPC_ID, ...BULL_TILE, wanderRadius: 0, owner: arena.player, ownerOnly: true });
    if (!npc) return;
    arena.bull = npc;
    npc.setCombatXpMultiplier(2);
    arena.meleeRemaining = quest.isComplete(arena.player) ? 4 + Math.floor(Math.random() * 2) : 3;
    arena.nextSpecial = quest.isComplete(arena.player) && Math.random() < 0.5 ? "stomp" : "charge";
    arena.stompsRemaining = 0;
    arena.respawnTask = null;
    arena.enter(npc);
    bullsByPlayer.set(arena.player, npc);
    npc.performAnimation(new Animation(ANIMATION.spawn));
  }

  function spawnBull(player) {
    if (fightsByPlayer.has(player)) return;
    if (quest.getStage(player) !== STAGE_BULL_TASK && !quest.isComplete(player)) return;
    const arena = new BullArena(player);
    fightsByPlayer.set(player, arena);
    const sender = player.getPacketSender();
    sender.sendVarbit(12393, 1);
    sender.sendVarbit(6719, 2);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.setUntargetable(true);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, "The bull enters. The cows scatter.")));
    StatementDialogue.send(player, "The bull enters. The cows scatter.", false);
    player.getCombat().reset();
    later(arena, 2, () => {
      if (arena.isDestroyed() || fightsByPlayer.get(player) !== arena) return;
      player.moveTo(new Location(3262, 3294, 0));
      arena.enter(player);
      for (const leaf of [
        [ObjectIdentifiers.GATE_321, 3263, 3294, 1], [ObjectIdentifiers.GATE_320, 3262, 3294, 1],
        [ObjectIdentifiers.GATE_323, 3253, 3267, 0], [ObjectIdentifiers.GATE_324, 3253, 3266, 0],
      ]) {
        ObjectManager.register(new GameObject(leaf[0], new Location(leaf[1], leaf[2], 0), 0, leaf[3], arena), true);
      }
      spawnArenaBull(arena);
      if (!arena.bull) { leaveFight(player); return; }
      later(arena, 2, () => {
        if (arena.isDestroyed()) return;
        sender.sendVarbit(12393, 0);
        sender.sendVarbit(6719, 0);
        player.getMovementQueue().setBlockMovement(false);
        player.setUntargetable(false);
        player.getDialogueManager().reset();
        sender.sendInterfaceRemoval();
      });
    });
  }

  function leaveFight(player) {
    const arena = fightsByPlayer.get(player);
    if (!arena) return;
    TaskManager.cancelTasks(arena);
    player.getPacketSender().sendVarbit(12393, 0);
    player.getPacketSender().sendVarbit(6719, 0);
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable(false);
    player.getCombat().reset();
    if (arena.bull) api.removeNpc(arena.bull);
    if (player.getArea() === arena) arena.leave(player, false);
    else arena.destroy();
    fightsByPlayer.delete(player);
    bullsByPlayer.delete(player);
  }

  function handleNpcDeath({ killer, npc }) {
    const arena = npc?.getArea?.();
    if (!(arena instanceof BullArena) || arena.bull !== npc) return;
    npc.__skipDefaultRespawn = true;
    const player = arena.player;
    if (killer !== player) return;
    if (quest.isComplete(player)) {
      arena.bull = null;
      bullsByPlayer.delete(player);
      api.removeNpc(npc);
      // Keep the field and its loot until the player leaves; Ring can bring the next bull early.
      arena.respawnTask = later(arena, npc.getDefinition().getRespawn(), () => spawnArenaBull(arena));
      return;
    }
    leaveFight(player);
    if (quest.getStage(player) === STAGE_BULL_TASK) {
      quest.setStage(player, STAGE_BRUTUS_DEAD);
      player.sendMessage("You notice a strange tag float to the ground as the bull falls. It reads 'Brutus'.");
      startTranscript(api, player, BULL_NPC_ID, PAGE, "facing-the-bull-after-killing-brutus");
    }
  }

  function ringForBull({ player }) {
    const arena = fightsByPlayer.get(player);
    if (arena && quest.isComplete(player) && !arena.bull && arena.respawnTask) {
      arena.respawnTask.stop();
      arena.respawnTask = later(arena, 13, () => spawnArenaBull(arena));
    }
  }
  /** The first sample's "that's not good milk" damage (never below 1 Hitpoint). */
  function damageFromSample(player) {
    if (Number(player.getHitpoints?.() ?? 2) <= 1) return;
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.GREEN)]);
  }

  function drinkFirstSample(player) {
    if (quest.getStage(player) !== STAGE_SAMPLE) return;
    if (!held(player, FIRST_SAMPLE_ITEM_ID)) return;
    player.getInventory().deleteNumber(FIRST_SAMPLE_ITEM_ID, 1);
    player.performAnimation(new Animation(ANIMATION.eat));
    quest.setStage(player, STAGE_SAMPLED);
    const variant = "returning-to-cassius-after-sampling-the-milk";
    startTranscript(api, player, CASSIUS_NPC_ID, PAGE, variant, steps => steps.slice(0, 1));
    later(player, 3, () => {
      player.performAnimation(new Animation(ANIMATION.cough));
      damageFromSample(player);
    });
    later(player, 5, () => startTranscript(api, player, CASSIUS_NPC_ID, PAGE, variant, steps => steps.slice(2)));
  }

  function drinkSecondSample(player) {
    const stage = quest.getStage(player);
    if (!held(player, SECOND_SAMPLE_ITEM_ID)) return;
    if (stage === STAGE_GILLIE_SAMPLE && nearGillie(player)) {
      player.getInventory().deleteNumber(SECOND_SAMPLE_ITEM_ID, 1);
      player.performAnimation(new Animation(ANIMATION.eat));
      quest.setStage(player, STAGE_SECOND_DRUNK);
      startTranscript(api, player, GILLIE_NPC_ID, PAGE, "talking-to-the-duke-drinking-the-second-sample");
      return;
    }
    if (stage === STAGE_GILLIE_SAMPLE) {
      startTranscript(
        api,
        player,
        GILLIE_NPC_ID,
        PAGE,
        "talking-to-the-duke-talking-to-gillie-again-attempting-to-drink-the-sample-while-not-next-to-gillie"
      );
      return;
    }
    if (stage === STAGE_PERMIT || stage === STAGE_DUKE) {
      startTranscript(
        api,
        player,
        CASSIUS_NPC_ID,
        PAGE,
        "returning-to-cassius-attempting-to-drink-the-second-sample"
      );
    }
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (itemId === BOOK_ITEM_ID && option === "Read" && held(player, BOOK_ITEM_ID)) {
      event.handled = true;
      openBook(player, "The Groats Principles", require("../data/ides-of-milk-book.json"));
      return;
    }
    if (itemId === FIRST_SAMPLE_ITEM_ID && option === "Destroy" && quest.getStage(player) === STAGE_SAMPLE) {
      player.sendMessage("Why would you want to destroy such good milk? Do you not wish to taste it?");
    }
    if (itemId === FIRST_SAMPLE_ITEM_ID && option === "Drink") {
      event.handled = true;
      drinkFirstSample(player);
      return;
    }
    if (itemId === SECOND_SAMPLE_ITEM_ID && option === "Drink") {
      event.handled = true;
      drinkSecondSample(player);
      return;
    }
    if (itemId === MAGIC_LAMP_ITEM_ID && option === "Rub") {
      event.handled = true;
      rubLamp(player, event.item, event.slot);
    }
  }

  /** The lamp rubs through the shared stat-advance interface (XpReward.plugin.js). */
  function rubLamp(player, item, slot) {
    lampPending.set(player, item);
    api.emitCustomEvent("xpreward:open", {
      player,
      title: "Choose the stat you wish to be advanced!",
      skills: COMBAT_SKILLS,
      onConfirm: (skill, name) => confirmLamp(player, item, slot, skill, name),
    });
  }

  function confirmLamp(player, item, slot, skill, name) {
    if (!COMBAT_SKILLS.includes(skill) || !quest.isComplete(player) || player.getAttribute(LAMP_USED_ATTRIBUTE)) return null;
    if (lampPending.get(player) !== item) return null;
    lampPending.delete(player);
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item) return null;
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_XP, false);
    if (manager.getExperience(skill) === before) return null;
    inventory.deleteAtSlot(slot, 1);
    player.setAttribute(LAMP_USED_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(LAMP_VARBIT, 1);
    return `<col=0000ff>Your wish has been granted!</col> You have been awarded 1,000 ${name ?? skill.getName()} experience!`;
  }

  function searchShelves(player) {
    if (!sethTalked(player) || quest.getStage(player) < STAGE_STARTED) return;
    startTranscript(api, player, SETH_NPC_ID, PAGE, "starting-off-searching-the-shelf");
  }

  function useBullGate(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      if (player.getAttribute(DONT_ASK_ATTRIBUTE)) { spawnBull(player); return; }
      startTranscript(api, player, BULL_NPC_ID, PAGE, "facing-the-bull");
      return;
    }
    if (stage >= STAGE_BRUTUS_DEAD) {
      startTranscript(api, player, BULL_NPC_ID, PAGE, "facing-the-bull-attempting-to-open-the-gate-again");
      return;
    }
    if (stage >= STAGE_BULL_TASK) {
      startTranscript(api, player, BULL_NPC_ID, PAGE, "facing-the-bull");
      return;
    }
    startTranscript(api, player, BULL_NPC_ID, PAGE, "starting-off-attempting-to-release-the-bull-early");
  }

  /**
   * Doors.plugin.js also registers the "Release" gate and emits door:toggle
   * before it acts, so the quest claims the two bull-pen gates there.
   */
  function claimBullGate(request) {
    if (request.handled) return;
    if (EXIT_GATE_IDS.has(request.objectId) && fightsByPlayer.has(request.player)) {
      request.handled = true;
      leaveFight(request.player);
      request.player.moveTo(new Location(3252, 3266, 0));
      return;
    }
    if (!BULL_GATE_OBJECT_IDS.has(request.objectId)) return;
    request.handled = true;
    useBullGate(request.player);
  }

  function handleObjectInteraction(event) {
    if (EXIT_GATE_IDS.has(event.objectId) && fightsByPlayer.has(event.player)) {
      event.handled = true;
      leaveFight(event.player);
      event.player.moveTo(new Location(3252, 3266, 0));
      return;
    }
    if (event.objectId === SHELVES_OBJECT_ID) {
      event.handled = true;
      searchShelves(event.player);
      return;
    }
    if (BULL_GATE_OBJECT_IDS.has(event.objectId)) {
      event.handled = true;
      useBullGate(event.player);
    }
  }


  function handleLogout({ player }) {
    leaveFight(player);
    lampPending.delete(player);
  }

  function suppressQuestLoot(event) {
    if (event.npc?.getArea?.() instanceof BullArena && quest.getStage(event.player) < STAGE_COMPLETE) event.drops.length = 0;
  }

  function handleLogin({ player }) {
    if (!player.getAttribute(STAGE_SCHEMA_ATTRIBUTE)) {
      const old = quest.getStage(player);
      if (old > 0 && old < LEGACY_STAGES.length) quest.setStage(player, LEGACY_STAGES[old]);
      player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, 1);
    }
    const sender = player.getPacketSender();
    sender.sendVarbit(GILLIE_INFORMATION_VARBIT, Number(gillieTalked(player)));
    sender.sendVarbit(SETH_INFORMATION_VARBIT, Number(sethTalked(player)));
    sender.sendVarbit(REWARD_VARBIT, Number(Boolean(player.getAttribute(REWARD_ATTRIBUTE))));
    sender.sendVarbit(LAMP_VARBIT, Number(Boolean(player.getAttribute(LAMP_USED_ATTRIBUTE))));
    refreshQuestList(player);
    sender.sendVarbit(DONT_ASK_VARBIT, Number(Boolean(player.getAttribute(DONT_ASK_ATTRIBUTE))));
  }

  api.persistAttribute(SETH_TALKED_ATTRIBUTE, 0);
  api.persistAttribute(GILLIE_TALKED_ATTRIBUTE, 0);
  api.persistAttribute(REWARD_ATTRIBUTE, 0);
  api.persistAttribute(LAMP_USED_ATTRIBUTE, 0);

  api.persistAttribute(STAGE_SCHEMA_ATTRIBUTE, 0);
  api.persistAttribute(DONT_ASK_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "the_ides_of_milk",
    name: "The Ides of Milk",
    varpId: VARP_COWQUEST,
    varbitId: VARBIT_COWQUEST,
    startedValue: STAGE_ACCEPTED,
    completionValue: STAGE_COMPLETE,
    completionJingleId: 154,
    scrollItemId: SECOND_SAMPLE_ITEM_ID,
    questPoints: 1,
    xpRewards: [],
    otherRewards: [
      "Access to Brutus' Field",
      "Gillie's Cowbell Supply",
    ],
    buildJournal,
  });

  api.registerArea(new BullPen());
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("door:toggle", claimBullGate);
  api.onCustomEvent("npc-drops:generated", suppressQuestLoot);
  api.onCustomEvent("ides-of-milk:cowbell-ring", ringForBull);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(handleItemAction);
  api.onNpcDeath(handleNpcDeath);
  api.registerNpcCombatMethodProvider([QUEST_BRUTUS_NPC_ID], BrutusCombat);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  require("./ides-of-milk/CowbellAmulet.Quest")(api);
};
