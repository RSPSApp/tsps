/**
 * Finds items, NPCs, objects (locs), animations (sequences) and graphics (spot animations) in the
 * local OSRS cache by id or name, and writes their files into server/data/models/<folder>/, with a
 * README of what each file is. The files are raw cache bytes, as the Blender add-ons read them:
 * models (index 7) for io_osrs_dat; an animation's sequence (config 12), frames (index 0) and frame
 * maps (index 1) for io_osrs_anim; a graphic's definition (config 13), model and animation for
 * io_osrs_gfx. Animations and graphics are named by their gameval names (`human_ready`).
 * Used by the Model Extractor page (server.cjs), and by its tests.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Animations } = require("./animations.cjs");

const KINDS = ["item", "npc", "object", "animation", "graphic"];
/** Config archives in the configs index. */
const SEQ_ARCHIVE = 12;
const SPOTANIM_ARCHIVE = 13;
/** A client cycle is 20 ms; animation frame lengths count them. */
const CYCLE_MS = 20;
/** Sequence hand items are item id + 512; 0 empties the hand, -1 leaves it. */
const HAND_ITEM_OFFSET = 512;
/** Equipment slots by wear position (the cache's wearPos, wearPos2 and wearPos3). */
const SLOTS = ["head", "cape", "neck", "weapon", "body", "shield", "arms", "legs", "hair", "hands", "feet", "jaw", "ring", "ammo"];
const slotName = (slot) => SLOTS[slot] ?? `slot ${slot}`;
/** A cache name without its colour and image tags: "<col=00ffff>Ornate dummy</col>" is "Ornate dummy". */
const plainName = (name) => String(name ?? "").replace(/<[^>]*>/g, "").trim();
const SEARCH_LIMIT = 200;
const FOLDER = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A model file's format, from its last two bytes: v3 (FF FD), v2 (FF FE) or the old format. */
function modelInfo(bytes) {
  const end = bytes.length;
  const tail = end >= 2 ? (bytes[end - 2] << 8) | bytes[end - 1] : 0;
  const format = tail === 0xfffd ? "v3" : tail === 0xfffe ? "v2" : "old";
  // The header sits at the end: 26 bytes (v3), 23 (v2) or 18 (old); it starts with the counts.
  const header = end - (format === "v3" ? 26 : format === "v2" ? 23 : 18);
  if (header < 0) return { format, bytes: end };
  return { format, bytes: end, vertices: (bytes[header] << 8) | bytes[header + 1], faces: (bytes[header + 2] << 8) | bytes[header + 3] };
}

