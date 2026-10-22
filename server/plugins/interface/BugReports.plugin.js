"use strict";

module.exports = {
  name: "BugReports",
  register(api) {
    require("./bugreports/Channel.BugReports")(api);
  },
};
