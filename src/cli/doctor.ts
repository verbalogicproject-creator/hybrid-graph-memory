import prompts from "prompts";
import { MemoryEngine } from "../core/engine";

export async function runDoctor(engine: MemoryEngine) {
  console.log("\n🩺 Memory Doctor: Reviewing Quarantined Operational Assets...\n");

  const stmt = (engine as any).db.db.prepare(`
    SELECT id, title, target_framework, quarantine_reason, memory_type as type, admission_status
    FROM memories
    WHERE is_quarantined = 1
  `);
  
  const quarantinedMemories = stmt.all() as any[];

  const chunkStmt = (engine as any).db.db.prepare(`
    SELECT id, target_framework, quarantine_reason
    FROM chunks
    WHERE is_quarantined = 1
  `);
  const quarantinedChunks = chunkStmt.all() as any[];

  const total = quarantinedMemories.length + quarantinedChunks.length;

  if (total === 0) {
    console.log("✅ No quarantined assets found. System is healthy.\n");
    return;
  }

  console.log(`⚠️ Found ${total} quarantined assets due to Ripple Decay or dependency drift.\n`);

  for (const asset of quarantinedMemories) {
    console.log(`--- [Asset ID: ${asset.id}] ---`);
    console.log(`Type: ${asset.type}`);
    console.log(`Title: ${asset.title}`);
    console.log(`Target Framework: ${asset.target_framework}`);
    console.log(`Reason: ${asset.quarantine_reason}`);
    
    const action = await prompts({
      type: "select",
      name: "decision",
      message: "Action:",
      choices: [
        { title: "Re-validate (Clear quarantine)", value: "validate" },
        { title: "Delete Asset", value: "delete" },
        { title: "Skip", value: "skip" }
      ]
    });

    if (action.decision === "validate") {
      (engine as any).db.db.prepare(`UPDATE memories SET is_quarantined = 0, quarantine_reason = NULL WHERE id = ?`).run(asset.id);
      console.log(`✅ Asset ${asset.id} re-validated.\n`);
    } else if (action.decision === "delete") {
      (engine as any).db.db.prepare(`DELETE FROM memories WHERE id = ?`).run(asset.id);
      console.log(`🗑️ Asset ${asset.id} deleted.\n`);
    }
  }
}
