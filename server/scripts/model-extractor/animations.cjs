/**
 * The Model Extractor's animation links: which animations an NPC plays, which bodies an animation
 * plays on, and the bytes the page needs to play one (models, frames, frame maps, keyframes).
 *
 * The cache only links an NPC to its movement animations (stand, walk, turn, run, crawl). Attack,
 * block, death and spawn animations are the server's (NpcDefinition, as the game plays them). An
 * animation names no NPC, but every animation moves one skeleton (its frame map): the frames' first
 * u16, or for a skeletal animation the base after its keyframes' version byte. An animation fits
 * any model built for that skeleton, so the skeleton links the rest.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MOVEMENT = [
  ["idleSeqId", "Stand"], ["turnLeftSeqId", "Turn left"], ["turnRightSeqId", "Turn right"],
  ["walkSeqId", "Walk"], ["walkBackSeqId", "Walk back"], ["walkLeftSeqId", "Walk left"], ["walkRightSeqId", "Walk right"],
  ["runSeqId", "Run"], ["runBackSeqId", "Run back"], ["runLeftSeqId", "Run left"], ["runRightSeqId", "Run right"],
  ["crawlSeqId", "Crawl"], ["crawlBackSeqId", "Crawl back"], ["crawlLeftSeqId", "Crawl left"], ["crawlRightSeqId", "Crawl right"],
];
/** The player's stand animation: its skeleton is the player skeleton. */
const PLAYER_STAND = "human_ready";
const PLAYER_STAND_ID = 808;
/** At most this many other animations of an NPC's skeleton are listed. */
const RELATED_LIMIT = 400;
/** At most this many bodies are offered for an animation. */
const BODY_LIMIT = 12;
const IDK_ARCHIVE = 3;

const list = (values) => (Array.isArray(values) ? [...values] : []);
const present = (id) => Number.isInteger(id) && id >= 0;
const plainName = (name) => String(name ?? "").replace(/<[^>]*>/g, "").trim();
const named = (name) => name && name !== "null";
const pairs = (from, to) => list(from).map((value, index) => [value & 0xffff, (to?.[index] ?? value) & 0xffff]);
const base64 = (bytes) => Buffer.from(bytes).toString("base64");
const firstWord = (name) => String(name ?? "").split("_")[0];

/** An identity kit (config archive 3): its body part, whether players can pick it, models and recolours. */
function decodeKit(bytes) {
  const kit = { bodyPart: -1, selectable: true, models: [], recolours: [], retextures: [] };
  let offset = 0;
  const u8 = () => bytes[offset++];
  const u16 = () => ((bytes[offset++] << 8) | bytes[offset++]) >>> 0;
  const i32 = () => ((bytes[offset++] << 24) | (bytes[offset++] << 16) | (bytes[offset++] << 8) | bytes[offset++]);
  while (offset < bytes.length) {
    const opcode = u8();
    if (opcode === 0) break;
    if (opcode === 1) kit.bodyPart = u8();
    else if (opcode === 2) { const count = u8(); kit.models = Array.from({ length: count }, u16); }
    else if (opcode === 3) kit.selectable = false;
    else if (opcode === 5) { const count = u8(); kit.models = Array.from({ length: count }, i32); }
    else if (opcode === 40) { const count = u8(); kit.recolours = Array.from({ length: count }, () => [u16(), u16()]); }
    else if (opcode === 41) { const count = u8(); kit.retextures = Array.from({ length: count }, () => [u16(), u16()]); }
    else if (opcode >= 60 && opcode < 70) u16();
    else if (opcode >= 70 && opcode < 80) i32();
    else break;
  }
  return kit;
}

class Animations {
  constructor(extractor) {
    this.x = extractor;
    this.cache = extractor.cache;
    this.skeletons = new Map();
    this.groupSkeletons = new Map();
    this.savedPath = path.join(os.tmpdir(), `tsps-model-extractor-skeletons-${String(extractor.cacheName()).replace(/[^\w.-]+/g, "_")}.json`);
    try {
      for (const [seq, skeleton] of JSON.parse(fs.readFileSync(this.savedPath, "utf8"))) this.skeletons.set(seq, skeleton);
    } catch {
      // Not indexed yet: warm() does it.
    }
  }

