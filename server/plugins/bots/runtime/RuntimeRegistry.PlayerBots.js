"use strict";

let activeRuntime = null;
let activeBehaviorMode = null;
let activeBrainRegistry = null;

function setActiveBotRuntime(runtime, behaviorMode, brainRegistry = null) {
  activeRuntime = runtime ?? null;
  activeBehaviorMode = behaviorMode ?? null;
  activeBrainRegistry = brainRegistry ?? null;
}

function getActiveBotRuntime() {
  return {
    runtime: activeRuntime,
    behaviorMode: activeBehaviorMode,
    brainRegistry: activeBrainRegistry,
  };
}

module.exports = {
  setActiveBotRuntime,
  getActiveBotRuntime,
};
