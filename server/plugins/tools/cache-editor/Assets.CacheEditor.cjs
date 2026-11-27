"use strict";

// Uploaded assets: the meshes, sprites, textures, animations and graphics this project adds on top of
// the cache.
//
// The cache has no "category" field on an id — the *index* is the category (7 models, 8 sprites,
// 9 textures), and an id is only meaningful inside one of them. Each asset kind therefore gets its
// own id range, so `{ kind, id }` is the identity and two kinds can never collide. Animations and
// graphics are sequence and spot animation ids, above the cache's.
//
// Files live under `server/data/assets/<kind>/`: a model is `<sha256>.dat`, an animation or a graphic
// a folder `<sha256>/` of the files the Blender add-ons export. Both are content-addressed, so the
// same upload twice is one file and one row, and the row keeps the name a human gave it. A graphic's
// model and its own animation are stored as a model and an animation asset, and its row points at
// them. Nothing here is the cache: plugins/world/CustomAnimations loads the animations and graphics
// at the next start, and the catalog ships the models.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { deflateSync } = require("node:zlib");
const Document = require("./Document.CacheEditor.cjs");
const Files = require("../../world/CustomAnimationFiles.cjs");

const ASSET_KINDS = {
    model: { index: 7, start: 1000000, label: "Model", extension: ".dat", maxBytes: 1024 * 1024, magic: true },
    sprite: { index: 8, start: 2000000, label: "Sprite", extension: ".dat", maxBytes: 1024 * 1024, magic: false },
    texture: { index: 9, start: 3000000, label: "Texture", extension: ".dat", maxBytes: 1024 * 1024, magic: false },
    // Sequence and spot animation ids: above the cache's, below the 16-bit limit an animation id has.
    animation: { index: null, start: 50000, end: 65534, label: "Animation", folder: true, maxBytes: 1024 * 1024 },
    graphic: { index: null, start: 50000, end: 65534, label: "Graphic", folder: true, maxBytes: 1024 * 1024 },
};
const FOLDER_KINDS = new Set(["animation", "graphic"]);

const error = (message, status = 400) => Object.assign(new Error(message), { status });

const kindOf = (kind) => {
    const entry = ASSET_KINDS[kind];
    if (!entry) throw error(`Unknown asset kind "${kind}"; known: ${Object.keys(ASSET_KINDS).join(", ")}`);
    return entry;
};

function assetRoot(root) {
    return path.join(root, "data", "assets");
}

function assetsPath(root) {
    return path.join(assetRoot(root), "assets.json");
}

/** The Blender add-ons' working folder, which the asset library lists and imports from. */
function libraryRoot(root) {
    return path.join(root, "data", "models");
}

/** The asset rows of the overlay document, next to the definition rows. */
function assetsOf(root) {
    return Document.read(root).assets ?? [];
}

function isCacheModel(bytes) {
    if (bytes.length < 18) return false;
    if (bytes[bytes.length - 2] === 255 && [255, 254, 253].includes(bytes[bytes.length - 1])) return true;
    // The original 317 format has an 18-byte section directory, without a version marker.
    const tail = bytes.length - 18;
    const short = offset => (bytes[tail + offset] << 8) | bytes[tail + offset + 1];
    const vertices = short(0), faces = short(2);
    if (!vertices || !faces || [5, 7, 8, 9].some(offset => bytes[tail + offset] > 1)) return false;
    const body = vertices + faces * 3 + bytes[tail + 4] * 6 + short(10) + short(12) + short(14) + short(16)
        + (bytes[tail + 6] === 255 ? faces : 0) + (bytes[tail + 7] ? faces : 0)
        + (bytes[tail + 8] ? faces : 0) + (bytes[tail + 5] ? faces : 0) + (bytes[tail + 9] ? vertices : 0);
    return body === tail;
}

/** A path under data/models, refusing anything that leaves it. */
function libraryPath(root, relative) {
    if (typeof relative !== "string" || !relative || !/^[a-zA-Z0-9._/ -]+$/.test(relative) || relative.split("/").includes("..")) {
        throw error("A library path is a file or folder under data/models");
    }
    const base = fs.realpathSync(libraryRoot(root));
    const target = path.resolve(base, ...relative.split("/"));
    if (!fs.existsSync(target)) throw error(`data/models/${relative} doesn't exist`, 404);
    const real = fs.realpathSync(target);
    if (real !== base && !real.startsWith(`${base}${path.sep}`)) throw error(`data/models/${relative} is outside data/models`);
    return real;
}