function slug(name) {
  return String(name).toLowerCase().replace(/<[^>]*>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

const list = (values) => (Array.isArray(values) ? [...values] : []);
const present = (id) => Number.isInteger(id) && id >= 0;
/** Words as a search sees them: lower case, underscores as spaces ("human_ready" is "human ready"). */
const words = (text) => String(text ?? "").toLowerCase().replace(/_/g, " ");

/** Cache file data as a Buffer: index data comes as signed bytes from some readers. */
function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (ArrayBuffer.isView(data)) return Buffer.from(Uint8Array.from(data, (value) => value & 0xff));
  return Buffer.from(Array.from(data, (value) => value & 0xff));
}

/**
 * Each model of an entry, as the file it is written to: `{ file, model, role }`. Names follow the
 * folders made so far: drop.dat, equip.dat (male), equip-female.dat, chathead.dat; an NPC's
 * body.dat and chathead.dat, or body/<model>.dat when it has several parts; an object's model.dat,
 * or model-<model>.dat for several.
 */
function filesOf(kind, definition) {
  const files = [];
  const add = (file, model, role) => {
    if (present(model) && !files.some((entry) => entry.file === file)) files.push({ file, model, role, source: { type: "model", id: model } });
  };
  if (kind === "item") {
    add("drop.dat", definition.model, "Inventory and ground model");
    add("equip.dat", definition.maleModel, "Worn, male");
    add("equip1.dat", definition.maleModel1, "Worn, male (second part)");
    add("equip2.dat", definition.maleModel2, "Worn, male (third part)");
    add("equip-female.dat", definition.femaleModel, "Worn, female");
    add("equip-female1.dat", definition.femaleModel1, "Worn, female (second part)");
    add("equip-female2.dat", definition.femaleModel2, "Worn, female (third part)");
    if (definition.maleHeadModel === definition.femaleHeadModel) add("chathead.dat", definition.maleHeadModel, "Chathead, both sexes");
    else {
      add("chathead.dat", definition.maleHeadModel, "Chathead, male");
      add("chathead-female.dat", definition.femaleHeadModel, "Chathead, female");
    }
  } else if (kind === "npc") {
    const body = list(definition.modelIds).filter(present);
    const heads = list(definition.chatheadModelIds).filter(present);
    if (body.length === 1) add("body.dat", body[0], "Body");
    else body.forEach((model, index) => add(`body/${model}.dat`, model, `Body part ${index + 1} (merged in game)`));
    if (heads.length === 1) add("chathead.dat", heads[0], "Chathead");
    else heads.forEach((model, index) => add(`chathead/${model}.dat`, model, `Chathead part ${index + 1}`));
  } else {
    const models = list(definition.models).flatMap((group, index) =>
      list(group).filter(present).map((model) => ({ model, shape: definition.types?.[index] ?? null })));
    const unique = models.filter((entry, index) => models.findIndex((other) => other.model === entry.model) === index);
    for (const { model, shape } of unique) {
      add(unique.length === 1 ? "model.dat" : `model-${model}.dat`, model, shape === null ? "Model" : `Model (shape ${shape})`);
    }
  }
  return files;
}

/** The cache, opened once from the server directory (needs `yarn build`'s dist/). */
class ModelExtractor {
  constructor(serverDir) {
    this.serverDir = path.resolve(serverDir);
    this.modelsDir = path.join(this.serverDir, "data", "models");
    this.indexes = new Map();
  }

  async open() {
    const dist = path.join(this.serverDir, "dist");
    if (!fs.existsSync(path.join(dist, "Server.js"))) throw new Error("The server isn't built: run `yarn build` in server/ first.");
    require(path.join(dist, "Server")).Server.installProductionPathResolver();
    const { CachePipeline } = require(path.join(dist, "game/cache/CachePipeline"));
    await CachePipeline.initialize(this.serverDir);
    this.cache = require(path.join(dist, "game/cache/CacheDefinitions")).CacheDefinitions;
    const { CacheIndexDat2 } = require(path.join(dist, "game/cache/codec/rs/cache/CacheIndex"));
    this.openIndexes(CacheIndexDat2, CachePipeline.getStore());
    return this;
  }

  /**
   * Uses a cache the running server already loaded (the cache editor's plugin `core`), instead of
   * opening a second copy: no CachePipeline start, and the server's NPC definitions are already read.
   */
  static attach(core, serverDir) {
    const extractor = new ModelExtractor(serverDir);
    extractor.cache = core.CacheDefinitions;
    extractor.core = core;
    extractor.attached = true;
    extractor.openIndexes(core.CacheIndexDat2, core.CachePipeline.getStore());
    return extractor;
  }

  openIndexes(CacheIndexDat2, store) {
    // server/dist, wherever the files are written (a test extracts into a temporary folder).
    const { IndexType } = require(path.join(__dirname, "../../dist/game/cache/codec/rs/cache/IndexType"));
    this.models = CacheIndexDat2.fromStore(IndexType.DAT2.models, store);
    this.configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);
    this.frames = CacheIndexDat2.fromStore(IndexType.DAT2.animations, store);
    this.framemaps = CacheIndexDat2.fromStore(IndexType.DAT2.skeletons, store);
    // Skeletal animations' keyframes (rev 229+); without them those animations don't play.
    try {
      this.keyframes = CacheIndexDat2.fromStore(IndexType.OSRS.animKeyFrames, store);
    } catch {
      this.keyframes = null;
    }
    this.animations = new Animations(this);
  }

  definition(kind, id) {
    try {
      if (kind === "item") return this.cache.getItem(id);
      if (kind === "npc") return this.cache.getNpc(id);
      if (kind === "object") return this.cache.getObject(id);
      // Their loaders answer an unknown id with a default definition, so check the archive first.
      if (kind === "animation") return this.cache.hasDefinition("seq", id) ? this.cache.getSeq(id) : null;
      if (kind === "graphic") return this.cache.hasDefinition("spotanim", id) ? this.cache.getSpotanim(id) : null;
    } catch {
      return null;
    }
    throw new Error(`Unknown kind ${kind}`);
  }

  count(kind) {
    const counts = this.cache.getBaseCounts();
    if (kind === "animation") return counts.seqs;
    if (kind === "graphic") return this.cache.getSpotanimCount();
    return kind === "item" ? counts.items : kind === "npc" ? counts.npcs : counts.objects;
  }

  symbol(kind, id) {
    const names = {
      item: () => this.cache.getObjNames(), npc: () => this.cache.getNpcNames(), object: () => this.cache.getLocNames(),
      animation: () => this.cache.getSeqNames(), graphic: () => this.cache.getSpotanimNames(),
    }[kind]?.();
    return names?.get?.(id) ?? null;
  }

  /**
   * Every named entry of a kind that has something to extract: `{ id, name, symbol, tag }`, built on
   * first use. Animations and graphics have no display name, so their gameval name is the name.
   */
  index(kind) {
    if (this.indexes.has(kind)) return this.indexes.get(kind);
    const rows = [];
    for (let id = 0; id < this.count(kind); id++) {
      const definition = this.definition(kind, id);
      if (!definition) continue;
      if (kind === "animation" || kind === "graphic") {
        const name = this.symbol(kind, id) ?? `${kind} ${id}`;
        const tag = kind === "animation" && definition.skeletalId >= 0 ? "skeletal" : null;
        rows.push({ id, name, symbol: null, tag });
        continue;
      }
      const name = plainName(definition.name);
      if (!name || name === "null") continue;
      if (filesOf(kind, definition).length === 0) continue;
      let tag = null;
      if (kind === "item" && definition.noteTemplate >= 0) tag = "noted";
      else if (kind === "item" && definition.placeholderTemplate >= 0) tag = "placeholder";
      rows.push({ id, name, symbol: this.symbol(kind, id), tag });
    }
    this.indexes.set(kind, rows);
    return rows;
  }

  /**
   * An id ("4151") or words ("abyssal whip"): entries whose name or gameval name holds every word.
   * Exact names first, then names that start with the query, then the rest, each by id.
   */
  search(kind, query, { includeVariants = false } = {}) {
    if (!KINDS.includes(kind)) throw new Error(`Unknown kind ${kind}`);
    const text = String(query ?? "").trim().toLowerCase();
    if (!text) return [];
    if (/^\d+$/.test(text)) {
      const id = Number(text);
      const row = this.index(kind).find((entry) => entry.id === id);
      return row ? [row] : [];
    }
    const wanted = words(text).trim();
    const terms = wanted.split(/\s+/);
    const rank = (row) => {
      const name = words(row.name);
      return name === wanted ? 0 : name.startsWith(wanted) ? 1 : 2;
    };
    // Noted items and placeholders only when asked; skeletal animations are always listed.
    const variant = (row) => row.tag === "noted" || row.tag === "placeholder";
    return this.index(kind)
      .filter((row) => includeVariants || !variant(row))
      .filter((row) => {
        const haystack = words(`${row.name} ${row.symbol ?? ""}`);
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => rank(a) - rank(b) || a.id - b.id)
      .slice(0, SEARCH_LIMIT);
  }

  modelBytes(model) {
    try {
      return toBuffer(this.models.getFileSmart(model)?.data);
    } catch {
      return null;
    }
  }

  /** A file entry's bytes, by its source: a model, a config file, an animation frame or a frame map. */
  bytesOf(source) {
    try {
      if (source.type === "model") return this.modelBytes(source.id);
      if (source.type === "config") return toBuffer(this.configs.getFile(source.archive, source.id)?.data);
      if (source.type === "frame") return toBuffer(this.frames.getFile(source.group, source.file)?.data);
      if (source.type === "framemap") return toBuffer(this.framemaps.getFile(source.id, 0)?.data);
    } catch {
      return null;
    }
    return null;
  }

  /**
   * An animation's files, under `prefix`: seq.dat, its frames (frames/<group>-<file>.dat) and the
   * frame maps they use (framemap-<id>.dat), as io_osrs_anim reads them. A skeletal animation keeps
   * its keyframes elsewhere, so it has only seq.dat.
   */
  animationFiles(id, sequence, prefix = "") {
    const files = [{ file: `${prefix}seq.dat`, role: "Sequence definition (config 12)", source: { type: "config", archive: SEQ_ARCHIVE, id } }];
    if (sequence.skeletalId >= 0) return { files, framemaps: [] };
    const framemaps = [];
    list(sequence.frameIds).forEach((frameId, index) => {
      const group = Math.floor(frameId / 65536), file = frameId & 0xffff;
      const name = `${prefix}frames/${group}-${file}.dat`;
      // A sequence can show the same frame more than once; its file is written once.
      if (files.some((entry) => entry.file === name)) return;
      const source = { type: "frame", group, file };
      files.push({ file: name, role: `Frame ${index + 1}`, source, group: `${prefix}frames/` });
      const bytes = this.bytesOf(source);
      const framemap = bytes && bytes.length >= 2 ? (bytes[0] << 8) | bytes[1] : null;
      if (framemap !== null && !framemaps.includes(framemap)) framemaps.push(framemap);
    });
    for (const framemap of framemaps) {
      files.push({ file: `${prefix}framemap-${framemap}.dat`, role: `Frame map (skeleton) ${framemap}`, source: { type: "framemap", id: framemap } });
    }
    return { files, framemaps };
  }

  /** "Abyssal whip (4151)" for a sequence hand value (item id + 512), or what the value does. */
  handItem(value) {
    if (!(value >= 0)) return null;
    if (value === 0) return "nothing (emptied)";
    const id = value - HAND_ITEM_OFFSET;
    let name = null;
    try {
      name = plainName(this.cache.getItem(id)?.name);
    } catch {
      name = null;
    }
    return name && name !== "null" ? `${name} (item ${id})` : `item ${id}`;
  }

  animationNotes(sequence, framemaps) {
    const notes = [];
    if (sequence.skeletalId >= 0) {
      notes.push(`Skeletal animation (skeleton ${sequence.skeletalId}): its keyframes are in another archive, which io_osrs_anim can't read`);
      return notes;
    }
    const cycles = list(sequence.frameLengths).reduce((sum, length) => sum + length, 0);
    notes.push(`${list(sequence.frameIds).length} frames, ${cycles} client cycles (${((cycles * CYCLE_MS) / 1000).toFixed(2)} s) per play`);
    if (framemaps.length) notes.push(`Frame map${framemaps.length > 1 ? "s" : ""} ${framemaps.join(", ")}${framemaps.includes(0) ? " (0 is the player skeleton)" : ""}`);
    const right = this.handItem(sequence.rightHandItem), left = this.handItem(sequence.leftHandItem);
    if (right) notes.push(`Right hand shows ${right} while it plays`);
    if (left) notes.push(`Left hand shows ${left} while it plays`);
    if (sequence.frameStep > 0) notes.push(`Loops back ${sequence.frameStep} frame${sequence.frameStep === 1 ? "" : "s"} when it ends, up to ${sequence.maxLoops} times`);
    return notes;
  }

  /** What extracting would write, with each file's format and size, and the colour changes. */
  details(kind, id) {
    const definition = this.definition(kind, id);
    if (!definition) throw new Error(`No ${kind} ${id} in the cache`);
    if (kind === "animation" || kind === "graphic") return this.motionDetails(kind, id, definition);
    const files = filesOf(kind, definition).map((entry) => this.describe(entry));
    const notes = [];
    const recolours = list(definition.recolorFrom).map((from, index) => [from, definition.recolorTo?.[index]]);
    const retextures = list(definition.retextureFrom).map((from, index) => [from, definition.retextureTo?.[index]]);
    if (kind === "item") {
      if (definition.wearPos >= 0) {
        const hidden = [definition.wearPos2, definition.wearPos3].filter((slot) => slot >= 0).map(slotName);
        notes.push(`Worn in the ${slotName(definition.wearPos)} slot${hidden.length ? `; hides the ${hidden.join(" and ")}` : ""}`);
      }
      else notes.push("Not wearable");
      if (definition.maleOffset || definition.femaleOffset) notes.push(`Wear offsets: male ${definition.maleOffset}, female ${definition.femaleOffset} (not in the model files)`);
      const resize = [definition.resizeX, definition.resizeY, definition.resizeZ];
      if (resize.some((value) => value !== 128)) notes.push(`Resized ${resize.join("/")} (128 is normal)`);
      if (definition.noteTemplate >= 0) notes.push("This is the noted item; its model is the note's");
      if (definition.placeholderTemplate >= 0) notes.push("This is a bank placeholder; its model is the placeholder's");
    } else if (kind === "npc") {
      if (definition.widthScale !== 128 || definition.heightScale !== 128) notes.push(`Scaled ${definition.widthScale} wide, ${definition.heightScale} high (128 is normal)`);
      if (definition.size > 1) notes.push(`Size ${definition.size} tiles`);
      if (list(definition.transforms).some((value) => value >= 0)) notes.push("Changes into other NPCs (transforms); this is only its base look");
    } else {
      const scale = [definition.modelSizeX, definition.modelSizeHeight, definition.modelSizeY];
      if (scale.some((value) => value !== 128)) notes.push(`Scaled ${scale.join("/")} (x/height/y, 128 is normal)`);
      if (definition.offsetX || definition.offsetHeight || definition.offsetY) notes.push(`Offset ${definition.offsetX}/${definition.offsetHeight}/${definition.offsetY}`);
      if (list(definition.transforms).some((value) => value >= 0)) notes.push("Changes into other objects (transforms); this is only its base look");
    }
    if (recolours.length) notes.push("Recoloured in game: the files have the original colours (see Recolours)");
    if (retextures.length) notes.push("Retextured in game: the files have the original textures");
    return {
      kind, id, name: plainName(definition.name), symbol: this.symbol(kind, id),
      folder: slug(definition.name) || `${kind}-${id}`, files, recolours, retextures, notes,
    };
  }

  /** A file entry with its size, and a model's format and counts; `missing` when the cache lacks it. */
  describe(entry) {
    const bytes = this.bytesOf(entry.source);
    if (!bytes) return { ...entry, missing: true };
    return entry.source.type === "model" ? { ...entry, ...modelInfo(bytes) } : { ...entry, bytes: bytes.length };
  }

  /** The info.json io_osrs_anim reads for an animation's name (as extract-anim-gfx.cjs wrote it). */
  animationInfo(id, sequence, framemaps) {
    return {
      seq: id, name: this.symbol("animation", id), frames: list(sequence.frameIds).length,
      frameLengths: list(sequence.frameLengths), framemaps,
      leftHand: sequence.leftHandItem >= 0 ? sequence.leftHandItem : undefined,
      rightHand: sequence.rightHandItem >= 0 ? sequence.rightHandItem : undefined,
    };
  }

  /**
   * An animation's or a graphic's files and notes (graphics: spotanim.dat, model.dat and anim/),
   * with the info.json files the Blender add-ons read for names (`infos`).
   */
  motionDetails(kind, id, definition) {
    const name = this.symbol(kind, id) ?? `${kind} ${id}`;
    const notes = [];
    const infos = [];
    let files;
    let recolours = [];
    let retextures = [];
    if (kind === "animation") {
      const { files: animation, framemaps } = this.animationFiles(id, definition);
      files = animation;
      notes.push(...this.animationNotes(definition, framemaps));
      infos.push({ file: "info.json", data: this.animationInfo(id, definition, framemaps) });
    } else {
      files = [{ file: "spotanim.dat", role: "Graphic definition (config 13)", source: { type: "config", archive: SPOTANIM_ARCHIVE, id } }];
      if (present(definition.modelId)) files.push({ file: "model.dat", model: definition.modelId, role: "Model", source: { type: "model", id: definition.modelId } });
      let seqName = null;
      if (present(definition.animationId) && this.cache.hasDefinition("seq", definition.animationId)) {
        const sequence = this.cache.getSeq(definition.animationId);
        const { files: animation, framemaps } = this.animationFiles(definition.animationId, sequence, "anim/");
        files.push(...animation);
        seqName = this.symbol("animation", definition.animationId);
        notes.push(`Plays animation ${definition.animationId}${seqName ? ` (${seqName})` : ""}, saved in anim/`);
        notes.push(...this.animationNotes(sequence, framemaps).map((note) => `Animation: ${note}`));
        if (sequence.skeletalId < 0) infos.push({ file: "anim/info.json", data: this.animationInfo(definition.animationId, sequence, framemaps) });
      } else notes.push("No animation: the model shows still");
      infos.unshift({ file: "info.json", data: { spotanim: id, model: present(definition.modelId) ? definition.modelId : -1, seq: present(definition.animationId) ? definition.animationId : -1, seqName } });
      if (definition.resizeX !== 128 || definition.resizeY !== 128) notes.push(`Resized ${definition.resizeX} wide, ${definition.resizeY} high (128 is normal)`);
      if (definition.rotation) notes.push(`Rotated ${definition.rotation} (2048 is a full turn)`);
      recolours = list(definition.recolorFrom).map((from, index) => [from, definition.recolorTo?.[index]]);
      retextures = list(definition.retextureFrom).map((from, index) => [from, definition.retextureTo?.[index]]);
      if (recolours.length) notes.push("Recoloured in game: model.dat has the original colours (see Recolours)");
      if (retextures.length) notes.push("Retextured in game: model.dat has the original textures");
    }
    const skeletal = kind === "animation" && definition.skeletalId >= 0;
    return {
      kind, id, name, symbol: null, folder: slug(name) || `${kind}-${id}`,
      files: files.map((entry) => this.describe(entry)), recolours, retextures, notes, infos,
      // A graphic's own animation, which its preview plays.
      ...(kind === "graphic" ? { animation: present(definition.animationId) && this.cache.hasDefinition("seq", definition.animationId) ? definition.animationId : -1 } : {}),
      ...(skeletal ? { unsupported: "Skeletal animations can't be extracted: their keyframes are in another archive, which io_osrs_anim can't read" } : {}),
    };
  }

  folderPath(folder) {
    if (!FOLDER.test(String(folder))) throw new Error("A folder name is lower-case letters, digits and dashes (up to 64)");
    return path.join(this.modelsDir, folder);
  }

  /** Writes the files and a README into data/models/<folder>/; an existing folder needs `overwrite`. */
  extract(kind, id, folder, { overwrite = false } = {}) {
    const info = this.details(kind, id);
    if (info.unsupported) throw new Error(info.unsupported);
    const directory = this.folderPath(folder);
    if (fs.existsSync(directory) && !overwrite) {
      const error = new Error(`data/models/${folder} already exists`);
      error.code = "EXISTS";
      throw error;
    }
    const written = [];
    for (const entry of info.files) {
      const bytes = this.bytesOf(entry.source);
      if (!bytes) continue;
      const file = path.join(directory, ...entry.file.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      written.push(entry.file);
    }
    if (written.length === 0) throw new Error(`None of ${info.name}'s files are in the cache`);
    for (const { file, data } of info.infos ?? []) {
      const target = path.join(directory, ...file.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
      written.push(file);
    }
    fs.writeFileSync(path.join(directory, "README.md"), readme(info, this.cacheName()));
    return { folder, directory, written: [...written, "README.md"], details: info };
  }

  /** The cache the server loads, as CachePipeline picks it (server/target.txt). */
  cacheName() {
    try {
      return fs.readFileSync(path.join(this.serverDir, "target.txt"), "utf8").trim() || null;
    } catch {
      return null;
    }
  }
}

const KIND_NAMES = { item: "item", npc: "NPC", object: "object", animation: "animation", graphic: "graphic" };

/** A file's format column: a model's format and counts, otherwise its size. */
function formatOf(entry) {
  if (entry.missing) return "not in the cache";
  if (entry.format) return `${entry.format}, ${entry.vertices ?? "?"} vertices, ${entry.faces ?? "?"} faces`;
  return `${entry.bytes} bytes`;
}

/**
 * The files as table rows, with an animation's frames as one row ("frames/ (15 files)"): the
 * folder itself lists them, and a table of 50 frames says nothing more.
 */
function fileRows(files) {
  const rows = [];
  for (const entry of files) {
    if (!entry.group) {
      rows.push({ file: entry.file, model: entry.model ?? null, role: entry.role, format: formatOf(entry) });
      continue;
    }
    const row = rows.find((other) => other.group === entry.group);
    if (row) {
      row.count++;
      row.bytes += entry.bytes ?? 0;
      row.file = `${entry.group} (${row.count} files)`;
      row.format = `${row.bytes} bytes`;
    } else rows.push({ group: entry.group, count: 1, bytes: entry.bytes ?? 0, file: `${entry.group} (1 file)`, model: null, role: "Animation frames", format: `${entry.bytes ?? 0} bytes` });
  }
  return rows;
}

function readme(info, cache) {
  const lines = [
    `# ${info.name} (${KIND_NAMES[info.kind]} ${info.id})`,
    "",
    `Extracted from the local OSRS cache${cache ? ` (\`${cache}\`)` : ""} with the Model Extractor (\`yarn models\` in server/).`,
    info.symbol ? `Cache name: \`${info.symbol}\`.` : null,
    "",
    "| File | Model | What | Format |",
    "| --- | --- | --- | --- |",
    ...fileRows(info.files).map((row) => `| \`${row.file}\` | ${row.model ?? ""} | ${row.role} | ${row.format} |`),
    "",
    ...info.notes.map((note) => `- ${note}`),
  ];
  if (info.recolours.length) {
    lines.push("", "## Recolours", "", "| From | To |", "| --- | --- |", ...info.recolours.map(([from, to]) => `| ${from} | ${to} |`));
  }
  if (info.retextures.length) {
    lines.push("", "## Retextures", "", "| From | To |", "| --- | --- |", ...info.retextures.map(([from, to]) => `| ${from} | ${to} |`));
  }
  return `${lines.filter((line) => line !== null).join("\n")}\n`;
}

module.exports = { ModelExtractor, KINDS, filesOf, fileRows, modelInfo, slug, readme };
