import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "python");
const destination = path.join(root, "dist", "src", "python");
fs.mkdirSync(destination, { recursive: true });
for (const name of ["ultra_bridge.py", "requirements-ultra.txt"]) {
  fs.copyFileSync(path.join(source, name), path.join(destination, name));
}