  /**
   * Reads every animation's skeleton, a few at a time so the page stays responsive, and saves them
   * for the next start. A skeletal animation's skeleton is in its keyframes, a large archive each
   * (about 20 s for all of them), so the first start takes a while; later starts read the file.
   */
  warm() {
    if (!this.warming) {
      this.warming = (async () => {
        const rows = this.x.index("animation");
        const known = rows.every(({ id }) => this.skeletons.has(id));
        for (let index = 0; index < rows.length; index++) {
          this.skeletonOf(rows[index].id);
          if (index % 20 === 19) await new Promise((resolve) => setImmediate(resolve));
        }
        if (!known) {
          try {
            fs.writeFileSync(this.savedPath, JSON.stringify([...this.skeletons]));
          } catch {
            // Only a speed-up.
          }
        }
        this.combat();
        this.players();
        this.npcsBySkeleton();
        this.warmed = true;
      })();
    }
    return this.warming;
  }

  sequence(id) {
    return present(id) ? this.x.definition("animation", id) : null;
  }

  name(id) {
    return this.x.symbol("animation", id) ?? `animation ${id}`;
  }

  keyframeBytes(skeletalId) {
    try {
      const data = this.x.keyframes?.getFile(Math.floor(skeletalId / 65536), skeletalId & 0xffff)?.data;
      return data ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
    } catch {
      return null;
    }
  }

  /** The skeleton (frame map id) an animation moves, or null when the cache doesn't say. */
  skeletonOf(id) {
    if (this.skeletons.has(id)) return this.skeletons.get(id);
    // A custom animation (the cache editor's assets) has its frames outside the cache.
    const custom = this.x.customSkeleton?.(id);
    if (Number.isInteger(custom)) return custom;
    const sequence = this.sequence(id);
    let skeleton = null;
    if (sequence?.skeletalId >= 0) {
      const bytes = this.keyframeBytes(sequence.skeletalId);
      if (bytes && bytes.length >= 3) skeleton = (bytes[1] << 8) | bytes[2];
    } else if (sequence) {
      const first = list(sequence.frameIds)[0];
      if (first !== undefined) {
        // Every frame of a group is made for the same frame map; read the group once.
        const group = Math.floor(first / 65536);
        if (!this.groupSkeletons.has(group)) {
          const bytes = this.x.bytesOf({ type: "frame", group, file: first & 0xffff });
          this.groupSkeletons.set(group, bytes && bytes.length >= 2 ? (bytes[0] << 8) | bytes[1] : null);
        }
        skeleton = this.groupSkeletons.get(group);
      }
    }
    this.skeletons.set(id, skeleton);
    return skeleton;
  }

  playerSkeleton() {
    if (this.player === undefined) {
      const id = this.cache.getSeqId?.(PLAYER_STAND) ?? PLAYER_STAND_ID;
      this.player = this.skeletonOf(id);
    }
    return this.player;
  }

  /** Skeleton -> its animations' ids, over every animation (built on first use). */
  bySkeleton() {
    if (!this.skeletonIndex) {
      this.skeletonIndex = new Map();
      for (const { id } of this.x.index("animation")) {
        const skeleton = this.skeletonOf(id);
        if (skeleton === null) continue;
        if (!this.skeletonIndex.has(skeleton)) this.skeletonIndex.set(skeleton, []);
        this.skeletonIndex.get(skeleton).push(id);
      }
    }
    return this.skeletonIndex;
  }

