const fs = require("fs");
const path = require("path");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Server } = require("../../src/main/typescript/elvarg/Server");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { PluginManager } = require("../../src/main/typescript/elvarg/plugins/PluginManager");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { MagicSpellbook } = require("../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { WeaponInterfaceManager } = require("../../src/main/typescript/elvarg/game/content/combat/WeaponInterfaceManager");
const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { Bank } = require("../../src/main/typescript/elvarg/game/model/container/impl/Bank");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { CombatSpecial } = require("../../src/main/typescript/elvarg/game/content/combat/CombatSpecial");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { PlayerSave } = require("../../src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerSave");
const { DamageFormulas } = require("../../src/main/typescript/elvarg/game/content/combat/formula/DamageFormulas");
const { ServerLogger } = require("../../src/main/typescript/elvarg/util/ServerLogger");
const {
  DefinitionLoader,
} = require("../../src/main/typescript/elvarg/game/definition/loader/DefinitionLoader");
const {
  NpcSpawnDefinitionLoader,
} = require("../../src/main/typescript/elvarg/game/definition/loader/impl/NpcSpawnDefinitionLoader");
const { NpcDefinition } = require("../../src/main/typescript/elvarg/game/definition/NpcDefinition");
const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { findNpcRigAnimations, getLastSequenceId } = require("../../src/main/typescript/elvarg/game/cache/NpcAnimationScanner");
const {
  ShopDefinitionLoader,
} = require("../../src/main/typescript/elvarg/game/definition/loader/impl/ShopDefinitionLoader");
const {
  ShopManager,
} = require("../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");

const ATTACK_RANGE_DEBUG_GRAPHIC = new Graphic(332, 0);
const MAX_NPC_COMMAND_SPAWNS = 20;
const RUNE_IDS = [554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 9075, 21880, 28929];
const NPC_SPAWN_FILE_CANDIDATES = [
  path.join(process.cwd(), "data", "definitions", "npc_spawns.json"),
];
const NPC_ANIMATION_ROLES = ["attack", "block", "death", "spawn", "other"];
const NPC_ANIMATION_FILES = Object.freeze({
  possible: path.resolve(GameConstants.DEFINITIONS_DIRECTORY, "npc-animations.json"),
  combat: path.resolve(GameConstants.DEFINITIONS_DIRECTORY, "npc-combat-defs.json"),
});
const NPC_FACING_BY_NAME = Object.freeze({
  NORTH_WEST: 5,
  NORTH: 6,
  NORTH_EAST: 7,
  WEST: 3,
  EAST: 4,
  SOUTH_WEST: 0,
  SOUTH: 1,
  SOUTH_EAST: 2,
});
const NPC_FACING_ALIASES = Object.freeze({
  N: "NORTH",
  NORTH: "NORTH",
  S: "SOUTH",
  SOUTH: "SOUTH",
  E: "EAST",
  EAST: "EAST",
  W: "WEST",
  WEST: "WEST",
  NW: "NORTH_WEST",
  NORTHWEST: "NORTH_WEST",
  NORTH_WEST: "NORTH_WEST",
  NE: "NORTH_EAST",
  NORTHEAST: "NORTH_EAST",
  NORTH_EAST: "NORTH_EAST",
  SW: "SOUTH_WEST",
  SOUTHWEST: "SOUTH_WEST",
  SOUTH_WEST: "SOUTH_WEST",
  SE: "SOUTH_EAST",
  SOUTHEAST: "SOUTH_EAST",
  SOUTH_EAST: "SOUTH_EAST",
});
const GLOW_PRESET_ATTRIBUTE = "visual:glowPreset";
const GLOW_INTENSITY_ATTRIBUTE = "visual:glowIntensity";
const GLOW_CYCLE_TASK_KEY_ATTRIBUTE = "visual:glowCycleTaskKey";
const GLOW_CYCLE_PRESETS = Object.freeze([
  "blood",
  "toxic",
  "ice",
  "gold",
  "royal",
  "infernal",
]);
const GLOW_CYCLE_STEP_TICKS = 5;
const GLOW_CYCLE_INTENSITY = 2;
const GLOW_PRESETS = Object.freeze({
  off: 0,
  none: 0,
  blood: 1,
  gold: 2,
  toxic: 3,
  ice: 4,
  royal: 5,
  infernal: 6,
});

function cancelGlowCycle(target) {
  const cycleTaskKey = target?.getAttribute?.(GLOW_CYCLE_TASK_KEY_ATTRIBUTE);
  if (!cycleTaskKey) {
    return false;
  }
  TaskManager.cancelTasks(cycleTaskKey);
  target.setAttribute?.(GLOW_CYCLE_TASK_KEY_ATTRIBUTE, null);
  return true;
}

function applyGlowState(target, glowPreset, glowIntensity) {
  target.setAttribute(GLOW_PRESET_ATTRIBUTE, glowPreset);
  target.setAttribute(GLOW_INTENSITY_ATTRIBUTE, glowIntensity);
  target.getUpdateFlag().flag(Flag.APPEARANCE);
}

function startGlowCycle(target) {
  cancelGlowCycle(target);
  const cycleTaskKey = {};
  target.setAttribute?.(GLOW_CYCLE_TASK_KEY_ATTRIBUTE, cycleTaskKey);

  let presetIndex = 0;
  const applyCurrentPreset = () => {
    const presetName = GLOW_CYCLE_PRESETS[presetIndex % GLOW_CYCLE_PRESETS.length];
    const glowPreset = GLOW_PRESETS[presetName] ?? GLOW_PRESETS.off;
    applyGlowState(target, glowPreset, GLOW_CYCLE_INTENSITY);
    presetIndex++;
  };

  applyCurrentPreset();

  TaskManager.submit(
    new (class extends Task {
      constructor() {
        super(GLOW_CYCLE_STEP_TICKS, cycleTaskKey, false);
      }

      execute() {
        if (!target?.isRegistered?.() || target.getAttribute?.(GLOW_CYCLE_TASK_KEY_ATTRIBUTE) !== cycleTaskKey) {
          this.stop();
          return;
        }
        applyCurrentPreset();
      }
    })()
  );
}

function parseIntArg(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeFacingToken(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized.length === 0) {
    return null;
  }
  return NPC_FACING_ALIASES[normalized] ?? null;
}

function parseFacingArg(value) {
  if (value == null) {
    return { id: -1, label: "default" };
  }
  const parsedNumeric = parseIntArg(value);
  if (parsedNumeric !== null && parsedNumeric >= -1 && parsedNumeric <= 7) {
    return {
      id: parsedNumeric,
      label: parsedNumeric === -1 ? "default" : String(parsedNumeric),
    };
  }
  const directionName = normalizeFacingToken(value);
  if (!directionName) {
    return null;
  }
  return { id: NPC_FACING_BY_NAME[directionName], label: directionName.toLowerCase() };
}

function resolveNpcSpawnFileForWrite() {
  for (const candidate of NPC_SPAWN_FILE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return NPC_SPAWN_FILE_CANDIDATES[0];
}

function appendPersistentNpcSpawn(spawnEntry) {
  const file = resolveNpcSpawnFileForWrite();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });

  let existing = [];
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) {
        existing = parsed;
      }
    } catch (error) {
      throw new Error(`Failed to parse npc spawns file (${file}): ${error?.message ?? error}`);
    }
  }

  existing.push(spawnEntry);
  fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  return file;
}

