/**
 * The page's model decoder and animator: the game client's own code (client/rs/model: ModelData
 * decodes every model format and lights it, Model and its frames and skeletal keyframes animate
 * it), bundled for the browser with the client's esbuild when the Model Extractor starts.
 * The bundle defines `OsrsModel`: `decode(bytes)` returns a decoded model's arrays; `buildBody`,
 * `loadAnimation` and `pose` light a body and pose it on an animation's frames, as the client does.
 */
const path = require("node:path");

// Resolved from the client directory, so "./rs/model/ModelData" is the client's decoder.
const ENTRY = `
import { ModelData } from "./rs/model/ModelData";
import { Model } from "./rs/model/Model";
import { Dat2SeqBase, SeqBase } from "./rs/model/seq/SeqBase";
import { Dat2SeqFrame, SeqFrame } from "./rs/model/seq/SeqFrame";
import { SkeletalSeq } from "./rs/model/skeletal/SkeletalSeq";
import {
    PLAYER_BODY_RECOLOR_FROM_1, PLAYER_BODY_RECOLOR_FROM_2, PLAYER_BODY_RECOLOR_TO_1, PLAYER_BODY_RECOLOR_TO_2,
} from "./rs/config/player/PlayerDesignColors";

const CACHE_INFO: any = { name: "model-extractor", game: "oldschool", environment: "live", revision: 242, timestamp: "", size: 0 };
/** Textures aren't loaded: textured faces light with their base colour. */
const TEXTURES: any = { isSd: () => false };
const bytesOf = (base64: string) => {
    const text = atob(base64);
    const bytes = new Int8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
};

/**
 * A body as /api/body describes it, merged and lit as the client builds an NPC (NpcModelLoader),
 * the default player (PlayerModelLoader, body colours 0) or a graphic.
 */
export function buildBody(body: any): Model {
    const parts = body.parts.map((part: any) => {
        const data = ModelData.decode(bytesOf(part.bytes));
        for (const [from, to] of part.recolours ?? []) data.recolor(from, to);
        for (const [from, to] of part.retextures ?? []) data.retexture(from, to);
        return data;
    });
    const merged = ModelData.merge(parts, parts.length);
    for (const [from, to] of body.recolours ?? []) merged.recolor(from, to);
    for (const [from, to] of body.retextures ?? []) merged.retexture(from, to);
    if (body.playerColours) {
        for (let c = 0; c < 5; c++) {
            if (PLAYER_BODY_RECOLOR_TO_1[c]?.length) merged.recolor(PLAYER_BODY_RECOLOR_FROM_1[c] & 0xffff, PLAYER_BODY_RECOLOR_TO_1[c][0] & 0xffff);
            if (PLAYER_BODY_RECOLOR_TO_2[c]?.length) merged.recolor(PLAYER_BODY_RECOLOR_FROM_2[c] & 0xffff, PLAYER_BODY_RECOLOR_TO_2[c][0] & 0xffff);
        }
    }
    return merged.light(TEXTURES, body.ambient, body.contrast, -30, -50, -30);
}

/** An animation as /api/animation sends it: its frames (or skeletal keyframes) decoded. */
export function loadAnimation(data: any) {
    const bases = new Map<number, SeqBase | undefined>();
    const baseLoader: any = {
        load(id: number) {
            if (!bases.has(id)) bases.set(id, data.framemaps[id] ? Dat2SeqBase.load(CACHE_INFO, id, bytesOf(data.framemaps[id])) : undefined);
            return bases.get(id);
        },
        clearCache() {},
    };
    if (data.skeletalId >= 0) {
        const duration = Math.max(1, (data.skeletalEnd - data.skeletalStart) | 0);
        return { skeletal: SkeletalSeq.load(baseLoader, data.skeletalId, bytesOf(data.keyframes)), frames: [] as SeqFrame[], lengths: new Array(duration).fill(1), op14: false };
    }
    const decoded = new Map<number, SeqFrame>();
    const frames = data.frameIds.map((id: number) => {
        if (!decoded.has(id)) decoded.set(id, Dat2SeqFrame.load(CACHE_INFO, baseLoader, bytesOf(data.frames[id])));
        return decoded.get(id)!;
    });
    return { skeletal: null as SkeletalSeq | null, frames, lengths: data.frameLengths.map((length: number) => Math.max(1, length)), op14: !!data.op14 };
}

/** A copy of the lit body in frame <index> of the animation, scaled as the body is (128 = 1). */
export function pose(body: Model, animation: any, index: number, scale?: number[]): Model {
    const model = Model.copyAnimated(body, false, true);
    if (animation?.skeletal) model.animateSkeletal(animation.skeletal, index);
    else if (animation?.frames.length) model.animate(animation.frames[index % animation.frames.length], undefined, animation.op14);
    if (scale && scale.some((value) => value !== 128)) model.scale(scale[0], scale[1], scale[2]);
    return model;
}
export function decode(bytes: Uint8Array) {
    const model = ModelData.decode(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return {
        vertexCount: model.verticesCount,
        faceCount: model.faceCount,
        x: model.verticesX, y: model.verticesY, z: model.verticesZ,
        a: model.indices1, b: model.indices2, c: model.indices3,
        colors: model.faceColors,
        alphas: model.faceAlphas ?? null,
        textures: model.faceTextures ?? null,
        renderTypes: model.faceRenderTypes ?? null,
    };
}
`;

/** `{ code }`, or `{ error }` when the client or its esbuild isn't there. */
function buildDecoder(repoRoot) {
  const clientDir = path.join(repoRoot, "client");
  try {
    const esbuild = require(require.resolve("esbuild", { paths: [clientDir, repoRoot] }));
    const result = esbuild.buildSync({
      stdin: { contents: ENTRY, resolveDir: clientDir, loader: "ts", sourcefile: "model-extractor-decoder.ts" },
      bundle: true,
      format: "iife",
      globalName: "OsrsModel",
      platform: "browser",
      target: "es2020",
      minify: true,
      write: false,
      logLevel: "silent",
    });
    return { code: result.outputFiles[0].text };
  } catch (error) {
    const message = error?.errors?.[0]?.text ?? error?.message ?? String(error);
    return { error: `The preview's model decoder couldn't be built from client/ (${message}). Run yarn install in client/.` };
  }
}

module.exports = { buildDecoder };
