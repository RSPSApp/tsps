// Add/remove ignore is client-protocol-blocked - xrsps-typescript's client has
// no way to send these actions at all (no message type exists for them). See
// docs/networking-protocol-gaps.md. The handler used to be wired up via the dead
// registerAlivePacketListener/PACKETS dispatch, which never actually ran once
// elvarg switched to NetworkBuilder.ts's live dispatch; removed along with the
// rest of that dead system.

module.exports = {
  name: "IgnoreList",
  description: "Reserved for the ignore list. Nothing is attached yet because the client does not send add or remove actions.",
  register(api) {},
};
