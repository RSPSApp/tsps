# Inventory Tags

Enable **Inventory Tags**, then open its sidebar button. Enter a group name, choose a colour and enter comma-separated item IDs. **Edit**, **Save group** and **Remove** manage groups locally. Exact item IDs are used; noted, alternate and charged variants should be entered explicitly. The first matching group wins if an item belongs to several groups.

The generated configuration panel also exposes the groups as JSON, for bulk editing/export. Invalid JSON or groups hide tags and show an error in the sidebar until corrected. The form validates before saving, preserving previous settings on invalid input. Configuration uses the existing ConfigManager/local storage and never replaces settings at startup.

The overlay draws borders on live visible inventory item widgets, including dynamic children. It follows current layout bounds and suppresses drawing when the inventory is closed, hidden, logged out or the plugin stops. No game sprites or item data are changed.