function parseCsvArgs(parts, start = 1) {
  return parts
    .slice(start)
    .join(" ")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function commandTail(raw, parts) {
  return raw.substring(parts[0].length).trim();
}

function normalizePlayerCommandName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^\[+|\]+$/g, "");
}

function resolvePlayerByCommandTail(raw, parts) {
  const targetName = normalizePlayerCommandName(commandTail(raw, parts));
  if (!targetName) {
    return null;
  }
  const exact = World.getPlayerByName(targetName);
  if (exact) {
    return exact;
  }

  const formatted = String(targetName).trim().toLowerCase();
  let prefixMatch = null;
  let prefixCount = 0;
  World.getPlayers().forEach((player) => {
    const username = player?.getUsername?.();
    if (typeof username !== "string" || username.length === 0) {
      return;
    }
    const candidate = username.toLowerCase();
    if (candidate === formatted) {
      prefixMatch = player;
      prefixCount = 1;
      return;
    }
    if (candidate.startsWith(formatted)) {
      prefixMatch = player;
      prefixCount++;
    }
  });

  return prefixCount === 1 ? prefixMatch : null;
}

function ownerOrDev(player) {
  const rights = player?.getRights?.();
  return rights === PlayerRights.OWNER || rights === PlayerRights.DEVELOPER;
}

function devOnly(player) {
  return player?.getRights?.() === PlayerRights.DEVELOPER;
}

function queueNpcSpawn(player, id, amount = 1, onSpawn = null, xOffset = 0, yOffset = 0) {
  const origin = player.getLocation().clone();
  origin.add(xOffset, yOffset);
  const spawnCount = Math.min(Math.max(1, amount), MAX_NPC_COMMAND_SPAWNS);
  let spawned = 0;

  for (let i = 0; i < spawnCount; i++) {
    const spawn = origin.clone();
    if (i > 0) {
      const offsetX = (i % 3) - 1;
      const offsetY = ((Math.floor(i / 3)) % 3) - 1;
      spawn.setX(origin.getX() + offsetX);
      spawn.setY(origin.getY() + offsetY);
    }

    const npc = NPC.create(id, spawn);
    const currentHp = npc.getHitpoints?.();
    if (!Number.isFinite(currentHp) || currentHp <= 0) {
      npc.setHitpoints(10);
    }

    World.getAddNPCQueue().push(npc);
    if (player.getPrivateArea()) {
      player.getPrivateArea().add(npc);
    }
    onSpawn?.(npc);
    spawned++;
  }

  return spawned;
}

// The cache's chatbox search (clientscript 750) searches names client side and resumes the
// dialogue with what was picked - everything a spawner needs, without a server-drawn
// interface. The title tells the client which types to search and to put the spawn amounts
// on each row, so a pick arrives as "<id> <op>".
const SEARCH_SCRIPT = 750;
const SEARCH_CLOSE_SCRIPT = 138;
const ITEM_SEARCH_TITLE = "Item Search";
const NPC_SEARCH_TITLE = "NPC Search";
const SPAWN_OP_AMOUNTS = [1, 5, 10];
const SPAWN_OP_X = SPAWN_OP_AMOUNTS.length + 1;
const MAX_SPAWN_AMOUNT = 2147483647;
const spawnSearches = new WeakMap();

function openSpawnSearch(player, title, spawn) {
  spawnSearches.set(player, spawn);
  player.setEnteredSyntaxAction({ execute: (input) => spawnSearchPick(player, input) });
  player.getPacketSender().sendInterfaceScript(SEARCH_SCRIPT, [title, 0, -1, 0]);
}

function endSpawnSearch(player) {
  spawnSearches.delete(player);
  player.setEnteredSyntaxAction(null);
}

function closeSpawnSearch(player) {
  if (!spawnSearches.has(player)) {
    return;
  }
  endSpawnSearch(player);
  player.getPacketSender().sendClientScript(SEARCH_CLOSE_SCRIPT);
}

// Walking away closes it, the same as any other interface.
function closeSpawnSearchOnMove({ player }) {
  if (spawnSearches.has(player) && player.getMovementQueue()?.didMoveThisCycle?.()) {
    closeSpawnSearch(player);
  }
}

function spawnSearchPick(player, input) {
  const spawn = spawnSearches.get(player);
  // The client closes the search itself once a row is picked.
  endSpawnSearch(player);
  const [idPart, opPart] = String(input).split(" ");
  const id = parseIntArg(idPart);
  const op = parseIntArg(opPart) ?? 1;
  if (!spawn || id === null || id < 0) {
    return;
  }
  if (op === SPAWN_OP_X) {
    player.setEnteredAmountAction({ execute: (amount) => spawnEnteredAmount(spawn, amount, id) });
    player.getPacketSender().sendEnterAmountPrompt("Enter the amount to spawn.");
    return;
  }
  spawn(id, SPAWN_OP_AMOUNTS[op - 1] ?? 1);
}

function spawnEnteredAmount(spawn, amount, id) {
  const requested = Math.floor(Number(amount));
  if (Number.isFinite(requested) && requested >= 1) {
    spawn(id, Math.min(requested, MAX_SPAWN_AMOUNT));
  }
}

function spawnSearchedItem(player, id, amount) {
  // Re-checked here: the pick arrives on a later tick, and this is a privileged action.
  if (!PluginManager.playerHasCommandRights(player, "items") || !CacheDefinitions.hasItem(id)) {
    return;
  }
  // Stacks are a signed 32-bit value; the container clamps and stops on a full inventory.
  player.getInventory().adds(id, amount);
  player
    .sendMessage(`Spawned ${amount} x ${ItemDefinition.forId(id)?.getName?.() ?? "item"} (${id}).`);
}

function spawnSearchedNpc(player, id, amount) {
  if (!ownerOrDev(player) || id >= CacheDefinitions.getCounts().npcs) {
    return;
  }
  const spawned = queueNpcSpawn(player, id, amount);
  player
    .sendMessage(`Spawned ${spawned} x ${NpcDefinition.forId(id)?.getName?.() ?? "npc"} (${id}).`);
}

