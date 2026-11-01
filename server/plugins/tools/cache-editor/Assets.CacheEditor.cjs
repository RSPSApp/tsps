"use strict";

// Uploaded assets: the meshes, sprites and textures this project adds on top of the cache.
//
// The cache has no "category" field on an id — the *index* is the category (7 models, 8 sprites,
// 9 textures), and an id is only meaningful inside one of them. Each asset kind therefore gets its
// own id range, so `{ kind, id }` is the identity and two kinds can never collide.
//
// Files live under `server/data/assets/<kind>/<sha256>.dat`: content-addressed, so the same mesh
// uploaded twice is one file and one row, and the row keeps the name a human gave it.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const Document = require("./Document.CacheEditor.cjs");

const ASSET_KINDS = {
    model: { index: 7, start: 1000000, label: "Model", extension: ".dat", maxBytes: 1024 * 1024, magic: true },
    sprite: { index: 8, start: 2000000, label: "Sprite", extension: ".dat", maxBytes: 1024 * 1024, magic: false },
    texture: { index: 9, start: 3000000, label: "Texture", extension: ".dat", maxBytes: 1024 * 1024, magic: false },
};

const kindOf = (kind) => {
    const entry = ASSET_KINDS[kind];
    if (!entry) throw Object.assign(new Error(`Unknown asset kind "${kind}"; known: ${Object.keys(ASSET_KINDS).join(", ")}`), { status: 400 });
    return entry;
};

function assetRoot(root) {
    return path.join(root, "server", "data", "assets");
}

function assetsPath(root) {
    return path.join(assetRoot(root), "assets.json");
}

/** The asset rows of the overlay document, next to the definition rows. */
function assetsOf(root) {
    return Document.read(root).assets ?? [];
}

/**
 * Stores one uploaded file and appends its row. Returns the row, which is either the new one or the
 * existing one when the bytes are already known (content addressing by sha256).
 */
function addAsset(root, { kind, name, data }) {
    const entry = kindOf(kind);
    if (typeof data !== "string" || data.length === 0) throw Object.assign(new Error("Missing file data"), { status: 400 });
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0) throw Object.assign(new Error("The file is empty"), { status: 400 });
    if (bytes.length > entry.maxBytes) throw Object.assign(new Error(`The file is ${bytes.length} bytes; the cap is ${entry.maxBytes}`), { status: 400 });
    if (entry.magic) {
        // A cache model ends with its version trailer: -1,-3 / -1,-2 / -1,-1.
        const last = bytes[bytes.length - 1], before = bytes[bytes.length - 2];
        const trailer = (before === 0xff ? -1 : before) * 1;
        if (!(last === 0xff || last === 0xfe || last === 0xfd) || before !== 0xff) {
            throw Object.assign(new Error("Not a cache model: the version trailer (-1,-3 / -1,-2 / -1,-1) is missing"), { status: 400 });
        }
    }
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const document = Document.read(root);
    const existing = (document.assets ?? []).find((row) => row.kind === kind && row.hash === hash);
    if (existing) return { asset: existing, reused: true, revision: Document.revision(document) };

    const taken = new Set((document.assets ?? []).filter((row) => row.kind === kind).map((row) => row.id));
    let id = entry.start;
    while (taken.has(id)) id += 1;

    const file = path.join(assetRoot(root), kind, `${hash}${entry.extension}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: "wx" });
    const asset = {
        kind,
        id,
        name: String(name ?? "").trim().slice(0, 64) || `${kind}-${id}`,
        file: path.relative(assetRoot(root), file).split(path.sep).join("/"),
        hash,
        size: bytes.length,
    };
    const next = { ...document, assets: [...(document.assets ?? []), asset] };
    Document.write(root, next);
    return { asset, reused: false, revision: Document.revision(next) };
}

/** Renames one asset, so a lookup can be by something a human recognises. */
function renameAsset(root, { kind, id, name }) {
    const document = Document.read(root);
    const rows = document.assets ?? [];
    const row = rows.find((entry) => entry.kind === kind && entry.id === Number(id));
    if (!row) throw Object.assign(new Error(`No ${kind} ${id}`), { status: 404 });
    row.name = String(name ?? "").trim().slice(0, 64) || row.name;
    Document.write(root, document);
    return { asset: row, revision: Document.revision(document) };
}

/** The asset's bytes, for shipping to clients or previewing. */
function readAsset(root, asset) {
    const file = path.join(assetRoot(root), asset.file);
    if (!fs.existsSync(file)) return undefined;
    return fs.readFileSync(file);
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

module.exports = { ASSET_KINDS, kindOf, assetRoot, assetsPath, assetsOf, addAsset, renameAsset, readAsset, customModels, assetNames };
