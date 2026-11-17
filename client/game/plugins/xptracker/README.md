# XP Tracker

A port of RuneLite 1.13.3's XP Tracker. Turn it on in the plugin list; it is off on fresh
installs. Its sidebar button is "XP Tracker".

## Tracking

Each skill is tracked from the moment you log in. The stats sync at login doesn't count:
experience changes are ignored for two ticks after logging in or hopping. A skill gets a box
in the panel the first time it gains experience.

Each box shows four labels you can choose (XP gained, XP left, XP/hr, actions left by
default), and a progress bar from the start of the current level to the next. If you have
set an XP-drop goal for the skill in game, the bar runs to that goal instead. Hover the bar
for actions done, actions per hour and time to the goal. Click a box to make it compact, and
drag boxes to reorder them. The panel's top row shows total XP gained and XP per hour.

Rates count only time in which a skill is gaining and not paused, and never less than a
minute. "Actions" are experience drops; actions left use the average of the last ten.

## Right-click options

- **Overall row:** Reset All, Reset All/hr, Pause All, Unpause All.
- **Skill box:** Reset, Reset others, Reset/hr, Pause or Unpause, Add to canvas or Remove from canvas.
- **Stats tab:** right-click a skill for Add to canvas or Remove from canvas.

Reset starts a skill over and removes its box. Reset/hr restarts the rates and keeps the
experience gained. Any experience gain unpauses a skill.

## Canvas boxes

A canvas box shows the skill icon, two configurable lines and a progress bar. Alt-drag moves
it; each skill's box keeps its own position. Boxes are not kept between sessions, as in
RuneLite.

## Settings

The settings match RuneLite's names and defaults: Save between sessions, Hide maxed skills,
Pause on logout, Show intermediate level markers, Auto pause after, Auto reset after, the
four info box labels, the progress bar and tooltip labels, Move recently trained skills to
top, and an Overlay section for the canvas boxes and the stats tab option.

## Saving

Trackers are saved for each account every minute and when the client closes, in config group
`xpTracker` under `rsprofile.<account>.state` (on a Deadman, Leagues, tournament or PvP Arena
world, `rsprofile.<account>.<type>.state`), in RuneLite's XpSave shape. They are restored
at the next login if "Save between sessions" is on. Experience gained while logged out is not
counted as session experience. Reset All clears the save.

As in RuneLite, a change of account or of world type (RuneLite's XpWorldType: Deadman, Leagues,
tournament or PvP Arena, from the selected world's flags) starts the trackers over.

## Differences from RuneLite

- The Wise Old Man option and the RuneLite XP API update are left out; both are online
  services for real accounts.
- RuneLite keys saves by its RS profile; here the profile is the logged-in player's name and,
  off a normal world, its XpWorldType. RuneLite's profile types are finer (beta worlds and each
  league have their own).
- The world type is the flags of the world selected on the login screen. A WebRTC world reports
  none, so it counts as a normal world.
