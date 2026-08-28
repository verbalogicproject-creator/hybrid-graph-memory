import { MemoryEngine } from "../core/engine";
import { ThreeJSGraphRenderer, VisNode, VisEdge, GraphData } from "./threejs_renderer";

export class GraphExporter {
  private engine: MemoryEngine;

  constructor(engine: MemoryEngine) {
    this.engine = engine;
  }

  public getGraphData(): { graphData: GraphData, colors: Record<string, string>, legendHtml: string } {
    const relations = this.engine.getAllRelations();
    const fs = require("node:fs");
    const path = require("node:path");

    // Load Louvain Communities for topological colors
    const communityMapPath = path.join((this.engine as any).config.dbPath, "../multi_agent_communities.json");
    let nodeToCommunity = new Map<string, string>();
    if (fs.existsSync(communityMapPath)) {
      const comms = JSON.parse(fs.readFileSync(communityMapPath, "utf8"));
      for (const [commId, nodes] of Object.entries(comms)) {
        (nodes as string[]).forEach(n => nodeToCommunity.set(n, `Community ${commId}`));
      }
    }

    // Compute Degree Centrality for node sizing (gravity)
    const degreeMap = new Map<string, number>();
    relations.forEach(rel => {
      degreeMap.set(rel.fromId, (degreeMap.get(rel.fromId) || 0) + 1);
      degreeMap.set(rel.toId, (degreeMap.get(rel.toId) || 0) + 1);
    });

    // Fetch chunk metadata for rich descriptions
    const chunks = (this.engine as any).db.db.prepare("SELECT file_id, symbol_name, content FROM chunks").all();
    const chunkMap = new Map<string, string>();
    for (const chunk of chunks) {
      if (chunk.symbol_name) {
        chunkMap.set(chunk.symbol_name, chunk.content.substring(0, 300) + (chunk.content.length > 300 ? "..." : ""));
      } else if (chunk.file_id) {
        if (!chunkMap.has(chunk.file_id)) {
          chunkMap.set(chunk.file_id, chunk.content.substring(0, 300) + (chunk.content.length > 300 ? "..." : ""));
        }
      }
    }

    const nodesMap = new Map<string, VisNode>();
    const edges: VisEdge[] = [];

    const getBaseNode = (id: string): VisNode => {
      return {
        id,
        name: id,
        type: nodeToCommunity.get(id) || this.guessNodeType(id),
        description: chunkMap.get(id) || `Component/Module ${id}`,
        val: Math.log((degreeMap.get(id) || 1) + 2) * 5, // Topological Node Gravity
      };
    };

    for (const rel of relations) {
      if (!nodesMap.has(rel.fromId)) nodesMap.set(rel.fromId, getBaseNode(rel.fromId));
      if (!nodesMap.has(rel.toId)) nodesMap.set(rel.toId, getBaseNode(rel.toId));

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
    const nodeTypes = new Set(graphData.nodes.map((n) => n.type || "unknown"));
    const colors = (renderer as any).generateColorPalette(nodeTypes);
    const legendHtml = (renderer as any).generateLegendHtml(colors);

    return { graphData, colors, legendHtml };
  }

  public async exportToHtml(outputPath: string, title: string = "Knowledge Graph 3D"): Promise<string> {
    const { graphData } = this.getGraphData();
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
