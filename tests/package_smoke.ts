import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function main() {
  const root = process.env.MEMORY_PACKAGE_ROOT
    ? path.resolve(process.env.MEMORY_PACKAGE_ROOT)
    : path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "memory-package-"));
  try {
    const output = execFileSync("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", temp,
    ], { cwd: root, encoding: "utf8" });
    const receipt = JSON.parse(output)[0];
    const names = receipt.files.map((file: { path: string }) => file.path).sort();
    assert(names.includes("dist/src/index.js"));
    assert(names.includes("dist/src/index.d.ts"));
    assert(names.includes("dist/bin/agy-memory.js"));
    assert(names.includes("dist/src/python/ultra_bridge.py"));
    assert(names.includes("dist/src/python/requirements-ultra.txt"));
    assert(names.includes("LICENSE"));
    assert.equal(names.some((name: string) => name.startsWith("src/") || name.startsWith("tests/") || name.startsWith("research/")), false);

    const consumer = path.join(temp, "consumer");
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({
      private: true,
      // The offline qualification cache has this compatible tarball; pinning avoids
      // npm selecting a newer uncached @types/node transitively from protobufjs.
      overrides: { "@types/node": "22.20.1" },
    }), "utf8");
    const tarball = path.join(temp, receipt.filename);
    execFileSync("npm", [
      "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
      "--omit=dev", "--omit=optional", "--legacy-peer-deps", tarball,
    ], { cwd: consumer, stdio: "pipe" });
    const packageRoot = path.join(consumer, "node_modules", "antigravity-memory-os");
    const loaded = require(packageRoot);
    assert.equal(typeof loaded.MemoryEngine, "function");
    const binPath = path.join(packageRoot, "dist", "bin", "agy-memory.js");
    assert.equal(fs.readFileSync(binPath, "utf8").startsWith("#!/usr/bin/env node"), true);
    const help = execFileSync(process.execPath, [binPath, "--help"], { cwd: consumer, encoding: "utf8" });
    assert.match(help, /Usage:/);
    console.log("package smoke: pass");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