function itemSearchCommand({ player }) {
  openSpawnSearch(player, ITEM_SEARCH_TITLE, (id, amount) => spawnSearchedItem(player, id, amount));
  return true;
}

function npcSearchCommand({ player }) {
  openSpawnSearch(player, NPC_SEARCH_TITLE, (id, amount) => spawnSearchedNpc(player, id, amount));
  return true;
}

function getNpcCachedAnimations(npc) {
  return [...new Set([
    npc?.idleSeqId,
    npc?.walkSeqId,
    npc?.walkBackSeqId,
    npc?.walkLeftSeqId,
    npc?.walkRightSeqId,
    npc?.turnLeftSeqId,
    npc?.turnRightSeqId,
    npc?.runSeqId,
    npc?.runBackSeqId,
    npc?.runLeftSeqId,
    npc?.runRightSeqId,
  ].filter((id) => Number.isInteger(id) && id >= 0 && id < 65535))];
}

function getNpcPossibleAnimations(npcId, file = NPC_ANIMATION_FILES.possible) {
  let cached = [];
  try {
    cached = getNpcCachedAnimations(CacheDefinitions.getNpc(npcId));
  } catch {
    // The cache is not available in offline tooling; use the collected fallback.
  }
  const source = JSON.parse(fs.readFileSync(file, "utf8"));
  const possible = source?.[String(npcId)];
  const observed = Array.isArray(possible)
    ? possible.filter((id) => Number.isInteger(id) && id >= 0 && id < 65535)
    : [];
  return [...new Set([...observed, ...cached])];
}

function getNpcIdsWithSamePossibleAnimations(npcId, file = NPC_ANIMATION_FILES.possible) {
  const source = JSON.parse(fs.readFileSync(file, "utf8"));
  const possible = source?.[String(npcId)];
  if (!Array.isArray(possible)) {
    return [npcId];
  }
  return Object.entries(source)
    .filter(([id, candidate]) =>
      Number.isInteger(Number(id)) &&
      Array.isArray(candidate) &&
      candidate.length === possible.length &&
      candidate.every((animationId, index) => animationId === possible[index])
    )
    .map(([id]) => Number(id));
}

function writeNpcCombatAnimations(npcIds, animations, file = NPC_ANIMATION_FILES.combat, name = null) {
  const definitions = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!definitions || typeof definitions !== "object" || !definitions.npcs || typeof definitions.npcs !== "object") {
    throw new Error("Invalid npc-combat-defs.json");
  }

  for (const npcId of Array.isArray(npcIds) ? npcIds : [npcIds]) {
    const key = String(npcId);
    const current = definitions.npcs[key] ?? {};
    const npcName = typeof name === "function" ? name(npcId) : name;
    definitions.npcs[key] = {
      ...current,
      name: typeof npcName === "string" && npcName.trim().length > 0 ? npcName : current.name ?? `NPC ${npcId}`,
      anims: { ...(current.anims ?? {}), ...animations },
    };
  }
  fs.writeFileSync(file, `${JSON.stringify(definitions, null, 2)}\n`, "utf8");
}

function applyNpcCombatAnimations(npcIds, animations, definitionForId = (id) => NpcDefinition.definitions.get(id)) {
  const fields = { attack: "attackAnim", block: "defenceAnim", death: "deathAnim", spawn: "spawnAnim" };
  for (const npcId of Array.isArray(npcIds) ? npcIds : [npcIds]) {
    const definition = definitionForId(npcId);
    if (!definition) continue;
    for (const [role, field] of Object.entries(fields)) {
      if (Number.isInteger(animations[role])) definition[field] = animations[role];
    }
  }
}

function normalizeNpcAnimationProperty(value) {
  const property = String(value ?? "").trim();
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(property) ? property : null;
}

function loopNpcAnimation(npc, animationId, key, resetFirst = true) {
  TaskManager.cancelTasks(key);
  npc.performAnimation(resetFirst ? Animation.DEFAULT_RESET_ANIMATION : new Animation(animationId));
  let playNext = resetFirst;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(resetFirst ? 1 : 5, key);
    }

    execute() {
      npc.performAnimation(playNext ? new Animation(animationId) : Animation.DEFAULT_RESET_ANIMATION);
      playNext = !playNext;
      this.setDelay(playNext ? 1 : 5);
    }
  })());
}

function startNpcAnimationQuestionnaire(api, player, npcId, possibleAnimations) {
  let npc = null;
  queueNpcSpawn(player, npcId, 1, (spawned) => {
    npc = spawned;
    // Keep the test dummy passive so it does not attack while animating.
    npc.getDefinition().aggressive = false;
  }, 1);
  if (!npc) {
    player.sendMessage("Unable to spawn that NPC.");
    return;
  }

  const assignments = {};
  const animationLoopKey = {};
  let index = 0;
  const ask = (animationId) => {
    api.sendMultiChatboxPrompt(
      player,
      "Which animation is this?",
      ...NPC_ANIMATION_ROLES.flatMap((role) => [role, () => {
        if (role !== "other") {
          assignments[role] = animationId;
          next();
          return;
        }
        player.setEnteredSyntaxAction({
          execute: (rawInput) => {
            const property = normalizeNpcAnimationProperty(rawInput);
            if (!property) {
              player.sendMessage("Enter a property name using letters, numbers, and underscores.");
              ask(animationId);
              return;
            }
            assignments[property] = animationId;
            next();
          },
        });
        player.getPacketSender().sendEnterInputPrompt("Enter animation property name.");
      }])
    );
  };
  const next = () => {
    if (index >= possibleAnimations.length) {
      TaskManager.cancelTasks(animationLoopKey);
      npc.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
      const matchingNpcIds = getNpcIdsWithSamePossibleAnimations(npcId);
      writeNpcCombatAnimations(
        matchingNpcIds,
        assignments,
        NPC_ANIMATION_FILES.combat,
        (matchingNpcId) => NpcDefinition.forId(matchingNpcId)?.getName?.()
      );
      applyNpcCombatAnimations(matchingNpcIds, assignments);
      player.sendMessage(`Saved animation definitions for ${matchingNpcIds.length} NPC${matchingNpcIds.length === 1 ? "" : "s"} to npc-combat-defs.json.`);
      return;
    }

    const animationId = possibleAnimations[index++];
    loopNpcAnimation(npc, animationId, animationLoopKey);
    player.sendMessage(
      `NPC ${npcId}: animation ${animationId} (${index}/${possibleAnimations.length}).`
    );
    ask(animationId);
  };

  next();
}

