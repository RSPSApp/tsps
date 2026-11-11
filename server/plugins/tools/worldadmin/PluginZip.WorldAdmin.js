const fs = require("node:fs");
const path = require("node:path");
const { wrap } = require("node:module");
const { Script } = require("node:vm");
const { crc32, inflateRawSync } = require("node:zlib");
const AdmZip = require("adm-zip");
const { HttpError } = require("./Http.WorldAdmin");

const MAX_FILE_BYTES = 1024 * 1024;

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
    const { format, id, name, version, description } = JSON.parse(readEntry(manifestEntry));
    if (format !== 1 || typeof id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(id) ||
        typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ||
        typeof version !== "string" || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version) ||
        typeof description !== "string" || description.length > 500) {
      throw new Error("Invalid plugin manifest");
    }
    const file = `${name}.plugin.js`;
    const entry = entries.find((candidate) => candidate.entryName === file);
    if (!entry) throw new Error("Plugin entry file does not match the manifest");
    const source = readEntry(entry);
    new Script(wrap(source), { filename: file });
    return { manifest: { format, id, name, version, description }, file, source };
  } catch {
    throw new HttpError(400, "Invalid plugin ZIP. Include plugin.json and its matching .plugin.js file.");
  }
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

module.exports = { readPluginZip, savePluginZip };
