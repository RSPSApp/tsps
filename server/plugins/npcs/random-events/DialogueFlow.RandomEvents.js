"use strict";

// Shared builder for the event dialogue flows: NPC lines (or `pages` when player and NPC
// lines alternate), then up to five options on the multi-chatbox prompt the quest runtime
// and the gift events already use, then end. The
// cache's legacy OptionDialogue chatbox menus are not wired for this client (their send
// throws on the missing title), so options go through api.sendMultiChatboxPrompt.
function chat(api, { player, npcId = -1, title = "Select an Option", lines = [], playerLines = [],
  pages = null, options = [], onEnd = null, end = true }) {
  const builder = new api.core.DialogueChainBuilder();
  let index = 0;
  // `pages` keeps the live speaker order when NPC and player lines alternate.
  if (pages) {
    for (const page of pages) {
      builder.add(page.player
        ? new api.core.PlayerDialogue(index++, page.text)
        : new api.core.NpcDialogue(index++, page.npcId ?? npcId, page.text));
    }
  } else {
    for (const page of lines) {
      const text = typeof page === "string" ? page : page.text;
      builder.add(new api.core.NpcDialogue(index++, typeof page === "string" ? npcId : page.npcId ?? npcId, text));
    }
    for (const text of playerLines) builder.add(new api.core.PlayerDialogue(index++, text));
  }
  if (options.length) {
    // ActionDialogue runs when the player finishes the lines: show the choice prompt then.
    builder.add(new api.core.ActionDialogue(index++, {
      execute: () => api.sendMultiChatboxPrompt(player, title,
        ...options.flatMap(option => [option[0], () => option[1]()])),
    }));
  } else {
    if (onEnd) builder.add(new api.core.ActionDialogue(index++, { execute: () => onEnd() }));
    if (end) builder.add(new api.core.EndDialogue(index));
  }
  player.getDialogueManager().startDialogues(builder);
  return builder;
}

function statement(api, player, text, onEnd = null) {
  const builder = new api.core.DialogueChainBuilder()
    .add(new api.core.StatementDialogue(0, text))
    .add(new api.core.EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
  return builder;
}

function itemStatement(api, player, itemId, text) {
  const builder = new api.core.DialogueChainBuilder()
    .add(new api.core.ItemStatementDialogue(0, itemId, text))
    .add(new api.core.EndDialogue(1));
  player.getDialogueManager().startDialogues(builder);
  return builder;
}

module.exports = { chat, statement, itemStatement };