function startNpcAnimationScanner(api, player, npcId, possibleAnimations) {
  let npc = null;
  queueNpcSpawn(player, npcId, 1, (spawned) => {
    npc = spawned;
  }, 1);
  if (!npc) {
    player.sendMessage("Unable to spawn that NPC.");
    return;
  }

  const animationLoopKey = {};
  const assignments = {};
  let index = 0;
  const stop = () => {
    TaskManager.cancelTasks(animationLoopKey);
    npc.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  };
  const next = () => {
    if (index >= possibleAnimations.length) {
      save();
      return;
    }

    const animationId = possibleAnimations[index++];
    loopNpcAnimation(npc, animationId, animationLoopKey);
    player.sendMessage(`NPC ${npcId}: compatible animation ${animationId} (${index}/${possibleAnimations.length}).`);
    api.sendMultiChatboxPrompt(
      player,
      "Choose an action for this animation.",
      "Assign", () => assign(animationId),
      "Skip", next,
      "Save & stop", save
    );
  };
  const save = () => {
    stop();
    if (Object.keys(assignments).length === 0) {
      player.sendMessage("No animation assignments saved.");
      return;
    }
    const matchingNpcIds = getNpcIdsWithSamePossibleAnimations(npcId);
    writeNpcCombatAnimations(matchingNpcIds, assignments);
    applyNpcCombatAnimations(matchingNpcIds, assignments);
    player.sendMessage(`Saved ${Object.keys(assignments).join(", ")} animations for ${matchingNpcIds.length} matching NPC${matchingNpcIds.length === 1 ? "" : "s"}.`);
  };
  const assign = (animationId) => {
    api.sendMultiChatboxPrompt(
      player,
      "Which animation role is this?",
      "Attack", () => { assignments.attack = animationId; next(); },
      "Block / defence", () => { assignments.block = animationId; next(); },
      "Death", () => { assignments.death = animationId; next(); },
      "Spawn", () => { assignments.spawn = animationId; next(); }
    );
  };
  next();
}

function resolveSaveFilePathForUsername(username) {
  const persistence = GameConstants.PLAYER_PERSISTENCE;
  if (persistence && typeof persistence.resolveFilePath === "function") {
    return persistence.resolveFilePath(username);
  }
  return null;
}

class UpdateTask extends Task {
  constructor(ticks, fn) {
    super(ticks);
    this.fn = fn;
  }

  execute() {
    this.fn();
    this.stop();
  }
}

let World;
let SkillManager;
let ObjectManager;
let CombatFactory;
let TaskManager;
let RegionManager;
let PlayerPunishment;

