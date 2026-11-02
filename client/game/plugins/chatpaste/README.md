# Chat Paste

Ctrl+V (Cmd+V on a Mac) types the clipboard's text into the game: the chatbox, or whatever text
input is open (a bank search, an amount, a name). Not a RuneLite plugin; asked for in issue
#1930. Turn it on in the plugin list; it is off on fresh installs.

Line breaks and tabs become spaces, characters the game's fonts can't draw are dropped, and the
text is cut to 80 characters (the longest chat line). Pastes into the page's own fields, such as
the plugin panels, are left to them.

The game normally swallows every key press, so while this plugin is on Ctrl+V goes to the
browser, which then hands the plugin the clipboard text. No clipboard permission is needed.
