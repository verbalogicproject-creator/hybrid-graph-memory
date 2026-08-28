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
      const receipts = engine.getLegacyEvidenceReferences();
      console.log(`\n📋 Unverified legacy evidence references (${receipts.length} found):`);
      receipts.slice(0, 10).forEach((r) => {
        console.log(`- [${r.evidenceStatus}] ${r.incidentType} (ID: ${r.id}) | Target: ${r.targetFramework || "unspecified"}`);
      });
      console.log("");
    } else if (p.action === "sleep") {
      console.error("\n❌ Global-hive export is disabled until an allowlisted privacy contract and adversarial suite are implemented.\n");
    }
  }
}
