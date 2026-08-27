import { MemoryEngine } from "../core/engine";
import { ThreeJSGraphRenderer, VisNode, VisEdge, GraphData } from "./threejs_renderer";

export class GraphExporter {
  private engine: MemoryEngine;

  constructor(engine: MemoryEngine) {
    this.engine = engine;
  }

  public async exportToHtml(outputPath: string, title: string = "Knowledge Graph 3D"): Promise<string> {
    // 1. Fetch relations
    const relations = this.engine.getAllRelations();

    const nodesMap = new Map<string, VisNode>();
    const edges: VisEdge[] = [];

    // The MemoryEngine doesn't have a direct getNodes() because nodes are derived from files/chunks/memories/AST baseNames
    // We can infer nodes from the relations.
    for (const rel of relations) {
      if (!nodesMap.has(rel.fromId)) {
        nodesMap.set(rel.fromId, {
          id: rel.fromId,
          name: rel.fromId,
          type: this.guessNodeType(rel.fromId),
          description: `Component/Module ${rel.fromId}`,
        });
      }
      if (!nodesMap.has(rel.toId)) {
        nodesMap.set(rel.toId, {
          id: rel.toId,
          name: rel.toId,
          type: this.guessNodeType(rel.toId),
          description: `Component/Module ${rel.toId}`,
        });
      }

      edges.push({
        source: rel.fromId,
        target: rel.toId,
        type: rel.relation,
      });
    }

    const graphData: GraphData = {
      nodes: Array.from(nodesMap.values()),
      edges: edges,
    };

    const renderer = new ThreeJSGraphRenderer();
    return renderer.generateHtml(graphData, outputPath, title);
  }

  private guessNodeType(id: string): string {
    if (id.includes("use") || id.toLowerCase().includes("store")) return "store";
    if (id.toLowerCase().includes("api") || id.toLowerCase().includes("route")) return "api_route";
    if (id.toLowerCase().includes("component") || /^[A-Z]/.test(id)) return "component";
    if (id.includes(".")) return "file";
    return "module";
  }
}
