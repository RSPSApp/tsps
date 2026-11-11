# WASD Camera

All Settings > Controls > **WASD Camera**: W, A, S and D turn the camera, and Enter opens chat.
It is the camera part of RuneLite's Key Remapping (`keyremapping`), built into the browser
client. Upstream issue: RSPSApp/tsps#4424. Players on the official client through the RuneLite
gateway use RuneLite's own Key Remapping plugin; the gateway doesn't translate this one.

## Who gets it

- **Server owners** switch it on or off with the `WasdCamera` plugin on the world config page
  (`server/plugins/interface/WasdCamera.plugin.js`, on by default). At login it sends the client
  the `wasd-camera` plugin message; a world that doesn't send it has no WASD Camera row.
- **Players** turn it on in All Settings > Controls, at the end of the category, or by searching
  for "wasd". It is off until they do, and the choice is kept in the browser
  (`wasdCamera` in the client preferences, `osrs:clientPreferences`), so it survives a reload.

## While it's on

The chat line is locked and reads `Name: Press Enter to Chat...`.

- **W / S / A / D** are the Up / Down / Left / Right arrow keys, so they pitch and turn the
  camera exactly as the arrows do (and do whatever else the arrows do, such as the Isometric
  Camera's quarter turns).
- **The arrow keys** turn nothing: WASD replaces them.
- **Other keys** type nothing into chat. Dialogues, number-key options, Space to continue, the
  F-keys, `Ctrl+;` / `Ctrl+/` and the other shortcuts still get them.
- **Enter** opens the chat line, and keys type as normal. **Enter** again sends the message (an
  empty one sends nothing) and locks the line. **Escape** leaves the message: what was typed is
  cleared and the line locks, and the Escape closes nothing.

It never takes keys from anything else that listens for them. While a prompt (an amount, the
bank, Commands or All Settings search), a RuneLite chatbox input, a dialogue, or any open
interface with a key listener is up, or the chat line is hidden behind one, every key, the arrows
included, works as if WASD Camera were off. So do close camera (First Person), the editor's free
camera and the login screen.

## How it works

- `client/game/input/WasdCamera.ts` is the key handling, behind a `WasdCameraSetting`. It is
  `InputManager.keyRemapper`, which rewrites a key before filters, handlers or the game see it, as
  RuneLite's listener rewrites the KeyEvent's key code. A remapped key is released as the key it
  was pressed as. `client/game/chat/EnterToTypeChat.ts` is the Enter/Escape switch.
- Keys pressed while the line is locked are queued with `chatBlocked`, and the widget key
  dispatch skips the chatbox's own typing listener (chatbox:0, script 73) for them: RuneLite's
  `blockChatInput` callback in that script.
- The placeholder is written after the chat line's redraw (script 223), as RuneLite's
  `setChatboxInput` callback does; VarC 335 keeps what was typed.
- `AllSettingsToggle.ts` adds the row after the category's last row. All Settings rows come from
  cache structs and their state from script 6716, and a click is sent to the server as a slot in
  the list, so a cache row can't be added without moving every later row's slot. The row is
  drawn into the list instead, copying a row the cache built (its hover handler, script 244, and
  its text styles), and its click stays in the client. It is checked every frame, since the cache
  rebuilds the list whenever it changes, and the list's scroll height and scrollbar (script 72)
  are grown to fit it.
- `WasdCameraPlugin` is hidden from the plugin list and always running: the row is its switch.

## Differences from RuneLite

- Only the camera keys, fixed to W/A/S/D. RuneLite's configurable keybinds and its F-key, Escape,
  Space and Control remaps aren't here.
- RuneLite also opens the chat line on `/` and `:`, and locks it again on Backspace once the line
  is empty. Here only Enter opens it, and Enter or Escape lock it.
- RuneLite keeps the arrow keys working; here they turn nothing while WASD Camera is on.
- The row isn't a cache setting: the server doesn't save it, and it shows in a search only when
  the search matches its own terms (wasd, camera, keys, keyboard, arrow keys, controls, chat).
