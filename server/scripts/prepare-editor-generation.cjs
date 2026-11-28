const fs = require("node:fs");
const path = require("node:path");

function prepareEditorGeneration(
  source = path.resolve(__dirname, "../../client/game/plugins/editmode/generation"),
  destination = path.resolve(__dirname, "../dist/editor-generation"),
) {
  fs.rmSync(destination, { recursive: true, force: true });
  function copy(directory, output) {
    fs.mkdirSync(output, { recursive: true });
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const input = path.join(directory, entry.name);
      const target = path.join(output, entry.name);
      if (entry.isDirectory()) copy(input, target);
      else if (/\.(?:c?js|json)$/.test(entry.name)) {
        // Node/WebContainer already provide zlib; don't vendor the browser's pako dependency.
        const contents = fs.readFileSync(input, "utf8").replace(
          'const { deflate } = require("pako");',
          'const { deflateSync: deflate } = require("node:zlib");',
        );
        fs.writeFileSync(target, contents);
      }
    }
  }
  copy(source, destination);
}

if (require.main === module) prepareEditorGeneration();
module.exports = { prepareEditorGeneration };
