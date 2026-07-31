"use strict";

const core = require("../js/core.js");
const result = core.runTrackerTests();

if (result.failed > 0) {
  process.exitCode = 1;
}
