// Port tasks (courier and bounty tasks): notice boards, ledger tables, the cargo hold's crates,
// port masters, the reward bags and bounties' parts. See
// docs/port-tasks.md.
const common = require("./porttasks/Common.PortTasks");

function sendState({ player }) {
  common.sendSlots(player);
  const completed = player.getAttribute(common.COMPLETED_ATTRIBUTE);
  if (completed) player.getPacketSender().sendConfig(common.VARP_TASKS_COMPLETED, completed.total ?? 0);
}

function answerOpenSlot(request) {
  const { player } = request;
  const slots = common.slots(player);
  request.available = slots.slice(0, common.slotLimit(player)).some((slot) => !slot);
}

module.exports = {
  name: "SailingPortTasks",
  description: "Sailing port tasks: courier and bounty tasks from notice boards and ledger tables, port masters and reward bags.",
  members: true,
  register(api) {
    common.init(api);
    api.persistAttribute(common.SLOTS_ATTRIBUTE);
    api.onCustomEvent("sailing:has-port-task-slot", answerOpenSlot);
    api.onPlayerLogin(sendState);
    require("./porttasks/Cargo.PortTasks")(api);
    require("./porttasks/Board.PortTasks")(api);
    require("./porttasks/Ledger.PortTasks")(api);
    require("./porttasks/PortMaster.PortTasks")(api);
    require("./porttasks/Log.PortTasks")(api);
    require("./porttasks/Bags.PortTasks")(api);
    require("./porttasks/Bounty.PortTasks")(api);
  },
};