  /** The server's NPC definitions (attack, block, death and spawn animations), or null without them. */
  combat() {
    if (this.combatDefinitions === undefined) {
      // Inside the running server (the cache editor), its own loaded definitions: requiring dist here
      // could load a second, empty copy when the server runs from source.
      if (this.x.core?.NpcDefinition) return (this.combatDefinitions = this.x.core.NpcDefinition);
      try {
        const dist = path.join(this.x.serverDir, "dist");
        const { NpcDefinitionLoader } = require(path.join(dist, "game/definition/loader/impl/NpcDefinitionLoader"));
        const { NpcDefinition } = require(path.join(dist, "game/definition/NpcDefinition"));
        // Inside the running server (the cache editor) they are already loaded.
        if (!this.x.attached) new NpcDefinitionLoader().load();
        this.combatDefinitions = NpcDefinition;
      } catch {
        this.combatDefinitions = null;
      }
    }
    return this.combatDefinitions;
  }

  /** [animation id, role, source] for every animation an NPC plays: the cache's, then the server's. */
  usedBy(id, npc = this.x.definition("npc", id)) {
    const used = [];
    if (!npc) return used;
    for (const [field, role] of MOVEMENT) if (present(npc[field])) used.push([npc[field], role, "cache"]);
    const definition = this.combat()?.forId(id);
    if (definition?.isAttackable?.()) {
      used.push([definition.getAttackAnim(), "Attack", "server"], [definition.getDefenceAnim(), "Block", "server"], [definition.getDeathAnim(), "Death", "server"]);
    }
    const spawn = definition?.getSpawnAnim?.();
    if (present(spawn)) used.push([spawn, "Spawn", "server"]);
    return used.filter(([seq]) => present(seq) && this.sequence(seq));
  }

  /** The NPC's own skeleton: its stand animation's, else its walk's, else any of its animations'. */
  npcSkeleton(npc, used) {
    for (const seq of [npc.idleSeqId, npc.walkSeqId, ...used.map(([seq]) => seq)]) {
      const skeleton = present(seq) ? this.skeletonOf(seq) : null;
      if (skeleton !== null) return skeleton;
    }
    return null;
  }

  row(seq, extra = {}) {
    return { id: seq, name: this.name(seq), skeletal: this.sequence(seq)?.skeletalId >= 0, ...extra };
  }

  /**
   * An NPC's animations: the ones it plays (`used`, with their roles and whether each fits its
   * skeleton), then the others made for its skeleton (`related`), creature's own name first.
   */
  npcAnimations(id) {
    const npc = this.x.definition("npc", id);
    if (!npc) throw new Error(`No npc ${id} in the cache`);
    const used = this.usedBy(id, npc);
    const skeleton = this.npcSkeleton(npc, used);
    const rows = new Map();
    for (const [seq, role, source] of used) {
      if (!rows.has(seq)) rows.set(seq, this.row(seq, { roles: [], sources: [], fits: skeleton === null || this.skeletonOf(seq) === skeleton }));
      const row = rows.get(seq);
      if (!row.roles.includes(role)) row.roles.push(role);
      if (!row.sources.includes(source)) row.sources.push(source);
    }
    const player = skeleton !== null && skeleton === this.playerSkeleton();
    let related = [];
    let relatedTotal = 0;
    if (skeleton !== null && !player) {
      const family = firstWord(this.x.symbol("animation", npc.idleSeqId) ?? "");
      const others = (this.bySkeleton().get(skeleton) ?? []).filter((seq) => !rows.has(seq));
      relatedTotal = others.length;
      related = others
        .map((seq) => this.row(seq))
        .sort((a, b) => (firstWord(b.name) === family) - (firstWord(a.name) === family) || a.name.localeCompare(b.name) || a.id - b.id)
        .slice(0, RELATED_LIMIT);
    }
    return { id, skeleton, playerSkeleton: player, used: [...rows.values()], related, relatedTotal };
  }

  /** Animation id -> [npc id, role] for every NPC that plays it (built on first use). */
  players() {
    if (!this.usersIndex) {
      this.usersIndex = new Map();
      for (const { id } of this.x.index("npc")) {
        for (const [seq, role] of this.usedBy(id)) {
          if (!this.usersIndex.has(seq)) this.usersIndex.set(seq, []);
          this.usersIndex.get(seq).push([id, role]);
        }
      }
    }
    return this.usersIndex;
  }

