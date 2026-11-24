const fs = require("fs");
const path = require("path");

const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;

function templatesDir() {
  return process.env.AGENT_MCP_TEMPLATES_DIR ?? path.resolve(__dirname, "..", "data", "templates");
}

function templateFile(name) {
  if (!NAME.test(name)) throw new Error(`Template name "${name}" must be lowercase letters, digits, - or _`);
  return path.join(templatesDir(), `${name}.json`);
}

function readTemplate(name) {
  const file = templateFile(name);
  if (!fs.existsSync(file)) throw new Error(`No template "${name}"; list_templates shows what exists`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listTemplates() {
  const dir = templatesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith(".json") && NAME.test(file.slice(0, -5))).sort()
    .map((file) => {
      const template = readTemplate(file.slice(0, -5));
      return {
        name: file.slice(0, -5), about: template.about, width: template.width, height: template.height,
        objects: template.objects.length, tiles: template.tiles.length, source: template.source,
      };
    });
}

module.exports = { templatesDir, templateFile, readTemplate, listTemplates };
