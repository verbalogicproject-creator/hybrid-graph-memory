import { MemoryEngine } from "../core/engine";
import { ThreeJSGraphRenderer, VisNode, VisEdge, GraphData } from "./threejs_renderer";

export class GraphExporter {
  private engine: MemoryEngine;

  constructor(engine: MemoryEngine) {
    this.engine = engine;
  }

  public async exportToHtml(outputPath: string, title: string = "Knowledge Graph 3D"): Promise<string> {
    const relations = this.engine.getAllRelations();

    // Fetch chunk metadata for rich descriptions
    const chunks = (this.engine as any).db.db.prepare("SELECT file_id, symbol_name, content FROM chunks").all();
    const chunkMap = new Map<string, string>();
    for (const chunk of chunks) {
      if (chunk.symbol_name) {
        chunkMap.set(chunk.symbol_name, chunk.content.substring(0, 300) + (chunk.content.length > 300 ? "..." : ""));
      } else if (chunk.file_id) {
        // Just keep the first chunk of the file if no symbol
        if (!chunkMap.has(chunk.file_id)) {
          chunkMap.set(chunk.file_id, chunk.content.substring(0, 300) + (chunk.content.length > 300 ? "..." : ""));
        }
      }
    }

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
          description: chunkMap.get(rel.fromId) || `Component/Module ${rel.fromId}`,
        });
      }
      if (!nodesMap.has(rel.toId)) {
        nodesMap.set(rel.toId, {
          id: rel.toId,
          name: rel.toId,
          type: this.guessNodeType(rel.toId),
          description: chunkMap.get(rel.toId) || `Component/Module ${rel.toId}`,
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
