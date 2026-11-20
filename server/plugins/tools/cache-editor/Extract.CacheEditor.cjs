"use strict";

// The Model Extractor inside the cache editor: what extracting a definition would write, writing it
// into data/models/<folder>/ for the Blender add-ons, an NPC's animations, and the bodies an
// animation can be previewed on. It runs on the cache the server already loaded
// (ModelExtractor.attach), so nothing is opened twice, and it is reached only through the loopback
// authoring service: indexing every animation's skeleton takes a while the first time, and writing
// files is a local development choice.

const { ModelExtractor, fileRows } = require("../../../scripts/model-extractor/ModelExtractor.cjs");
const Assets = require("./Assets.CacheEditor.cjs");

/** The editor's definition kinds, as the extractor names them. */
const KINDS = { item: "item", npc: "npc", loc: "object", seq: "animation", spotanim: "graphic" };
/** How many bodies an animation offers; the extractor's own limit. */
const BODY_LIMIT = 12;

const error = (message, status = 400) => Object.assign(new Error(message), { status });

function createExtract(core, root) {
  let extractor = null;
  const assetOf = (kind, id) => Assets.assetsOf(root).find((row) => row.kind === kind && row.id === id);

  function get() {
    if (!extractor) {
      extractor = ModelExtractor.attach(core, root);
      // A custom animation's frames aren't in the cache's archive; its asset row names its skeleton.
      extractor.customSkeleton = (id) => assetOf("animation", id)?.framemaps?.[0];
    }
    return extractor;
  }

  function kindOf(kind) {
    const mapped = KINDS[kind];
    if (!mapped) throw error(`A ${kind} has nothing to extract; only ${Object.keys(KINDS).join(", ")} do`);
    return mapped;
  }

  const idOf = (value) => {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 0) throw error("id must be a non-negative integer");
    return id;
  };

  /** A custom animation or graphic is an asset: it is exported from the Assets tab, not extracted. */
  function customOf(kind, id) {
    const assetKind = kind === "seq" ? "animation" : kind === "spotanim" ? "graphic" : null;
    return assetKind ? assetOf(assetKind, id) : undefined;
  }

  return {
    KINDS,
    details(kind, rawId) {
      const id = idOf(rawId);
      const mapped = kindOf(kind);
      const custom = customOf(kind, id);
      if (custom) {
        return { kind, id, name: custom.name, custom: { kind: custom.kind, id: custom.id }, rows: [], notes: [], recolours: [], retextures: [],
          unsupported: `This is your ${custom.kind} asset ${custom.name}: export it to data/models from the Assets tab` };
      }
      const info = get().details(mapped, id);
      return { ...info, kind, rows: fileRows(info.files), files: undefined, infos: undefined };
    },

    extract(kind, rawId, folder, overwrite) {
      const id = idOf(rawId);
      if (customOf(kind, id)) throw error("Custom animations and graphics are exported from the Assets tab");
      try {
        const result = get().extract(kindOf(kind), id, folder, { overwrite: overwrite === true });
        return { folder: result.folder, written: result.written };
      } catch (failure) {
        if (failure.code === "EXISTS") throw Object.assign(error(failure.message, 409), { code: "EXISTS" });
        throw failure.status ? failure : error(failure.message);
      }
    },

    /** The animations an NPC plays and the others made for its skeleton. */
    async npcAnimations(rawId) {
      const x = get();
      await x.animations.warm();
      return x.animations.npcAnimations(idOf(rawId));
    },

    /**
     * NPC bodies to preview an animation on. The editor draws with the client's NPC model builder, so
     * an animation made for the player skeleton is shown on the NPCs built on it (the many "Man"s).
     */
    async bodies(rawId) {
      const x = get();
      await x.animations.warm();
      const id = idOf(rawId);
      const found = x.animations.animationBodies(id);
      const bodies = found.bodies.filter((body) => body.kind === "npc");
      if (found.playerSkeleton) {
        const looks = new Set();
        // People first: NPCs that stand like a player (human_ready), then the rest built on its skeleton.
        const stand = x.cache.getSeqId?.("human_ready") ?? 808;
        const people = (x.animations.npcsBySkeleton().get(found.skeleton) ?? [])
          .map((npc) => ({ npc, person: x.definition("npc", npc)?.idleSeqId === stand }))
          .sort((a, b) => b.person - a.person || a.npc - b.npc)
          .map(({ npc }) => npc);
        for (const npc of people) {
          if (bodies.length >= BODY_LIMIT) break;
          const body = x.animations.npcBody(npc, "the player skeleton");
          if (!body || looks.has(body.look) || bodies.some((entry) => entry.id === npc)) continue;
          looks.add(body.look);
          const { look, ...shown } = body;
          bodies.push(shown);
        }
      }
      return { id, skeleton: found.skeleton, playerSkeleton: found.playerSkeleton, bodies };
    },
  };
}

module.exports = { createExtract, KINDS };
