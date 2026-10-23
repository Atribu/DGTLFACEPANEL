import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { minimumVersion, supportsVersion } from "../scripts/check-node.cjs";

test("Node runtime rejects versions older than the security patch", () => {
  for (const version of ["v24.20.0", "24.22.0", "24.21.99"])
    assert.equal(supportsVersion(version), false, version);
});

test("Node runtime accepts the security patch and newer stable releases in the same major", () => {
  for (const version of ["24.22.1", "v24.22.1", "24.22.2", "24.23.0"])
    assert.equal(supportsVersion(version), true, version);
});

test("Node runtime rejects other majors, prereleases, and malformed versions", () => {
  for (const version of [
    "22.23.4", "25.0.0", "26.12.1", "24.23.0-rc.1", "24.22.1-nightly",
    "24.22", "24.022.1", "24.22.1+custom", "24.22.1\n", "not-a-version", "",
  ])
    assert.equal(supportsVersion(version), false, version);
});

test("Node version policy uses the requested minimum and keeps version manager files consistent", () => {
  assert.equal(supportsVersion("24.22.1", "24.23.0"), false);
  assert.equal(supportsVersion("24.23.0", "24.23.0"), true);
  assert.equal(supportsVersion("24.23.0", "invalid"), false);
  assert.equal(
    readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim(),
    minimumVersion,
  );
});

test("runtime CLI reports the actual runtime and exits unsuccessfully when it is unsupported", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/check-node.cjs", import.meta.url))],
    { encoding: "utf8" },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, supportsVersion(process.version) ? 0 : 1);
  assert.ok(`${result.stdout}${result.stderr}`.includes(process.version));
  if (!supportsVersion(process.version)) {
    assert.ok(result.stderr.includes(minimumVersion));
    assert.ok(result.stderr.includes(process.execPath));
  }
});
