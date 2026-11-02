"use strict";

// Shared builder for the event dialogue flows: NPC lines (or `pages` when player and NPC
// lines alternate), then up to five options on the multi-chatbox prompt the quest runtime
// and the gift events already use, then end. The
// cache's legacy OptionDialogue chatbox menus are not wired for this client (their send
// throws on the missing title), so options go through api.sendMultiChatboxPrompt.
//
// Live copies every spoken line to the chatbox as a dialogue game message just before the
// dialogue opens: MessageGame type=114 'Niles|Thank you, ...' (552 tick 20013), the player's
// lines too ('<name>|Here you are.', 560 tick 13080). A line may carry its chathead animation
// as `expression`, and a line break the speaker's text was authored with as "<br>".
const DIALOGUE_CHAT_TYPE = 114;
// RunClientScript 58's title in 636 live menus. Invitation prompts are the exception, "What would
// you like to say?" (53 live, 4156, 1846, 1855), and pass it as `title`.
const OPTIONS_TITLE = "Select an option";

function mirrored(player, entry, name, text) {
  const send = entry.send;
  entry.send = (viewer) => {
    player.getPacketSender().sendTypedMessage(DIALOGUE_CHAT_TYPE, text.replace(/<br>/g, " "), name);
    send.call(entry, viewer);
  };
  return entry;
}

/** A page's chathead animation: its own `expression`, or a family's first animation + its line count. */
function expressionOf(api, page, base) {
  if (page.expression != null) return page.expression;
  const anim = page.anim ?? base;
  if (anim == null) return undefined;
  const lines = page.text.split("<br>").flatMap(part => api.core.Misc.wrapText(part, 53)).length;
  return anim + Math.min(3, lines - 1);
}

function npcLine(api, player, index, npcId, text, expression) {
  const entry = new api.core.NpcDialogue(index, npcId, text, undefined, expression);
  const name = api.core.NpcDefinition?.forId(npcId)?.getName()?.replace(/_/g, " ") ?? "";
  return mirrored(player, entry, name, text);
}

function playerLine(api, player, index, text, expression) {
  return mirrored(player, new api.core.PlayerDialogue(index, text, expression), player.getUsername(), text);
}

function chat(api, { player, npcId = -1, title = OPTIONS_TITLE, lines = [], playerLines = [],
  pages = null, options = [], onEnd = null, end = true, anim = null }) {
  const builder = new api.core.DialogueChainBuilder();
  let index = 0;
  // `pages` keeps the live speaker order when NPC and player lines alternate.
  if (pages) {
    for (const page of pages) {
      // With no NPC named anywhere, a page is the player's.
      const speaker = page.npcId ?? npcId;
      const expression = expressionOf(api, page, anim);
      builder.add(page.player || speaker < 0
        ? playerLine(api, player, index++, page.text, expression)
        : npcLine(api, player, index++, speaker, page.text, expression));
    }
  } else {
    for (const page of lines) {
      const text = typeof page === "string" ? page : page.text;
      builder.add(npcLine(api, player, index++, typeof page === "string" ? npcId : page.npcId ?? npcId,
        text, typeof page === "string" ? undefined : page.expression));
    }
    for (const text of playerLines) builder.add(playerLine(api, player, index++, text));
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
