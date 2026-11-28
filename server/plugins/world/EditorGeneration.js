const fs = require("node:fs");
const path = require("node:path");

// Developer checkouts use editor sources; server-only installs and host snapshots use dist.
function editorGenerationPath(...parts) {
  const source = path.resolve(__dirname, "../../../client/game/plugins/editmode/generation");
  let useSource = fs.existsSync(source);
  if (useSource) {
    try { require.resolve("pako", { paths: [source] }); }
    catch { useSource = false; }
  }
  const directory = useSource ? source : path.resolve(__dirname, "../../dist/editor-generation");
  return path.join(directory, ...parts);
}

module.exports = { editorGenerationPath };
