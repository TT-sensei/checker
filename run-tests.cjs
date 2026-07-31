"use strict";

const core = require("./core.js");
const result = core.runTrackerTests();

if (result.failed > 0) {
  process.exitCode = 1;
}
