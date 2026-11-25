const fs = require('fs');

/** Write JSON so that a crash or power cut never leaves a half-written file. */
function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { writeJsonAtomic };