  /** Skeleton -> NPC ids whose own skeleton it is (built on first use, from their stand animations). */
  npcsBySkeleton() {
    if (!this.npcSkeletonIndex) {
      this.npcSkeletonIndex = new Map();
      for (const { id } of this.x.index("npc")) {
        const npc = this.x.definition("npc", id);
        const skeleton = npc ? this.npcSkeleton(npc, []) : null;
        if (skeleton === null) continue;
        if (!this.npcSkeletonIndex.has(skeleton)) this.npcSkeletonIndex.set(skeleton, []);
        this.npcSkeletonIndex.get(skeleton).push(id);
      }
    }
    return this.npcSkeletonIndex;
  }

  /** One body per look: NPCs that share a name and models (the many "Man"s) are offered once. */
  npcBody(id, why) {
    const npc = this.x.definition("npc", id);
    if (!npc || !list(npc.modelIds).length) return null;
    const name = plainName(npc.name);
    return { kind: "npc", id, name: named(name) ? name : `NPC ${id}`, why, look: `${name}|${list(npc.modelIds).join(",")}|${list(npc.recolorTo).join(",")}` };
  }

  /**
   * The bodies an animation can be previewed on: the player first for one made for the player
   * skeleton, NPCs that play it, then NPCs built on its skeleton (those named like it first).
   */
  animationBodies(id) {
    const sequence = this.sequence(id);
    if (!sequence) throw new Error(`No animation ${id} in the cache`);
    const skeleton = this.skeletonOf(id);
    const bodies = [];
    const looks = new Set();
    const add = (body) => {
      if (!body || bodies.length >= BODY_LIMIT || looks.has(body.look)) return;
      looks.add(body.look);
      const { look, ...shown } = body;
      bodies.push(shown);
    };
    const player = skeleton !== null && skeleton === this.playerSkeleton();
    if (player) bodies.push({ kind: "player", id: 0, name: "Player", why: "the player skeleton" });
    // An NPC that plays it with another skeleton (a human default death on a dragon) can't show it.
    for (const [npc, role] of this.players().get(id) ?? []) {
      const own = this.x.definition("npc", npc);
      if (skeleton !== null && own && this.npcSkeleton(own, []) !== null && this.npcSkeleton(own, []) !== skeleton) continue;
      add(this.npcBody(npc, `plays it (${role})`));
    }
    if (!player && skeleton !== null) {
      const family = firstWord(this.name(id));
      const candidates = (this.npcsBySkeleton().get(skeleton) ?? []).map((npc) => ({ npc, same: firstWord(this.x.symbol("animation", this.x.definition("npc", npc)?.idleSeqId) ?? "") === family }));
      candidates.sort((a, b) => b.same - a.same || a.npc - b.npc);
      for (const { npc } of candidates) add(this.npcBody(npc, "the same skeleton"));
    }
    return { id, skeleton, playerSkeleton: player, bodies };
  }

  /** Identity kits, decoded from config archive 3 (the server's loader skips their models). */
  kits() {
    if (!this.kitList) {
      this.kitList = [];
      const ids = this.x.configs.getFileIds(IDK_ARCHIVE) ?? [];
      for (const id of ids) {
        const bytes = this.x.bytesOf({ type: "config", archive: IDK_ARCHIVE, id });
        if (bytes) this.kitList.push({ id, ...decodeKit(bytes) });
      }
    }
    return this.kitList;
  }

  /** The default male player: the first selectable kit of each body part 0-6, as the client picks them. */
  playerKits() {
    const kits = [];
    for (let part = 0; part <= 6; part++) {
      const kit = this.kits().find((entry) => entry.selectable && entry.bodyPart === part && entry.models.length);
      if (kit) kits.push(kit);
    }
    return kits;
  }

  modelPart(model, recolours = [], retextures = []) {
    const bytes = this.x.modelBytes(model);
    return bytes ? { model, bytes: base64(bytes), recolours, retextures } : null;
  }

