import fs from "node:fs";
import path from "node:path";

export interface VisNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  degree?: number;
}

export interface VisEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: VisNode[];
  edges: VisEdge[];
}

export class ThreeJSGraphRenderer {
  private generateColorPalette(nodeTypes: Set<string>): Record<string, string> {
    const predefined: Record<string, string> = {
      claude_api_feature: "#2a9fd6",
      category: "#9b59b6",
      atomic_capability: "#e74c3c",
      pattern: "#f39c12",
      meta: "#1abc9c",
      gemini_pattern: "#3498db",
      component: "#4CAF50",
      module: "#2196F3",
      store: "#9C27B0",
      api_route: "#FF9800",
      class: "#E91E63",
      interface: "#00BCD4",
      memory: "#ffeb3b",
      chunk: "#795548",
      file: "#607d8b",
      unknown: "#888888",
    };

    const colors: Record<string, string> = {};
    for (const nodeType of nodeTypes) {
      if (predefined[nodeType]) {
        colors[nodeType] = predefined[nodeType];
      } else {
        const randomColor = Math.floor(Math.random() * 16777215).toString(16);
        colors[nodeType] = "#" + randomColor.padStart(6, "0");
      }
    }
    return colors;
  }

  private generateLegendHtml(colors: Record<string, string>): string {
    const items = Object.entries(colors).sort((a, b) => a[0].localeCompare(b[0])).map(([nodeType, color]) => {
      return `<div class="legend-item">
        <div class="legend-color" style="background-color: ${color};"></div>
        <span>${nodeType}</span>
      </div>`;
    });
    return items.join("");
  }

  public generateHtml(graphData: GraphData, outputPath: string, title: string = "Knowledge Graph 3D"): string {
    const nodeTypes = new Set(graphData.nodes.map((n) => n.type || "unknown"));
    const colors = this.generateColorPalette(nodeTypes);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { margin: 0; overflow: hidden; font-family: sans-serif; background: #0a0e27; color: white; }
        #graph-container { width: 100vw; height: 100vh; }
        #ui-panel {
            position: absolute; top: 10px; left: 10px;
            background: rgba(10, 14, 39, 0.9);
            padding: 15px; border-radius: 8px; border: 1px solid #2a9fd6;
            max-width: 300px;
            pointer-events: none;
        }
        .legend-item { display: flex; align-items: center; margin: 5px 0; font-size: 12px; }
        .legend-color { width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; }
    </style>
    <!-- Use 3d-force-graph CDN for robust WebGL rendering and physics -->
    <script src="https://unpkg.com/3d-force-graph"></script>
</head>
<body>
    <div id="graph-container"></div>
    
    <div id="ui-panel">
        <h2 style="margin: 0 0 10px 0; font-size: 16px; color: #2a9fd6;">${title}</h2>
        <div style="font-size: 12px; margin-bottom: 10px;">
            Nodes: ${graphData.nodes.length} <br>
            Edges: ${graphData.edges.length}
        </div>
        <h3 style="margin: 10px 0 5px 0; font-size: 14px; color: #2a9fd6;">Types</h3>
        ${this.generateLegendHtml(colors)}
    </div>

    <script>
        const graphData = ${JSON.stringify(graphData)};
        const colors = ${JSON.stringify(colors)};
        
        // Map edges to source/target for 3d-force-graph
        const gData = {
            nodes: graphData.nodes.map(n => ({ id: n.id, name: n.name, type: n.type })),
            links: graphData.edges.map(e => ({ source: e.source, target: e.target, type: e.type }))
        };

        const elem = document.getElementById('graph-container');

        try {
            const Graph = ForceGraph3D()(elem)
                .graphData(gData)
                .nodeAutoColorBy('type')
                .nodeColor(node => colors[node.type] || '#8888')
                .nodeLabel(node => \`\${node.type}: \${node.name}\`)
                .linkColor(() => 'rgba(255,255,255,0.2)')
                .linkWidth(0.5)
                .backgroundColor('#0a0e27');

            // Fit to canvas on load
            Graph.onEngineStop(() => {
                Graph.zoomToFit(400);
            });
        } catch (err) {
            elem.innerHTML = '<div style="padding: 20px; color: #ff5555;">WebGL failed to initialize. Your viewer may not support 3D contexts.</div>';
        }
    </script>
</body>
</html>`;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, "utf8");
    return outputPath;
  }
}