/** Uploaded files (`{ "seq.dat": base64, "frames/1-2.dat": base64 }`) as path -> bytes. */
function uploadedFiles(files) {
    if (!files || typeof files !== "object" || Array.isArray(files)) throw error("Missing files");
    const out = new Map();
    for (const [name, data] of Object.entries(files)) {
        if (!/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/.test(name) || name.split("/").includes("..")) throw error(`Bad file name ${JSON.stringify(name)}`);
        if (typeof data !== "string") throw error(`${name}: missing data`);
        out.set(name, Buffer.from(data, "base64"));
    }
    return out;
}

/** The files under one folder of a file map ("anim/seq.dat" -> "seq.dat" for "anim"). */
function subFolder(files, prefix) {
    const out = new Map();
    for (const [name, bytes] of files) if (name.startsWith(`${prefix}/`)) out.set(name.slice(prefix.length + 1), bytes);
    return out;
}

const totalSize = (files) => [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);

/** A content hash of a folder: every file's path and bytes, in path order. */
function folderHash(files) {
    const hash = createHash("sha256");
    for (const name of [...files.keys()].sort()) {
        hash.update(`${name}\0${files.get(name).length}\0`);
        hash.update(files.get(name));
    }
    return hash.digest("hex").slice(0, 32);
}

