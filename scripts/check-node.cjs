const { readFileSync } = require("node:fs");
const path = require("node:path");

const minimumVersion = readFileSync(
  path.join(__dirname, "..", ".node-version"),
  "utf8",
).trim();

/** @param {string} version */
function parseStableVersion(version) {
  if (typeof version !== "string") return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

/**
 * Accept patched stable releases on the project's selected LTS major only.
 * @param {string} version
 * @param {string} minimum
 */
function supportsVersion(version, minimum = minimumVersion) {
  const current = parseStableVersion(version);
  const required = parseStableVersion(minimum);
  if (!current || !required || current[0] !== required[0]) return false;
  return (
    current[1] > required[1] ||
    (current[1] === required[1] && current[2] >= required[2])
  );
}

if (require.main === module) {
  if (supportsVersion(process.version)) {
    console.log(`[runtime] Node.js ${process.version} sürümü uygun.`);
  } else {
    console.error(
      `[runtime] Desteklenmeyen Node.js sürümü: ${process.version}.\n` +
        `DGTLFACE Panel için Node.js ${minimumVersion} veya aynı ana sürümün daha yeni kararlı bir sürümü gerekiyor.\n` +
        `Çalışan Node.js: ${process.execPath}\n` +
        "Node.js sürümünü güncelleyip komutu yeniden çalıştırın. nvm kullanıyorsanız: nvm install && nvm use",
    );
    process.exitCode = 1;
  }
}

module.exports = { minimumVersion, supportsVersion };
