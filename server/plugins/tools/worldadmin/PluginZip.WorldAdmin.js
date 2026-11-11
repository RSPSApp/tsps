const fs = require("node:fs");
const path = require("node:path");
const { wrap } = require("node:module");
const { Script } = require("node:vm");
const { crc32, inflateRawSync } = require("node:zlib");
const AdmZip = require("adm-zip");
const { HttpError, MAX_BODY_BYTES } = require("./Http.WorldAdmin");

const MAX_FILE_BYTES = 1024 * 1024;
const PACKAGE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const PACKAGE_VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const RELEASES = "https://github.com/RSPSApp/tsps-plugins/releases/download";

function parseManifest(text) {
  const { format, id, name, version, description } = JSON.parse(text);
  if (format !== 1 || typeof id !== "string" || !PACKAGE_ID.test(id) ||
      typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ||
      typeof version !== "string" || !PACKAGE_VERSION.test(version) ||
      typeof description !== "string" || description.length > 500) {
    throw new Error("Invalid plugin manifest");
  }
  return { format, id, name, version, description };
}

function readEntry(entry) {
  const { size, compressedSize, method, encrypted, crc } = entry.header;
  if (entry.isDirectory || encrypted || ![0, 8].includes(method) || size < 1 || size > MAX_FILE_BYTES) {
    throw new Error("Unsupported ZIP entry");
  }
  const compressed = entry.getCompressedData();
  if (compressed.length !== compressedSize) throw new Error("Incomplete ZIP entry");
  const data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: size });
  if (data.length !== size || crc32(data) !== crc) throw new Error("Damaged ZIP entry");
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}

function readPluginZip(body) {
  try {
    const entries = new AdmZip(body).getEntries();
    const manifestEntry = entries.find((entry) => entry.entryName === "plugin.json");
    if (entries.length !== 2 || !manifestEntry) throw new Error("Expected a manifest and one entry file");
    const manifest = parseManifest(readEntry(manifestEntry));
    const file = `${manifest.name}.plugin.js`;
    const entry = entries.find((candidate) => candidate.entryName === file);
    if (!entry) throw new Error("Plugin entry file does not match the manifest");
    const source = readEntry(entry);
    new Script(wrap(source), { filename: file });
    return { manifest, file, source };
  } catch {
    throw new HttpError(400, "Invalid plugin ZIP. Include plugin.json and its matching .plugin.js file.");
  }
}

async function downloadPluginRelease(packageId, version) {
  if (typeof packageId !== "string" || !PACKAGE_ID.test(packageId) ||
      typeof version !== "string" || !PACKAGE_VERSION.test(version)) {
    throw new HttpError(400, "Invalid plugin package ID or version.");
  }
  const options = { redirect: "manual", signal: AbortSignal.timeout(15000) };
  const releaseUrl = `${RELEASES}/${packageId}-v${version}/${packageId}-${version}.zip`;
  let zip;
  try {
    let response = await fetch(releaseUrl, options);
    if (response.status === 302) {
      await response.body?.cancel();
      const asset = new URL(response.headers.get("location"));
      if (asset.origin !== "https://release-assets.githubusercontent.com" || asset.username || asset.password) {
        throw new Error("Unexpected release asset URL");
      }
      response = await fetch(asset, options);
    }
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_BODY_BYTES) {
      await response.body?.cancel();
      throw new Error("Invalid release response");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("Release exceeds the upload limit");
      chunks.push(chunk);
    }
    zip = Buffer.concat(chunks, size);
  } catch {
    throw new HttpError(502, "Could not download the plugin ZIP from GitHub.");
  }

  const release = readPluginZip(zip);
  if (release.manifest.id !== packageId || release.manifest.version !== version) {
    throw new HttpError(502, "The downloaded plugin does not match the requested release.");
  }
  return release;
}

function savePluginZip(directory, { manifest, file, source }, existingPlugins) {
  const imported = path.join(directory, "imported");
  const destination = path.join(imported, manifest.id);
  const key = manifest.name.toLowerCase();
  if (existingPlugins.some((plugin) => [plugin.name, path.basename(plugin.file, ".plugin.js")]
    .some((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "") === key))) {
    throw new HttpError(409, "A plugin with that name is already installed.");
  }
  fs.mkdirSync(imported, { recursive: true });
  if (!fs.lstatSync(imported).isDirectory()) throw new Error("Invalid imported plugin directory");
  if (fs.existsSync(destination)) throw new HttpError(409, "That plugin package is already installed.");

  const staging = fs.mkdtempSync(path.join(path.dirname(directory), ".plugin-upload-"));
  try {
    fs.writeFileSync(path.join(staging, "plugin.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(staging, file), source);
    fs.renameSync(staging, destination);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function deletePluginZip(directory, packageId) {
  if (typeof packageId !== "string" || !PACKAGE_ID.test(packageId)) {
    throw new HttpError(400, "Invalid plugin package ID.");
  }
  const imported = path.join(directory, "imported");
  const destination = path.join(imported, packageId);
  const manifestFile = path.join(destination, "plugin.json");
  const missing = () => new HttpError(404, "Installed plugin package not found.");
  if (!fs.lstatSync(imported, { throwIfNoEntry: false })?.isDirectory() ||
      !fs.lstatSync(destination, { throwIfNoEntry: false })?.isDirectory() ||
      !fs.lstatSync(manifestFile, { throwIfNoEntry: false })?.isFile()) throw missing();

  let manifest;
  try { manifest = parseManifest(fs.readFileSync(manifestFile, "utf8")); }
  catch { throw missing(); }
  if (manifest.id !== packageId) throw missing();

  const entry = path.join(destination, `${manifest.name}.plugin.js`);
  const cachedEntry = fs.lstatSync(entry, { throwIfNoEntry: false })?.isFile() ? require.resolve(entry) : undefined;
  fs.rmSync(destination, { recursive: true, maxRetries: 3 });
  // Running hooks survive until restart, but a new upload should show as pending.
  if (cachedEntry) delete require.cache[cachedEntry];
}

module.exports = { readPluginZip, downloadPluginRelease, savePluginZip, deletePluginZip };