/** An animation's or a graphic's name: what plugins look it up by, so lower_case and unique. */
function folderName(kind, name, fallback) {
    const clean = (text) => String(text ?? "").trim().toLowerCase().replace(/\.dat$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
    return clean(name) || clean(fallback) || kind;
}

function checkName(document, kind, name, id, core) {
    if (!Files.NAME.test(name)) throw error(`A ${kind}'s name is lower_case letters, digits and underscores`);
    if ((document.assets ?? []).some((row) => row.kind === kind && row.name === name && row.id !== id)) throw error(`Another ${kind} is already named ${name}`);
    const cache = core?.CacheDefinitions;
    const names = kind === "animation" ? cache?.getSeqNames?.() : cache?.getSpotanimNames?.();
    if (names) for (const [cacheId, cacheName] of names) {
        if (cacheName === name && cacheId < ASSET_KINDS[kind].start) throw error(`${name} is already a cache ${kind}'s name`);
    }
}

function nextId(document, kind, root, requested, core) {
    const entry = ASSET_KINDS[kind];
    const taken = new Set((document.assets ?? []).filter((row) => row.kind === kind).map((row) => row.id));
    const occupied = id => taken.has(id) || kind === "animation" && core?.CacheDefinitions?.hasSampledAnimation?.(id);
    // An id asked for (keeping one that plugins already use): in the kind's range, and free.
    if (requested !== undefined && requested !== null) {
        const id = Number(requested);
        if (!Number.isInteger(id) || id < entry.start || (entry.end !== undefined && id > entry.end)) throw error(`A ${kind} id is ${entry.start}..${entry.end ?? "up"}`);
        if (occupied(id)) throw error(`${kind} ${id} is already an asset or sampled animation`);
        return id;
    }
    if (kind === "model") {
        const legacy = path.join(root, "data", "definitions", "custom-items.json");
        if (fs.existsSync(legacy)) {
            const items = JSON.parse(fs.readFileSync(legacy, "utf8"));
            for (const item of Array.isArray(items) ? items : Object.values(items)) for (const key of Object.keys(item.models ?? {})) taken.add(Number(key));
        }
    }
    let id = entry.start;
    while (occupied(id)) id += 1;
    if (entry.end !== undefined && id > entry.end) throw error(`No ${kind} ids are left (they end at ${entry.end})`);
    return id;
}

/** Writes a content-addressed folder once; an existing one has the same bytes by its name. */
function storeFolder(root, kind, hash, files) {
    const directory = path.join(assetRoot(root), kind, hash);
    if (fs.existsSync(directory)) return directory;
    const temp = `${directory}.${process.pid}.${Date.now()}.tmp`;
    for (const [name, bytes] of files) {
        const file = path.join(temp, ...name.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
    }
    fs.renameSync(temp, directory);
    return directory;
}

/**
 * Adds or replaces one row. With `replace` (an id of this kind), the row keeps its id and name and
 * points at the new files: re-exporting an edited animation from Blender keeps every plugin that
 * plays it by name working.
 */
function commit(root, document, row, replace) {
    const assets = [...(document.assets ?? [])];
    if (replace !== undefined) {
        const index = assets.findIndex((entry) => entry.kind === row.kind && entry.id === Number(replace));
        if (index < 0) throw error(`No ${row.kind} ${replace} to replace`, 404);
        assets[index] = { ...assets[index], ...row, id: assets[index].id, name: assets[index].name };
        const next = { ...document, assets };
        Document.write(root, next);
        return { asset: assets[index], reused: false, replaced: true, revision: Document.revision(next), document: next };
    }
    const next = { ...document, assets: [...assets, row] };
    Document.write(root, next);
    return { asset: row, reused: false, revision: Document.revision(next), document: next };
}

/** The bytes of a model upload: base64 `data`, or a .dat file under data/models (`library`). */
function modelBytesOf(root, { data, library }) {
    if (library !== undefined) {
        const file = libraryPath(root, library);
        if (!fs.statSync(file).isFile()) throw error(`data/models/${library} is a folder, not a model file`);
        return fs.readFileSync(file);
    }
    if (typeof data !== "string" || data.length === 0) throw error("Missing file data");
    return Buffer.from(data, "base64");
}

function addModel(root, { name, data, library, replace }) {
    const entry = ASSET_KINDS.model;
    const bytes = modelBytesOf(root, { data, library });
    if (bytes.length === 0) throw error("The file is empty");
    if (bytes.length > entry.maxBytes) throw error(`The file is ${bytes.length} bytes; the cap is ${entry.maxBytes}`);
    if (entry.magic && !isCacheModel(bytes)) throw error("Not a cache model: invalid legacy section directory or version trailer");
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const document = Document.read(root);
    if (replace === undefined) {
        const existing = (document.assets ?? []).find((row) => row.kind === "model" && row.hash === hash);
        if (existing) return { asset: existing, reused: true, revision: Document.revision(document), document };
    }
    const id = replace === undefined ? nextId(document, "model", root) : Number(replace);
    const body = { gamemodeId: "server", datasets: [{ key: "customModels", rows: [{ id, data: bytes.toString("base64") }] }] };
    if (deflateSync(Buffer.from(JSON.stringify(body))).length + 8 > 65535) throw error("Model exceeds the client transport budget; use a smaller model", 413);
    const file = path.join(assetRoot(root), "model", `${hash}${entry.extension}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: "wx" });
    // From the library, its path names it ("abyssal-whip/drop.dat"): drop.dat alone says little.
    const fallback = library ? library.slice(-64) : `model-${id}`;
    return commit(root, document, {
        kind: "model",
        id,
        name: String(name ?? "").trim().slice(0, 64) || fallback,
        file: path.relative(assetRoot(root), file).split(path.sep).join("/"),
        hash,
        size: bytes.length,
    }, replace);
}

/** The files of an animation or graphic upload: `files` (base64 by path) or a folder under data/models. */
function folderFilesOf(root, { files, library }) {
    if (library !== undefined) {
        const directory = libraryPath(root, library);
        if (!fs.statSync(directory).isDirectory()) throw error(`data/models/${library} is a file, not a folder`);
        return Files.readFolder(directory);
    }
    return uploadedFiles(files);
}

const wrap = (fn) => {
    try {
        return fn();
    } catch (failure) {
        throw failure.status ? failure : error(String(failure.message).replace(/^\[custom-animations\] /, ""));
    }
};

function addAnimation(root, { name, files, library, replace, id: requested }, core, given) {
    const all = given ?? folderFilesOf(root, { files, library });
    const label = library ?? name ?? "the upload";
    const checked = wrap(() => Files.animationFiles(all, `animation ${label}`, core.CacheDefinitions));
    const keep = Files.animationKeeps(all, checked);
    if (totalSize(keep) > ASSET_KINDS.animation.maxBytes) throw error(`The animation is ${totalSize(keep)} bytes; the cap is ${ASSET_KINDS.animation.maxBytes}`);
    if (typeof core.encodeContentData !== "function") throw error("The animation's packet size can't be checked here", 500);
    const hash = folderHash(keep);
    const document = Document.read(root);
    // An id asked for is a new row, even for files already stored under another.
    if (replace === undefined && requested === undefined) {
        const existing = (document.assets ?? []).find((row) => row.kind === "animation" && row.hash === hash);
        if (existing) return { asset: existing, reused: true, revision: Document.revision(document), document };
    }
    const id = replace === undefined ? nextId(document, "animation", root, requested, core) : Number(replace);
    checkCustomFrameMaps(root, document, checked, id);
    const rowName = replace === undefined ? folderName("animation", name, library ? library.split("/").filter(Boolean).join("_") : `animation_${id}`) : undefined;
    if (rowName) checkName(document, "animation", rowName, id, core);
    // Players get each animation in one content packet: check the row they would get, as the server
    // builds it at startup (its id, name and frame group, which all change the compressed size),
    // before storing anything.
    const animations = (document.assets ?? []).filter((row) => row.kind === "animation");
    const finalName = rowName ?? animations.find((row) => row.id === id)?.name ?? "";
    const group = Files.FIRST_FRAME_GROUP + animations.filter((row) => row.id < id).length;
    if (!Files.fitsPacket(core.encodeContentData, Files.animationRow(checked, id, finalName, group))) {
        throw error("The animation is too big for one content packet; use fewer or smaller frames", 413);
    }
    storeFolder(root, "animation", hash, keep);
    return commit(root, document, {
        kind: "animation", id, name: rowName, file: `animation/${hash}`, hash, size: totalSize(keep),
        frames: checked.ids.length, framemaps: checked.framemaps,
    }, replace);
}

/**
 * A custom frame map is known by its id, so every animation asset that uses the id must have the
 * same bytes (CustomAnimations refuses the set at startup otherwise). `id` is the animation being
 * stored, which a replace may change.
 */
function checkCustomFrameMaps(root, document, checked, id) {
    for (const [framemap, bytes] of checked.customFrameMaps) {
        for (const row of document.assets ?? []) {
            if (row.kind !== "animation" || row.id === id || !row.framemaps?.includes(framemap)) continue;
            const theirs = readAsset(root, row)?.get(`framemap-${framemap}.dat`);
            if (theirs && !theirs.equals(bytes)) {
                throw error(`Frame map ${framemap} differs from the one animation ${row.id} (${row.name}) uses; give a different frame map its own id`, 409);
            }
        }
    }
}

/**
 * A graphic: its spotanim.dat as a folder asset, its model.dat as a model asset, and its own
 * animation (anim/ in the add-on's export) as an animation asset. Replacing a graphic replaces the
 * custom animation it already had, in place, so the animation keeps its id and name too.
 */
function addGraphic(root, { name, files, library, replace, animation, id: requested }, core) {
    const all = folderFilesOf(root, { files, library });
    const spotanim = all.get("spotanim.dat");
    if (!spotanim) throw error("A graphic needs its spotanim.dat (the add-on exports it next to model.dat)");
    wrap(() => Files.readSpotanim(new Uint8Array(spotanim), "spotanim.dat"));
    const document = Document.read(root);
    const previous = replace !== undefined ? (document.assets ?? []).find((row) => row.kind === "graphic" && row.id === Number(replace)) : null;
    if (replace !== undefined && !previous) throw error(`No graphic ${replace} to replace`, 404);
    if (animation !== undefined && animation !== null) checkAnimationLink(document, animation, core);
    // A graphic is several rows (its model, its animation, itself): if a later one is refused, the
    // document goes back to what it was, so a failed import leaves no parts behind. Stored files
    // are content-addressed, and nothing points at the ones left over.
    try {
        return addGraphicParts(root, { name, library, all, spotanim, replace, animation, requested, previous }, core);
    } catch (failure) {
        Document.write(root, document);
        throw failure;
    }
}

/**
 * A graphic's own animation, given by id: a cache animation or one of the animation assets, as
 * the server checks it at startup (CustomAnimations' loadGraphic), so an accepted import loads.
 */
function checkAnimationLink(document, animation, core) {
    if (!Number.isInteger(animation) || animation < 0 || animation > 0xfffe) throw error(`animation must be an animation id from 0 to 65534, not ${JSON.stringify(animation)}`);
    const custom = (document.assets ?? []).some((row) => row.kind === "animation" && row.id === animation);
    if (!custom && !core.CacheDefinitions?.hasDefinition?.("seq", animation)) throw error(`No animation ${animation} in the cache or your animation assets`, 404);
}

function addGraphicParts(root, { name, library, all, spotanim, replace, animation, requested, previous }, core) {
    const base = folderName("graphic", previous?.name ?? name, library ? library.split("/").filter(Boolean).join("_") : "graphic");
    const parts = [];
    let model = null;
    if (all.has("model.dat")) {
        const added = addModel(root, { name: `${base}_model`, data: all.get("model.dat").toString("base64") });
        model = added.asset.id;
        parts.push(added.asset);
    }
    let seq = animation !== undefined && animation !== null ? animation : null;
    const anim = subFolder(all, "anim");
    if (seq === null && anim.has("seq.dat")) {
        const previousAnimation = previous && (assetsOf(root).some((row) => row.kind === "animation" && row.id === previous.animation)) ? previous.animation : undefined;
        const added = addAnimation(root, { name: `${base}_anim`, replace: previousAnimation }, core, anim);
        seq = added.asset.id;
        parts.push(added.asset);
    }
    const keep = new Map([["spotanim.dat", spotanim]]);
    if (all.has("info.json")) keep.set("info.json", all.get("info.json"));
    const hash = folderHash(keep);
    const current = Document.read(root);
    if (replace === undefined && requested === undefined) {
        const existing = (current.assets ?? []).find((row) => row.kind === "graphic" && row.hash === hash && row.model === model && row.animation === seq);
        if (existing) return { asset: existing, reused: true, parts, revision: Document.revision(current), document: current };
    }
    const id = replace === undefined ? nextId(current, "graphic", root, requested) : Number(replace);
    if (replace === undefined) checkName(current, "graphic", base, id, core);
    storeFolder(root, "graphic", hash, keep);
    const result = commit(root, current, {
        kind: "graphic", id, name: replace === undefined ? base : undefined, file: `graphic/${hash}`, hash, size: spotanim.length, model, animation: seq,
    }, replace);
    return { ...result, parts };
}

/**
 * Stores one upload and appends its row (or, with `replace`, points an existing row at it). The
 * source is base64 `data` (a model) or `files` (an animation's or graphic's folder), or `library`,
 * a path under data/models that the add-ons exported to. Returns the row, which is the existing one
 * when the same bytes are already stored (content addressing by sha256).
 */
function addAsset(root, payload, core) {
    const { kind } = payload ?? {};
    kindOf(kind);
    if (payload.replace !== undefined && !Number.isInteger(Number(payload.replace))) throw error("replace is an asset id");
    let result;
    if (kind === "model") result = addModel(root, payload);
    else if (kind === "animation") result = addAnimation(root, payload, core ?? {});
    else if (kind === "graphic") result = addGraphic(root, payload, core ?? {});
    else throw error("Only model, animation and graphic uploads are supported; sprites and textures can be browsed");
    const { document, ...answer } = result;
    return answer;
}

/** Renames one asset, so a lookup can be by something a human recognises. */
function renameAsset(root, { kind, id, name }, core) {
    const document = Document.read(root);
    const rows = document.assets ?? [];
    const row = rows.find((entry) => entry.kind === kind && entry.id === Number(id));
    if (!row) throw error(`No ${kind} ${id}`, 404);
    if (FOLDER_KINDS.has(kind)) {
        const next = folderName(kind, name, row.name);
        checkName(document, kind, next, row.id, core);
        row.name = next;
    } else row.name = String(name ?? "").trim().slice(0, 64) || row.name;
    Document.write(root, document);
    return { asset: row, revision: Document.revision(document) };
}

/** The asset's bytes, for shipping to clients or previewing; a folder asset's files by path. */
function readAsset(root, asset) {
    const file = path.join(assetRoot(root), ...String(asset.file).split("/"));
    if (!fs.existsSync(file)) return undefined;
    return FOLDER_KINDS.has(asset.kind) ? Files.readFolder(file) : fs.readFileSync(file);
}

/** Every model asset as the client's `customModels` dataset expects: `{ id, data }`. */
function customModels(root) {
    return assetsOf(root)
        .filter((asset) => asset.kind === "model")
        .flatMap((asset) => {
            const bytes = readAsset(root, asset);
            return bytes ? [{ id: asset.id, data: bytes.toString("base64") }] : [];
        });
}

/** `kind:id` -> name, for showing a human label next to an id anywhere it appears. */
function assetNames(root) {
    const names = new Map();
    for (const asset of assetsOf(root)) names.set(`${asset.kind}:${asset.id}`, asset.name);
    return names;
}

/**
 * What the asset library offers to import, by kind: the add-ons' exports under data/models. A model
 * is any .dat that is a cache model; an animation, a folder with seq.dat; a graphic, a folder with
 * spotanim.dat. Each comes with the asset it already is, when its bytes are stored.
 */
function library(root, kind) {
    kindOf(kind);
    if (!["model", "animation", "graphic"].includes(kind)) return [];
    const base = libraryRoot(root);
    if (!fs.existsSync(base)) return [];
    const stored = assetsOf(root).filter((row) => row.kind === kind);
    const entries = [];
    const walk = (directory, prefix, depth) => {
        let children;
        try {
            children = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        const names = new Set(children.map((child) => child.name));
        // Folders are checked properly on import; the listing only finds candidates.
        if (kind === "animation" && names.has("seq.dat") && prefix) {
            entries.push({ path: prefix, name: folderName("animation", null, prefix.replace(/\//g, "_")), files: countFiles(directory) });
        }
        if (kind === "graphic" && names.has("spotanim.dat") && prefix) {
            entries.push({ path: prefix, name: folderName("graphic", null, prefix.replace(/\//g, "_")), model: names.has("model.dat"), animation: names.has("anim") });
        }
        for (const child of children) {
            if (child.isDirectory() && depth < 4 && !["frames", "__pycache__"].includes(child.name)) walk(path.join(directory, child.name), `${prefix}${prefix ? "/" : ""}${child.name}`, depth + 1);
            if (kind === "model" && child.isFile() && child.name.endsWith(".dat") && !/^(seq|spotanim|framemap-\d+)\.dat$/.test(child.name)) {
                const file = path.join(directory, child.name);
                let bytes;
                try {
                    bytes = fs.readFileSync(file);
                } catch {
                    continue;
                }
                if (!isCacheModel(bytes)) continue;
                const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
                const relative = `${prefix}${prefix ? "/" : ""}${child.name}`;
                entries.push({ path: relative, name: relative.replace(/\//g, "_").replace(/\.dat$/, ""), size: bytes.length, stored: stored.find((row) => row.hash === hash)?.id ?? null });
            }
        }
    };
    walk(base, "", 0);
    return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function countFiles(directory) {
    try {
        return Files.readFolder(directory).size;
    } catch {
        return 0;
    }
}

/**
 * Writes an asset back into data/models/<folder>/ for Blender: a model as model.dat; an animation's
 * files; a graphic's spotanim.dat, its model asset as model.dat and its custom animation as anim/.
 * Edit it there and import it again with `replace`, and it keeps its id and name.
 */
function exportAsset(root, { kind, id, folder, overwrite = false }) {
    kindOf(kind);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(folder))) throw error("A folder name is lower-case letters, digits and dashes (up to 64)");
    const rows = assetsOf(root);
    const row = rows.find((entry) => entry.kind === kind && entry.id === Number(id));
    if (!row) throw error(`No ${kind} ${id}`, 404);
    const directory = path.join(libraryRoot(root), folder);
    if (fs.existsSync(directory) && !overwrite) throw Object.assign(error(`data/models/${folder} already exists`, 409), { code: "EXISTS" });
    const files = new Map();
    const add = (prefix, asset) => {
        const data = asset ? readAsset(root, asset) : undefined;
        if (!data) throw error(`${asset?.kind ?? kind} ${asset?.id ?? id}'s files are missing from data/assets`, 404);
        if (Buffer.isBuffer(data)) files.set(prefix || "model.dat", data);
        else for (const [name, bytes] of data) files.set(`${prefix}${name}`, bytes);
    };
    if (kind === "model") add("model.dat", row);
    else if (kind === "animation") add("", row);
    else if (kind === "graphic") {
        add("", row);
        if (row.model !== null && row.model !== undefined) add("model.dat", rows.find((entry) => entry.kind === "model" && entry.id === row.model));
        const animation = rows.find((entry) => entry.kind === "animation" && entry.id === row.animation);
        if (animation) add("anim/", animation);
    } else throw error(`A ${kind} can't be exported`);
    for (const [name, bytes] of files) {
        const file = path.join(directory, ...name.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
    }
    return { folder, written: [...files.keys()].sort() };
}

module.exports = {
    isCacheModel, ASSET_KINDS, FOLDER_KINDS, kindOf, assetRoot, assetsPath, libraryRoot, assetsOf, addAsset, renameAsset, readAsset,
    customModels, assetNames, library, exportAsset, folderHash,
};