  /**
   * A body for the page to light and animate: its models (base64) with their own recolours, the
   * recolours of the whole, lighting and scale, as the client builds an NPC, player or graphic.
   */
  body(kind, id) {
    if (kind === "player") {
      const kits = this.playerKits();
      const parts = kits.flatMap((kit) => kit.models.map((model) => this.modelPart(model, kit.recolours, kit.retextures))).filter(Boolean);
      return { kind, id: 0, name: "Player", kits: kits.map((kit) => kit.id), parts, recolours: [], retextures: [], playerColours: true, ambient: 64, contrast: 850, scale: [128, 128, 128] };
    }
    if (kind === "npc") {
      const npc = this.x.definition("npc", id);
      if (!npc) throw new Error(`No npc ${id} in the cache`);
      return {
        kind, id, name: plainName(npc.name), parts: list(npc.modelIds).map((model) => this.modelPart(model)).filter(Boolean),
        recolours: pairs(npc.recolorFrom, npc.recolorTo), retextures: pairs(npc.retextureFrom, npc.retextureTo), playerColours: false,
        ambient: (npc.ambient ?? 0) + 64, contrast: (npc.contrast ?? 0) * 5 + 850, scale: [npc.widthScale ?? 128, npc.heightScale ?? 128, npc.widthScale ?? 128],
      };
    }
    if (kind === "graphic") {
      const graphic = this.x.definition("graphic", id);
      if (!graphic) throw new Error(`No graphic ${id} in the cache`);
      return {
        kind, id, name: this.x.symbol("graphic", id) ?? `graphic ${id}`, parts: [this.modelPart(graphic.modelId)].filter(Boolean),
        recolours: pairs(graphic.recolorFrom, graphic.recolorTo), retextures: pairs(graphic.retextureFrom, graphic.retextureTo), playerColours: false,
        ambient: (graphic.ambient ?? 0) + 64, contrast: (graphic.contrast ?? 0) + 850, scale: [graphic.resizeX ?? 128, graphic.resizeY ?? 128, graphic.resizeX ?? 128],
        animation: present(graphic.animationId) && this.sequence(graphic.animationId) ? graphic.animationId : -1,
      };
    }
    throw Object.assign(new Error("kind must be npc, player or graphic"), { status: 400 });
  }

  /** What the page needs to play an animation: timings, and its frames, frame maps or keyframes (base64). */
  animation(id) {
    const sequence = this.sequence(id);
    if (!sequence) throw new Error(`No animation ${id} in the cache`);
    const framemaps = {};
    const addFramemap = (skeleton) => {
      if (skeleton === null || framemaps[skeleton]) return;
      const bytes = this.x.bytesOf({ type: "framemap", id: skeleton });
      if (bytes) framemaps[skeleton] = base64(bytes);
    };
    const result = {
      id, name: this.name(id), skeleton: this.skeletonOf(id), op14: !!sequence.op14,
      frameIds: list(sequence.frameIds), frameLengths: list(sequence.frameLengths), frames: {}, framemaps,
      skeletalId: sequence.skeletalId, skeletalStart: sequence.skeletalStart ?? 0, skeletalEnd: sequence.skeletalEnd ?? 0, keyframes: null,
    };
    if (sequence.skeletalId >= 0) {
      const bytes = this.keyframeBytes(sequence.skeletalId);
      if (!bytes) throw new Error(`Animation ${id}'s keyframes aren't in the cache`);
      result.keyframes = base64(bytes);
      addFramemap(result.skeleton);
      return result;
    }
    for (const frameId of result.frameIds) {
      if (result.frames[frameId]) continue;
      const bytes = this.x.bytesOf({ type: "frame", group: Math.floor(frameId / 65536), file: frameId & 0xffff });
      if (!bytes) throw new Error(`Frame ${frameId} of animation ${id} isn't in the cache`);
      result.frames[frameId] = base64(bytes);
      if (bytes.length >= 2) addFramemap((bytes[0] << 8) | bytes[1]);
    }
    return result;
  }
}

module.exports = { Animations, decodeKit, MOVEMENT };
