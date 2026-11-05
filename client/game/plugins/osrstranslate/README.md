# OSRS Translate PT-BR

A port of the RuneLite Plugin Hub plugin
[OSRS Translate PT-BR](https://github.com/walterrezende12-tech/Traducao-OSRS-BR) by Walter Rezende
(BSD-2, see `LICENSE`), at its Hub commit `5d038acc`. It shows the game in Brazilian Portuguese
or Spanish. Turn it on in the plugin list; it is off on fresh installs.

## Where the translations come from

The plugin ships no translations. Like the original, it reads the author's dictionaries from
[osrs-translate-translations](https://github.com/walterrezende12-tech/osrs-translate-translations)
when it starts, and checks for a new version every hour:

- `manifest.json` on `raw.githubusercontent.com` lists each language's nine JSON files, each
  pinned to a commit with its SHA-256. (The original reads it through `api.github.com`, which
  allows 60 requests an hour per address.)
- A release is used only when every file matches its hash. A failed download keeps the
  dictionaries already loaded, and a player who is offline gets the last release from the cache.
- Files are kept in the browser's Cache API under `osrs-translate::v1`. Downloading and parsing
  (about 25 MB a language) happen in a Web Worker.

Turning the plugin on therefore sends requests, and the player's address, to GitHub. Nothing is
requested while it is off.

## tsps's additions

Entries tsps contributes to the author's dictionaries (pull requests #4, #5 and #6 there, and
branches still to be opened; the additions files list their commits) are also
bundled with the client, in `client/public/osrstranslate/`, so players get them before he merges:
All Settings window text, the welcome screen's membership box, diary messages, missing dialogue
and game messages, and fixes such as "No pasa Nothing interesante.". They are fetched with the
release and applied on top of it:

- an addition only where the author's dictionary has no entry for that text;
- a fix only where his entry is still exactly the text it corrects.

So once he merges and republishes, his entries take over and the bundled ones go unused. Rebuild
the files with `client/scripts/osrs-translate-additions.mjs`; `client/public/osrstranslate/LICENSE.md`
says where they come from.

## What it translates

The original's areas, each with its own setting: dialogue and options, the skill guide, the
quest journal, achievement diaries, books and notes, clue scroll text, menu options (and the
interfaces upstream reads from the menu dictionary), NPC overhead text, game messages, the
welcome screen and the settings interfaces.

Only the drawn text changes. The original rewrites widget text, menu entries and chat messages
and then undoes that for other plugins (it translates a clicked option back before Menu Entry
Swapper and examine plugins see it). Here the client's data stays as the game sent it:

- Interface text is replaced as it is drawn (`widgetDisplayText`). A text is routed by its own
  component, then by the component it sits in, then by its interface group:
  - components: the chatbox's tab labels and their On/Off lines, and nothing else in the chatbox
    (chat lines, input and search prompts are never touched);
  - containers: the toplevel mouseover layers (prayer, skill and orb tooltips, "/ N more
    options") and the spellbook's tooltip box, whose text scripts create;
  - groups: the original's interfaces, plus (setting "Traduzir painéis laterais") the quest list,
    character summary, settings side tab, combat options, friends, ignore, logout, music and
    worn equipment panels.
  Each route reads one or more dictionaries in order. Panels that show player names (friends,
  ignore, the character summary) never read the general dictionary, whose one-word keys could
  match a name.
- Menu options are replaced where the menu and mouseover text are drawn
  (`ui/menu/menuOptionDisplayText.ts`). Clicks, Menu Entry Swapper and the server see English.
- Game messages are replaced in RuneLite's `chatMessageBuilding` chatbox callback, before the
  line is measured. The chat history keeps the game's text.
- NPC overhead text goes through `npcOverheadText` when it arrives, as players' overhead chat goes
  through Chat Filter's `overheadChatText`: the translated text is what the NPC's overhead slot
  holds, and only the renderers read that slot. Players' overhead chat is not translated.

Dialogue arrives from the server already wrapped at 53 characters, with a line height chosen
for the English line count. The plugin joins the lines to find the translation, and when the
translation needs more lines than fit, it draws with a smaller line height ("Espaçamento entre
linhas"; the original sets a fixed 18).

## Measuring coverage

`::translatecoverage on` starts a developer counter; `::translatecoverage report` prints the share
of distinct texts translated and lists the English that remains in the browser console (and in
`window.__osrsTranslateCoverage`); `reset` and `off` do what they say. It counts what the plugin
is asked about: interface text, menu options, game messages and NPC overhead text. Menu targets,
world map labels, other plugins' overlays, React panels and the login screen never pass the
plugin, so they aren't counted.

## Not the same as the original

- No developer mode: a browser can't read a local folder of JSON files.
- The client's own login screen is not an OSRS interface, so only the in-game welcome screen is
  translated.
- Option dialogues size their rows from the English text, so an option whose translation needs
  two lines overlaps the next one.
- Translations match the game's text. Text written for this server that the game doesn't have
  stays in English, as does game text the dictionaries have no entry for (the welcome screen's
  membership box, diary task-completed messages, the character summary, spell and prayer
  tooltips).
- Journals (quest journal and scroll, diary scroll, books) send one line per component, as the
  game does, so a task wrapped over two lines ("Have Wizard Cromperty teleport you to the Rune
  Essence" / "mine.") matches no key alone; the original leaves those in English. Here a line
  with no translation is joined with up to three neighbours, and when the joined sentence is a
  key its translation is wrapped and shared out over those lines. A shorter translation leaves
  the spare lines blank.
- The skill guide (skill_guide_v2) lays its paragraphs out one word per component, so the
  original can't translate them. Here the guide's body is translated as script 9183 starts, while
  its argument is still on the stack (`onScriptPreFired` gets the VM for scripts invoked by
  another), and the game lays the translation out itself: it wraps, sizes the scroll area and
  never overlaps. A translated paragraph keeps its links (still clickable) but moves them to its
  end, and drops highlight tags. The words' components then hold the translation; only the guide
  reads them.
- A placeholder is filled from the game's coloured text where it matches, so a music unlock
  keeps its red track name (the original loses the colour).
- The settings panel follows the chosen language, as the original's does, including the
  settings view's Back, Reset and reset question. The view takes those from the config group's
  optional `viewLabels`, so other plugins keep the English ones.
