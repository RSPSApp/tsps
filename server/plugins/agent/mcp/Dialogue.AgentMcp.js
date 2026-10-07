// Reading and answering chatbox dialogues.

// Options come either from a DialogueManager OptionDialogue or a plugin's sendMultiChatboxPrompt.
function readDialogue(core, p) {
  const {
    MultiChatboxPrompt, NpcDefinition, ItemDefinition,
    NpcDialogue, PlayerDialogue, OptionDialogue, StatementDialogue, ItemStatementDialogue,
  } = core;
  const prompt = MultiChatboxPrompt.getPending(p);
  if (prompt) return { kind: "options", title: prompt.title, options: prompt.options };
  const entry = p.getDialogueManager().getCurrent();
  if (!entry) return null;
  if (entry instanceof NpcDialogue) {
    const speaker = NpcDefinition.forId(entry.getNpcId())?.getName()?.replace(/_/g, " ");
    return { kind: "npc", speaker, text: entry.getText() };
  }
  if (entry instanceof PlayerDialogue) return { kind: "player", speaker: p.getUsername(), text: entry.getText() };
  if (entry instanceof OptionDialogue) return { kind: "options", title: entry.getTitle() || undefined, options: entry.getOptions() };
  if (entry instanceof ItemStatementDialogue) {
    return { kind: "item", item: ItemDefinition.forId(entry.getItemId()).getName(), text: entry.getText() };
  }
  if (entry instanceof StatementDialogue) return { kind: "statement", text: entry.getText() };
  return { kind: "other" };
}

module.exports = function registerDialogueTools(ctx) {
  const { core, tool, z, player, find, send, status, sleepTicks } = ctx;
  const { MultiChatboxPrompt } = core;

  tool(
    "dialogue",
    "Read the open dialogue: kind (npc/player/statement/item/options), speaker, text, and options to pick from. Returns null when no dialogue is open.",
    { player },
    ({ player: username }) => readDialogue(core, find(username))
  );

  tool(
    "dialogue_continue",
    "Click to continue the open dialogue (\"Click here to continue\"), then return the next dialogue (null if it ended) and player status.",
    { player },
    async ({ player: username }) => {
      const p = find(username);
      const dialogue = readDialogue(core, p);
      if (!dialogue) throw new Error("No dialogue is open");
      if (dialogue.kind === "options") throw new Error(`Pick an option with dialogue_choose: ${dialogue.options.join(" | ")}`);
      send(p, { type: "dialogue_continue", widgetId: p.getPacketSender().getChatboxGroupId() << 16, childIndex: -1 });
      await sleepTicks(1);
      return { dialogue: readDialogue(core, find(username)), ...status(find(username)) };
    }
  );

  tool(
    "dialogue_choose",
    "Pick an option in the open options dialogue by its text (exact or partial, e.g. \"Yes\") or its 1-based number, then return the next dialogue and player status.",
    { player, option: z.union([z.string().min(1), z.number().int().min(1).max(5)]) },
    async ({ player: username, option }) => {
      const p = find(username);
      const dialogue = readDialogue(core, p);
      if (dialogue?.kind !== "options") throw new Error(dialogue ? "This dialogue has no options; use dialogue_continue" : "No dialogue is open");
      const lower = String(option).toLowerCase();
      let index = typeof option === "number" ? option - 1 : dialogue.options.findIndex((o) => o.toLowerCase() === lower);
      if (index < 0) index = dialogue.options.findIndex((o) => o.toLowerCase().includes(lower));
      if (!dialogue.options[index]) throw new Error(`No option "${option}"; options: ${dialogue.options.join(" | ")}`);
      const prompt = MultiChatboxPrompt.getPending(p);
      const groupId = p.getPacketSender().getChatboxGroupId();
      send(p, prompt
        ? { type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }
        : { type: "widget_action", widgetId: groupId << 16, groupId, childId: 0, buttonNum: index + 1 });
      await sleepTicks(1);
      return { chose: dialogue.options[index], dialogue: readDialogue(core, find(username)), ...status(find(username)) };
    }
  );
};
