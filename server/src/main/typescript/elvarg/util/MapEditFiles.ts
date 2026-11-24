import path = require("node:path");
import fs = require("node:fs");

// The file index is also used by plain JavaScript map plugins. Load the same
// implementation from the source tree and the compiled server.
const library = "plugins/world/MapEditFiles.js";
const compiledRoot = path.resolve(__dirname, "../..", library);
export const mapEditFiles: {
    effectiveFile(base: string, layers?: ReadonlyMap<string, string | null>): string | null;
    readLayers(data: string): { effective: ReadonlyMap<string, string | null> };
    regionFiles(): { name: string; file: string }[];
    commitMapEdit(files: ReadonlyMap<string, string | Buffer | null>, data?: string): string;
} = require(fs.existsSync(compiledRoot) ? compiledRoot : path.resolve(__dirname, "../../../../..", library));
