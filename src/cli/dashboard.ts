import prompts from "prompts";
import { MemoryEngine } from "../core/engine";

export async function runDashboard(engine: MemoryEngine) {
  console.log("\n🎛️ Memory Dashboard: Causal Receipts & Consolidation\n");

  let running = true;
  while (running) {
    const p = await prompts({
      type: "select",
      name: "action",
      message: "Dashboard Options:",
      choices: [
        { title: "Browse SAG Receipts (Causal Memory)", value: "receipts" },
        { title: "Trigger Active Consolidation (Sleep Cycle)", value: "sleep" },
        { title: "Return to Main Menu", value: "back" }
      ]
    });

    if (p.action === "back" || !p.action) {
      running = false;
      break;
    }

    if (p.action === "receipts") {
      const receipts = (engine as any).db.getReceipts();
      console.log(`\n📋 Recent SAG Receipts (${receipts.length} found):`);
      receipts.slice(0, 10).forEach((r: any) => {
        console.log(`- [${r.level}] ${r.incidentType} (ID: ${r.id}) | Target: ${r.targetFramework}`);
      });
      console.log("");
    } else if (p.action === "sleep") {
      console.log("\n💤 Initiating Active Consolidation (Sleep Cycle)...");
      try {
        const stats = engine.db.consolidateToGlobalHive();
        console.log(`✅ Consolidation complete. Scrubbed and merged ${stats.scrubbed} heuristics into global-hive.db.\n`);
      } catch (err: any) {
        console.error(`❌ Consolidation failed: ${err.message}\n`);
      }
    }
  }
}