module.exports = {
  name: "AdminCommands",
  register(api) {
    World = api.getWorld();
    SkillManager = api.getSkillManager();
    ObjectManager = api.getObjectManager();
    CombatFactory = api.getCombatFactory();
    TaskManager = api.getTaskManager();
    RegionManager = api.getRegionManager();
    PlayerPunishment = api.getPlayerPunishment();
    api.registerCommand("tele", ({ player, parts }) => {
      if (parts.length < 3 || parts.length > 4) {
        player.sendMessage("Usage: ::tele x y [z]");
        return true;
      }
      const x = parseIntArg(parts[1]);
      const y = parseIntArg(parts[2]);
      const z = parts.length === 4 ? parseIntArg(parts[3]) : player.getLocation().getZ();
      if (x === null || y === null || z === null) {
        player.sendMessage("Usage: ::tele x y [z]");
        return true;
      }
      player.moveTo(new Location(x, y, z));
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("coords", ({ player }) => {
      const location = player.getLocation();
      player.sendMessage(`Coords: ${location.getX()}, ${location.getY()}, ${location.getZ()}`);
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("glow", ({ player, raw, parts }) => {
      const presetToken = String(parts[1] ?? "").trim().toLowerCase();
      if (!presetToken) {
        player
          .sendMessage("Usage: ::glow off|blood|gold|toxic|ice|royal|infernal|cycle [1-5] [player]");
        return true;
      }

      if (presetToken === "cycle") {
        cancelGlowCycle(player);
        startGlowCycle(player);
        player.sendMessage("You are now cycling through the killstreak glows every 3 seconds.");
        return true;
      }

      let glowPreset = GLOW_PRESETS[presetToken];
      if (glowPreset === undefined) {
        const parsedPreset = parseIntArg(presetToken);
        if (parsedPreset === null || parsedPreset < 0 || parsedPreset > 6) {
          player.sendMessage("Glow presets: off, blood, gold, toxic, ice, royal, infernal, cycle");
          return true;
        }
        glowPreset = parsedPreset;
      }

      let glowIntensity = 5;
      let target = player;
      const rawTail = commandTail(raw, parts);
      let targetTail = rawTail.substring(presetToken.length).trim();
      if (targetTail.length > 0) {
        const firstTailToken = String(targetTail.split(/\s+/)[0] ?? "").trim();
        const parsedIntensity = parseIntArg(firstTailToken);
        if (parsedIntensity !== null) {
          if (parsedIntensity < 1 || parsedIntensity > 5) {
            player.sendMessage("Glow intensity must be between 1 and 5.");
            return true;
          }
          glowIntensity = parsedIntensity;
          targetTail = targetTail.substring(firstTailToken.length).trim();
        }
      }
      if (targetTail.length > 0) {
        target = resolvePlayerByCommandTail(`glow ${targetTail}`, ["glow"]);
        if (!target) {
          player.sendMessage(`Player ${targetTail} is not online.`);
          return true;
        }
      }

      cancelGlowCycle(target);
      applyGlowState(target, glowPreset, glowIntensity);

      const targetLabel = target === player ? "You" : target.getUsername();
      const presetLabel =
        Object.keys(GLOW_PRESETS).find((key) => GLOW_PRESETS[key] === glowPreset && key !== "none") ??
        String(glowPreset);
      player.sendMessage(
        `${targetLabel} ${
          glowPreset === 0
            ? "no longer have a glow"
            : `now use ${presetLabel} glow at intensity ${glowIntensity}`
        }.`
      );
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("teleto", ({ player, raw, parts }) => {
      const target = resolvePlayerByCommandTail(raw, parts);
      if (!target) {
        player.sendMessage("Usage: ::teleto [playername]");
        return true;
      }
      player.moveTo(target.getLocation().clone());
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("teletome", ({ player, raw, parts }) => {
      const target = resolvePlayerByCommandTail(raw, parts);
      if (!target) {
        player.sendMessage("Usage: ::teletome [playername]");
        return true;
      }
      target.moveTo(player.getLocation().clone());
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("kick", ({ player, raw, parts }) => {
      const target = World.getPlayerByName(commandTail(raw, parts));
      if (target) {
        target.requestLogout();
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("exit", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      const target = World.getPlayerByName(targetName);
      if (!target) {
        player.sendMessage(`Player ${targetName} is not online.`);
        return true;
      }
      if (CombatFactory.inCombat(target)) {
        player.sendMessage(`Player ${targetName} is in combat!`);
        return true;
      }
      target.getPacketSender().sendExit();
      player.sendMessage("Closed other player's client.");
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("copybank", ({ player, raw, parts }) => {
      const target = World.getPlayerByName(commandTail(raw, parts));
      if (!target) {
        return true;
      }
      for (let i = 0; i < Bank.TOTAL_BANK_TABS; i++) {
        player.getBank(i).resetItems();
      }
      for (let i = 0; i < Bank.TOTAL_BANK_TABS; i++) {
        for (const item of target.getBank(i).getValidItems()) {
          player.getBank(i).add(item, false);
        }
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("bank", ({ player }) => {
      player.getBank(player.getCurrentBankTab()).open();
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("runes", ({ player }) => {
      const inventory = player.getInventory();
      let given = 0;
      for (const rune of RUNE_IDS) {
        // Each new rune type needs its own slot; skip the ones that cannot fit
        // instead of letting the container spam "You couldn't hold all those
        // items." once per rune.
        if (!inventory.contains(rune) && inventory.getFreeSlots() <= 0) {
          continue;
        }
        inventory.adds(rune, 1000);
        given++;
      }
      player.sendMessage(
        given === RUNE_IDS.length
          ? "Spawned 1,000 of each rune type."
          : `Spawned ${given}/${RUNE_IDS.length} rune types - free up inventory space for the rest.`
      );
      return true;
    }, PlayerRights.OWNER);

    function registerSpellbookCommand(command, spellbook) {
      api.registerCommand(command, ({ player }) => {
        MagicSpellbook.changeSpellbook(player, spellbook, true);
        return true;
      }, PlayerRights.DEVELOPER);
    }

    registerSpellbookCommand("normal", MagicSpellbook.NORMAL);
    registerSpellbookCommand("lunar", MagicSpellbook.LUNAR);
    registerSpellbookCommand("ancients", MagicSpellbook.ANCIENT);
    registerSpellbookCommand("arceuus", MagicSpellbook.ARCEUUS);

    api.registerCommand("master", ({ player }) => {
      for (const skill of Skill.values()) {
        const level = SkillManager.getMaxAchievingLevel(skill);
        player
          .getSkillManager()
          .setCurrentLevels(skill, level)
          .setMaxLevel(skill, level)
          .setExperience(skill, SkillManager.getExperienceForLevel(level));
      }
      WeaponInterfaceManager.assign(player);
      player.getUpdateFlag().flag(Flag.APPEARANCE);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("reset", ({ player }) => {
      for (const skill of Skill.values()) {
        const level = skill === Skill.HITPOINTS ? 10 : 1;
        player
          .getSkillManager()
          .setCurrentLevels(skill, level)
          .setMaxLevel(skill, level)
          .setExperience(skill, SkillManager.getExperienceForLevel(level));
      }
      WeaponInterfaceManager.assign(player);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("pnpc", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id === null || id < -1 || id > 65535) {
        player.sendMessage("Usage: ::pnpc npc-id (-1 to reset)");
        return true;
      }
      player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
      player.setNpcTransformationId(id);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("items", itemSearchCommand, PlayerRights.ADMINISTRATOR);
    api.registerCommand("npcs", npcSearchCommand, PlayerRights.OWNER);
    api.onPlayerProcess(closeSpawnSearchOnMove);

    api.registerCommand("npc", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      const amount = parts.length >= 3 ? parseIntArg(parts[2]) : 1;
      if (id === null || id < 0 || amount === null || amount < 1) {
        player.sendMessage("Usage: ::npc id [amount]");
        return true;
      }
      const spawned = queueNpcSpawn(player, id, amount);
      player.sendMessage(
        `Queued ${spawned} NPC${spawned === 1 ? "" : "s"} (id=${id}).`
      );
      return true;
    }, PlayerRights.OWNER);

    const npcAnimationCommand = ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id === null || id < 0) {
        player.sendMessage("Usage: ::npcanims npc-id");
        return true;
      }

      let possibleAnimations;
      try {
        possibleAnimations = getNpcPossibleAnimations(id);
      } catch (error) {
        console.error(error);
        player.sendMessage("Unable to read NPC animations.");
        return true;
      }
      if (possibleAnimations.length === 0) {
        player.sendMessage(`No possible animations found for NPC ${id}.`);
        return true;
      }

      try {
        startNpcAnimationQuestionnaire(api, player, id, possibleAnimations);
      } catch (error) {
        console.error(error);
        player.sendMessage("Unable to start NPC animation questionnaire.");
      }
      return true;
    };
    api.registerCommand("npcanim", npcAnimationCommand, PlayerRights.OWNER);
    api.registerCommand("npcanims", npcAnimationCommand, PlayerRights.OWNER);

    api.registerCommand("npcanimscan", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id === null || id < 0) {
        player.sendMessage("Usage: ::npcanimscan npc-id [first-sequence last-sequence]");
        return true;
      }

      try {
        const baseAnimations = getNpcCachedAnimations(CacheDefinitions.getNpc(id));
        const minimumId = parts.length >= 4 ? parseIntArg(parts[2]) : 0;
        const maximumId = parts.length >= 4 ? parseIntArg(parts[3]) : getLastSequenceId();
        if (baseAnimations.length === 0 || minimumId === null || maximumId === null || minimumId < 0 || maximumId < minimumId) {
          player.sendMessage("Use a valid sequence range.");
          return true;
        }
        player.sendMessage(`Scanning cache animations ${minimumId}-${maximumId}...`);
        void findNpcRigAnimations(baseAnimations, minimumId, maximumId)
          .then((possibleAnimations) => {
            if (possibleAnimations.length === 0) {
              player.sendMessage(`No compatible animations found for NPC ${id} in ${minimumId}-${maximumId}.`);
              return;
            }
            startNpcAnimationScanner(api, player, id, possibleAnimations);
          })
          .catch((error) => {
            console.error(error);
            player.sendMessage("Unable to scan cache animation data.");
          });
      } catch (error) {
        console.error(error);
        player.sendMessage("Unable to scan cache animation data.");
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("npcperm", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      let radiusArg = null;
      let facingArg = null;
      if (parts.length >= 3) {
        const maybeRadius = parseIntArg(parts[2]);
        if (maybeRadius !== null) {
          radiusArg = maybeRadius;
          facingArg = parts.length >= 4 ? parts[3] : null;
        } else {
          facingArg = parts[2];
        }
      }
      if (id === null || id < 0) {
        player.sendMessage("Usage: ::npcperm id [radius] [north|south|east|west|0-7]");
        return true;
      }

      if (radiusArg !== null && radiusArg < 0) {
        player.sendMessage("Radius must be 0 or higher.");
        return true;
      }

      const facing = parseFacingArg(facingArg);
      if (facingArg != null && facing == null) {
        player
          .sendMessage("Invalid facing. Use north/south/east/west (or north_east etc) or -1..7.");
        return true;
      }

      const location = player.getLocation();
      const spawnEntry = {
        id,
        x: location.getX(),
        y: location.getY(),
        level: location.getZ(),
        wanderRadius: radiusArg == null ? 0 : radiusArg,
        ...(facing?.id == null || facing.id < 0 ? {} : { direction: facing.id }),
      };

      let file;
      try {
        file = appendPersistentNpcSpawn(spawnEntry);
      } catch (error) {
        console.error(error);
        player.sendMessage("Failed to append persistent npc spawn.");
        return true;
      }

      const spawned = queueNpcSpawn(player, id, 1);
      player.sendMessage(
        `Spawned ${spawned} NPC (id=${id}) and appended to ${file} at ${location.getX()},${location.getY()},${location.getZ()} (radius=${spawnEntry.wanderRadius}, facing=${facing?.label ?? "default"}).`
      );
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("object", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      const type = parts.length >= 3 ? parseIntArg(parts[2]) : 10;
      const face = parts.length >= 4 ? parseIntArg(parts[3]) : 0;
      if (id === null || type === null || face === null) {
        return true;
      }
      const gameObject = new GameObject(id, player.getLocation().clone(), type, face, player.getPrivateArea());
      ObjectManager.register(gameObject, true);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("mypos", ({ player }) => {
      player.sendMessage(player.getLocation().toString());
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("config", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      const state = parseIntArg(parts[2]);
      if (id === null || state === null) {
        return true;
      }
      player.getPacketSender().sendConfig(id, state);
      player.sendMessage("Sent config");
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("spec", ({ player, parts }) => {
      const amount = parts.length > 1 ? parseIntArg(parts[1]) : 100;
      player.setSpecialPercentage(amount ?? 100);
      CombatSpecial.updateBar(player);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("gfx", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id !== null) {
        player.performGraphic(new Graphic(id, 0));
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("sound", ({ player, parts }) => {
      const input = parts[1];
      if (!input) {
        player.sendMessage("Usage: ::sound <id|SOUND_NAME> [volume=1] [delay=0] [loop=1]");
        return true;
      }

      const directId = parseIntArg(input);
      const resolvedSound =
        directId !== null ? Sounds.resolveKnownSound(directId) : Sounds.resolveKnownSound(input);
      const id = resolvedSound ? resolvedSound.getId() : directId;
      if (id === null) {
        player
          .sendMessage("Unknown sound id/name. Example: ::sound 386 or ::sound MAGIC_SHORTBOW_SPECIAL");
        return true;
      }

      const volume = parts.length > 2 ? parseIntArg(parts[2]) : 1;
      const delay = parts.length > 3 ? parseIntArg(parts[3]) : 0;
      const loopType = parts.length > 4 ? parseIntArg(parts[4]) : 1;
      player
        .getPacketSender()
        .sendSoundEffect(
          id,
          Number.isInteger(loopType) ? loopType : 1,
          Number.isInteger(delay) ? delay : 0,
          Number.isInteger(volume) ? volume : 1
        );
      if (resolvedSound) {
        const soundName =
          Object.entries(Sound).find(([, value]) => value === resolvedSound)?.[0] ?? "UNKNOWN";
        player.sendMessage(`Played ${soundName} (${id}).`);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("anim", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id !== null) {
        player.performAnimation(new Animation(id));
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("interface", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id !== null) {
        player.getPacketSender().sendInterface(id);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("chatboxinterface", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id !== null) {
        player.getPacketSender().sendChatboxInterface(id);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("update", ({ player, parts }) => {
      const ticks = parseIntArg(parts[1]);
      if (ticks === null || ticks <= 0) {
        return true;
      }
      Server.setUpdating(true);
      for (const p of World.getPlayers()) {
        if (p) {
          p.getPacketSender().sendSystemUpdate(ticks);
        }
      }
      TaskManager.submit(
        new UpdateTask(ticks, () => {
          for (const p of World.getPlayers()) {
            if (p) {
              p.requestLogout();
            }
          }
          Server.getLogger().info("Update task finished!");
        })
      );
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("area", ({ player }) => {
      if (player.getArea()) {
        player.sendMessage("");
        player.sendMessage(`Area: ${player.getArea().constructor.name}`);
      } else {
        player.sendMessage("No area found for your coordinates.");
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("infhp", ({ player }) => {
      player.setInfiniteHealth(!player.hasInfiniteHealth());
      player.sendMessage(`Invulnerable: ${player.hasInfiniteHealth()}`);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("poisonme", ({ player, parts }) => {
      const typeToken = String(parts?.[1] ?? "super").trim().toLowerCase();
      const poisonSeverity =
        typeToken === "veryweak" || typeToken === "very_weak" || typeToken === "vw"
          ? 6
          : typeToken === "weak" || typeToken === "w"
            ? 11
            : typeToken === "mild" || typeToken === "m"
              ? 20
              : typeToken === "extra" || typeToken === "e"
                ? 25
                : typeToken === "venom" || typeToken === "v"
                  ? 12
                  : 30;

      player.setPoisonDamage(0);
      CombatFactory.poisonEntity(player, poisonSeverity, typeToken === "venom" || typeToken === "v" ? 2 : 1);
      player.sendMessage(`Poison test applied: ${typeToken}.`);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("taskdebug", ({ player }) => {
      player.sendMessage(`Active tasks :${TaskManager.getTaskAmount()}.`);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("noclip", ({ player }) => {
      player.getPacketSender().sendEnableNoclip();
      player.sendMessage("Noclip enabled.");
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("up", ({ player }) => {
      player.moveTo(player.getLocation().clone().setZ(player.getLocation().getZ() + 1));
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("down", ({ player }) => {
      const next = player.getLocation().clone().setZ(player.getLocation().getZ() - 1);
      if (next.getZ() < 0) {
        next.setZ(0);
        player.sendMessage("You cannot move to a negative plane!");
      }
      player.moveTo(next);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("save", ({ player }) => {
      GameConstants.PLAYER_PERSISTENCE.save(player);
      player.sendMessage("Queued player save.");
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("reprocorruptsave", ({ player, raw, parts }) => {
      const requested = commandTail(raw, parts);
      const targetName = requested.length > 0 ? requested : player.getUsername();
      if (!targetName) {
        player.sendMessage("Usage: ::reprocorruptsave [username]");
        return true;
      }

      const corruptTargetSave = (overrideJson = null) => {
        const filePath = resolveSaveFilePathForUsername(targetName);
        if (!filePath) {
          player
            .sendMessage("This command is only available with the legacy file-based save provider.");
          return;
        }
        if (!fs.existsSync(filePath)) {
          player.sendMessage(`No save file found for ${targetName} at ${filePath}.`);
          return;
        }

        const backupPath = `${filePath}.repro.bak.${Date.now()}`;
        const original = fs.readFileSync(filePath, "utf8");
        if (original.length < 4) {
          player.sendMessage(`Save file is too small to corrupt safely: ${filePath}`);
          return;
        }

        fs.writeFileSync(backupPath, original, "utf8");
        const sourceJson = overrideJson ?? original;
        const partialLength = Math.max(1, Math.floor(sourceJson.length * 0.45));
        const partialJson = sourceJson.slice(0, partialLength);
        // Simulate legacy non-atomic truncate+partial write interruption.
        const fd = fs.openSync(filePath, "w");
        try {
          fs.writeFileSync(fd, partialJson, "utf8");
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }

        ServerLogger.info(
          `[admin] reprocorruptsave target=${targetName} mode=partial_non_atomic file=${filePath} backup=${backupPath} bytes=${partialLength}/${sourceJson.length}`
        );

        player.sendMessage(
          `Simulated interrupted save for ${targetName}. Backup: ${backupPath}`
        );
        player.sendMessage(
          "Relog target to reproduce persistence_load_failed from partial JSON."
        );
      };

      const onlineTarget = World.getPlayerByName(targetName);
      if (onlineTarget) {
        const serializedLiveSave = JSON.stringify(PlayerSave.fromPlayer(onlineTarget), null, 2);
        player.sendMessage(
          `Forcing ${targetName} logout, then simulating interrupted non-atomic save write...`
        );
        onlineTarget.requestLogout();
        TaskManager.submit(
          new UpdateTask(2, () => {
            if (World.getPlayerByName(targetName)) {
              player.sendMessage(
                `Target ${targetName} is still online. Run ::reprocorruptsave again in a moment.`
              );
              return;
            }
            corruptTargetSave(serializedLiveSave);
          })
        );
        return true;
      }

      corruptTargetSave();
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("saveall", ({ player }) => {
      World.savePlayers();
      player.sendMessage("Queued save for all players.");
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("cwar", ({ player, parts }) => {
      const x = parseIntArg(parts[1]);
      const y = parseIntArg(parts[2]);
      if (x === null || y === null) {
        return true;
      }
      player.getPacketSender().sendInterface(11169);
      player.getPacketSender().sendInterfaceComponentMoval(x, y, 11332);
      player.sendMessage(`Sending RedX to X=${x}, Y=${y}`);
      return true;
    }, PlayerRights.DEVELOPER);

    api.registerCommand("listsizes", ({ player }) => {
      player.sendMessage(
        `Players: ${Array.from(World.getPlayers()).length}, NPCs: ${World.getNpcs().sizeReturn()}, Objects: ${World.getObjects().length}, GroundItems: ${World.getItems().length}.`
      );
      return true;
    }, PlayerRights.OWNER);

    const attackRangeFn = ({ player, parts }) => {
      const distance = parts.length === 2 ? parseIntArg(parts[1]) : CombatFactory.getMethod(player).attackDistance(player);
      if (distance === null) {
        return true;
      }
      const playerLocation = player.getLocation().clone();
      const start = player.getLocation().clone().translate(-(distance + 5), -(distance + 5), 0);
      const end = player.getLocation().clone().translate(distance + 5, distance + 5, 0);
      const deltas = new Set();

      for (let x = start.getX(); x <= end.getX(); x++) {
        for (let y = start.getY(); y <= end.getY(); y++) {
          const tile = new Location(x, y);
          if (tile.getDistance(playerLocation) !== distance) {
            continue;
          }
          deltas.add(Location.delta(playerLocation, tile));
          player.getPacketSender().sendGraphic(ATTACK_RANGE_DEBUG_GRAPHIC, tile);
        }
      }

      if (devOnly(player)) {
        console.log(`Deltas for distance of ${distance}:`);
        console.log(deltas);
      }
      return true;
    };

    api.registerCommand("atkrange", attackRangeFn, PlayerRights.OWNER);
    api.registerCommand("attackrange", attackRangeFn, PlayerRights.OWNER);

    api.registerCommand("item", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      const amount = parts.length > 2 ? parseIntArg(parts[2]) : 1;
      if (id === null || amount === null || id < 0 || amount <= 0) {
        player.sendMessage("Usage: ::item id [amount]");
        return true;
      }
      const cappedAmount = Math.min(amount, Number.MAX_SAFE_INTEGER);
      player.getInventory().adds(id, cappedAmount);
      player.sendMessage(`Spawned item ${id} x${cappedAmount}.`);
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("clearinv", ({ player }) => {
      player.getInventory().resetItems().refreshItems();
      player.sendMessage("Your inventory has been cleared.");
      return true;
    }, PlayerRights.ADMINISTRATOR);

    api.registerCommand("unlockprayers", ({ player, parts }) => {
      const type = parseIntArg(parts[1]);
      if (type === 0) {
        player.setPreserveUnlocked(true);
      } else if (type === 1) {
        player.setRigourUnlocked(true);
      } else if (type === 2) {
        player.setAuguryUnlocked(true);
      }
      player.getPacketSender().sendConfig(709, player.isPreserveUnlocked() ? 1 : 0);
      player.getPacketSender().sendConfig(711, player.isRigourUnlocked() ? 1 : 0);
      player.getPacketSender().sendConfig(713, player.getAuguryUnlocked() ? 1 : 0);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("gesell", ({ player, parts }) => {
      const id = parseIntArg(parts[1]);
      if (id === null) {
        return true;
      }
      const def = ItemDefinition.forId(id);
      player
        .getPacketSender()
        .sendItemOnInterfaces(24780, id, 1)
        .sendString(def.getName(), 24769)
        .sendString(def.getExamine(), 24770);
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("flood", ({ player, parts }) => {
      const amount = parseIntArg(parts[1]);
      if (amount !== null) {
        Server.getFlooder().login(amount);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("reloadpunishments", ({ player }) => {
      PlayerPunishment.init();
      player.sendMessage("Reloaded");
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("reloadshops", ({ player }) => {
      try {
        const loaded = new ShopDefinitionLoader().load();
        const shopCount = ShopManager.reload();
        if (loaded === false) {
          player.sendMessage(
            "Some plugin shop definition sources failed to reload."
          );
        }
        player.sendMessage(`Reloaded shops (${shopCount}).`);
      } catch (error) {
        console.error(error);
        player.sendMessage("Error reloading shops.");
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("shop", ({ player, parts }) => {
      const shopId = parseIntArg(parts[1]);
      if (shopId === null || shopId < 0) {
        player.sendMessage("Usage: ::shop [id]");
        return true;
      }
      if (!ShopManager.open(player, shopId)) {
        player.sendMessage(`Shop ${shopId} does not exist.`);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("reloadnpcspawns", ({ player }) => {
      try {
        const loader = new NpcSpawnDefinitionLoader();
        const loaded = loader.load();
        if (loaded === false) {
          player.sendMessage("Error reloading npc spawns.");
          return true;
        }

        const source = DefinitionLoader.getSourceNames(
          NpcSpawnDefinitionLoader.DEFINITION_TYPE
        ).join("+") || "none";
        player.sendMessage(`Reloaded npc spawns from: ${source}.`);
      } catch (error) {
        console.error(error);
        player.sendMessage("Error reloading npc spawns.");
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("reloadnpcdefs", ({ player }) => {
      player.sendMessage("Reloaded npc defs.");
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("logstatus", ({ player }) => {
      const levels = ServerLogger.getEnabledLevels().join(",") || "(none)";
      const enabledTypes = ServerLogger.getEnabledTypes().join(",") || "(none)";
      const disabledTypes = ServerLogger.getDisabledTypes().join(",") || "(none)";
      player.sendMessage(`Log levels: ${levels}`);
      player.sendMessage(`Enabled types: ${enabledTypes}`);
      player.sendMessage(`Disabled types: ${disabledTypes}`);
      return true;
    }, PlayerRights.DEVELOPER);

    api.registerCommand("loglevels", ({ player, parts }) => {
      const values = parseCsvArgs(parts, 1);
      if (values.length === 0) {
        player.sendMessage("Usage: ::loglevels debug,info,warn,error");
        return true;
      }
      const valid = values.filter((value) =>
        value === "debug" || value === "info" || value === "warn" || value === "error"
      );
      ServerLogger.setEnabledLevels(valid);
      player.sendMessage(`Updated log levels: ${valid.join(",") || "(none)"}`);
      return true;
    }, PlayerRights.DEVELOPER);

    api.registerCommand("logtypeon", ({ player, parts }) => {
      const values = parseCsvArgs(parts, 1);
      if (values.length === 0) {
        player.sendMessage("Usage: ::logtypeon plugin,packet.out,world");
        return true;
      }
      const merged = new Set([...(ServerLogger.getEnabledTypes() || []), ...values]);
      ServerLogger.setEnabledTypes(Array.from(merged));
      player.sendMessage(`Enabled log types: ${Array.from(merged).join(",")}`);
      return true;
    }, PlayerRights.DEVELOPER);

    api.registerCommand("logtypeoff", ({ player, parts }) => {
      const values = parseCsvArgs(parts, 1);
      if (values.length === 0) {
        player.sendMessage("Usage: ::logtypeoff plugin,packet.out,world");
        return true;
      }
      const merged = new Set([...(ServerLogger.getDisabledTypes() || []), ...values]);
      ServerLogger.setDisabledTypes(Array.from(merged));
      player.sendMessage(`Disabled log types: ${Array.from(merged).join(",")}`);
      return true;
    }, PlayerRights.DEVELOPER);

    api.registerCommand("logtypeclear", ({ player, parts }) => {
      const mode = String(parts[1] || "all").toLowerCase();
      if (mode === "enabled" || mode === "all") {
        ServerLogger.setEnabledTypes([]);
      }
      if (mode === "disabled" || mode === "all") {
        ServerLogger.setDisabledTypes([]);
      }
      player.sendMessage(
        `Cleared log type filters (${mode}). Enabled: ${ServerLogger.getEnabledTypes().join(",") || "(none)"} Disabled: ${ServerLogger.getDisabledTypes().join(",") || "(none)"}`
      );
      return true;
    }, PlayerRights.DEVELOPER);

    api.registerCommand("reloaditems", ({ player }) => {
      player.sendMessage("Reloaded item defs");
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("mute", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      const target = World.getPlayerByName(targetName);
      if (!GameConstants.PLAYER_PERSISTENCE.exists(targetName) && !target) {
        player.sendMessage(`Player ${targetName} does not exist.`);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("unmute", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      const target = World.getPlayerByName(targetName);
      if (!GameConstants.PLAYER_PERSISTENCE.exists(targetName) && !target) {
        player.sendMessage(`Player ${targetName} does not exist.`);
        return true;
      }
      if (!PlayerPunishment.muted(targetName)) {
        player.sendMessage(`Player ${targetName} does not have an active mute.`);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("ipmute", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      const target = World.getPlayerByName(targetName);
      if (!target) {
        player.sendMessage(`Player ${targetName} is not online.`);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("unipmute", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      const target = World.getPlayerByName(targetName);
      if (!target) {
        player.sendMessage(`Player ${targetName} is not online.`);
        return true;
      }
      if (CombatFactory.inCombat(target)) {
        player.sendMessage(`Player ${targetName} is in combat!`);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("ban", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      const target = World.getPlayerByName(targetName);
      if (!GameConstants.PLAYER_PERSISTENCE.exists(targetName) && !target) {
        player.sendMessage(`Player ${targetName} is not a valid online player.`);
        return true;
      }
      if (PlayerPunishment.banned(targetName)) {
        player.sendMessage(`Player ${targetName} already has an active ban.`);
        if (target) {
          target.requestLogout();
        }
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("unban", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      if (!GameConstants.PLAYER_PERSISTENCE.exists(targetName)) {
        player.sendMessage(`Player ${targetName} is not online.`);
        return true;
      }
      if (!PlayerPunishment.banned(targetName)) {
        player.sendMessage(`Player ${targetName} is not banned!`);
      }
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("ipban", ({ player, raw, parts }) => {
      const targetName = commandTail(raw, parts);
      const target = World.getPlayerByName(targetName);
      if (!target) {
        player.sendMessage(`Player ${targetName} is not online.`);
      }
      return true;
    }, PlayerRights.OWNER);

    if (!Server.PRODUCTION) {
      api.registerCommand("t", ({ player }) => {
        console.log(RegionManager.wallsExist(player.getLocation().clone(), player.getPrivateArea()));
        return true;
      }, PlayerRights.DEVELOPER);
    }

    // Legacy no-op command stubs from previous command package.
    api.registerCommand("barrage", ({ player }) => {
      return true;
    }, PlayerRights.OWNER);

    api.registerCommand("dialogue", ({ player }) => {
      return true;
    }, PlayerRights.OWNER);
  },
  _test: {
    itemSearchCommand,
    npcSearchCommand,
    closeSpawnSearchOnMove,
    getNpcPossibleAnimations,
    getNpcCachedAnimations,
    getNpcIdsWithSamePossibleAnimations,
    normalizeNpcAnimationProperty,
    writeNpcCombatAnimations,
    applyNpcCombatAnimations,
  },
};
