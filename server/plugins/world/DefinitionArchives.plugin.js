"use strict";

const DATASET = "definitionArchives";

function install(api, request) {
  const { CacheDefinitions, ItemDefinition, NpcDefinition, ObjectDefinition, encodeContentData, World } = api.core;
  // Check the actual wire encoder before publishing a registry the client could
  // not receive. It also enforces the packet's own framing limits.
  if (encodeContentData("server", [{ key: DATASET, rows: request.bundles }]).length > 0xffff) {
    throw new Error("Definition archives exceed the content transport limit");
  }
  const candidate = CacheDefinitions.getDefinitionArchiveChanges(request.bundles);
  const locs = new Set(candidate.loc);
  // World objects retain collision materialized from the old definition. Their
  // owning content must deregister them while that definition is still present.
  if (locs.size && World.getObjects().some(object => locs.has(object.getId()))) {
    request.handled = false;
    request.error = "Despawn affected world objects before changing archived definitions.";
    return;
  }
  const changed = CacheDefinitions.registerDefinitionArchives(request.bundles);
  for (const id of changed.obj) ItemDefinition.invalidateCache(id);
  for (const id of changed.npc) NpcDefinition.invalidateCache(id);
  for (const id of changed.loc) ObjectDefinition.invalidateCache(id);
  request.handled = true;
  for (const player of World.getPlayers()) {
    if (player) send(api, { player });
  }
}

function send(api, { player }) {
  if (!player.getSession()) return;
  player.getPacketSender().sendContentData("server", [{
    key: DATASET,
    rows: [...api.core.CacheDefinitions.getDefinitionArchiveBundles()],
  }]);
}

module.exports = {
  name: "DefinitionArchives",
  description: "Installs bundled item, NPC and object definition changes at runtime and sends them to every client on login and when they change.",
  register(api) {
    api.onCustomEvent("definition-archives:install", install.bind(null, api));
    api.onPlayerLogin(send.bind(null, api));
  },
};
