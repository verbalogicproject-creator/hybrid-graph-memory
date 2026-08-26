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
      console.log("Analyzing recent episodic memories and causal receipts...");
      await new Promise(r => setTimeout(r, 1500));
      console.log("Distilling noisy logs into heuristic rules...");
      await new Promise(r => setTimeout(r, 1000));
      console.log("✅ Consolidation complete. Heuristics added to global-hive.db (Simulated).\n");
    }
  }
}
