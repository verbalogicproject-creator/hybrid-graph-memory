import fs from "node:fs";
import path from "node:path";
import { MemoryDatabase } from "../core/database";

export class RippleDecayHook {
  constructor(private db: MemoryDatabase, private workspaceRoot: string) {}

  public execute() {
    const pkgJsonPath = path.join(this.workspaceRoot, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      return;
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

      const chunks = this.db.getAllChunksWithEmbeddings();
      const memories = (this.db as any).getAllMemoriesWithEmbeddings();

      const processAsset = (asset: any, table: "chunks" | "memories") => {
        if (!asset.targetFramework) return;

        // Parse targetFramework (e.g. "next@15.x" or "next")
        const match = asset.targetFramework.match(/^([a-zA-Z0-9_-]+)(?:@(.*))?$/);
        if (!match) return;

        const pkgName = match[1];
        const targetVersion = match[2];

        const currentVersion = dependencies[pkgName];
        
        // If the package exists in the current project but the version drifted significantly
        // (Simplified check for demonstration: if version changed at all, flag it)
        if (currentVersion && targetVersion && !currentVersion.includes(targetVersion.replace(".x", ""))) {
          if (!asset.isQuarantined) {
            (this.db as any).db.prepare(`UPDATE ${table} SET is_quarantined = 1, quarantine_reason = ? WHERE id = ?`).run(
              `Dependency drift: asset targeted ${pkgName}@${targetVersion}, project uses ${currentVersion}`,
              asset.id
            );
            console.log(`[Ripple Decay] Quarantined ${table} asset ${asset.id} due to dependency drift.`);
          }
        }
      };

      for (const c of chunks) processAsset(c, "chunks");
      for (const m of memories) processAsset(m, "memories");

    } catch (e: any) {
      console.error("[Ripple Decay] Failed to process package.json:", e.message);
    }
  }
}
