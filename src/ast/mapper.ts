import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface ComponentInfo {
  name: string;
  kind: "component" | "module" | "store" | "api_route";
  filePath: string;
  imports: Array<{ symbol: string; from: string }>;
  exports: string[];
  stateDependencies: string[];
  renders: string[];
  invokes: string[];
}

export interface AstGraphMap {
  components: Map<string, ComponentInfo>;
  relations: Array<{ from: string; rel: string; to: string; weight: number }>;
}

export class AstDependencyMapper {
  private projectRoot: string;
  private targetDirs: string[];

  constructor(
    projectRoot: string = process.cwd(),
    targetDirs: string[] = ["components", "app", "lib", "memory", "src", "types"]
  ) {
    this.projectRoot = path.resolve(projectRoot);
    this.targetDirs = targetDirs;
  }

  public collectSourceFiles(): string[] {
    const files: string[] = [];

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name.endsWith(".d.ts")
        ) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        ) {
          files.push(fullPath);
        }
      }
    };

    for (const subDir of this.targetDirs) {
      walk(path.join(this.projectRoot, subDir));
    }

    return files;
  }

  public analyzeFile(filePath: string): ComponentInfo {
    const relativeFilePath = path.relative(this.projectRoot, filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const baseName = path.basename(filePath, path.extname(filePath));
    let inferredName = baseName;
    if (baseName === "route" || baseName === "page") {
      const parentDir = path.basename(path.dirname(filePath));
      inferredName = `${parentDir}_${baseName}`;
    }

    let kind: ComponentInfo["kind"] = "module";
    if (filePath.endsWith(".tsx")) {
      kind = "component";
    } else if (filePath.includes("store")) {
      kind = "store";
    } else if (filePath.includes("route.ts") || filePath.includes("api/")) {
      kind = "api_route";
    }

    const imports: ComponentInfo["imports"] = [];
    const exports: string[] = [];
    const stateDependencies: string[] = [];
    const renders: string[] = [];
    const invokes: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
        if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const elem of node.importClause.namedBindings.elements) {
            imports.push({ symbol: elem.name.text, from: moduleSpecifier });
          }
        }
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          exports.push(node.name.text);
        }
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        if (/^[A-Z]/.test(tagName) && !renders.includes(tagName)) {
          renders.push(tagName);
        }
      }

      if (ts.isCallExpression(node)) {
        const callText = node.expression.getText(sourceFile);
        if (callText.includes("useStudioStore") || callText.includes("useStore")) {
          const fullExpr = node.getText(sourceFile);
          if (!stateDependencies.includes(fullExpr)) {
            stateDependencies.push(fullExpr);
          }
        }
        if (/^[A-Z]/.test(callText) || callText.startsWith("compile") || callText.startsWith("fetch")) {
          if (!invokes.includes(callText)) {
            invokes.push(callText);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      name: inferredName,
      kind,
      filePath: relativeFilePath,
      imports,
      exports,
      stateDependencies,
      renders,
      invokes,
    };
  }

  public mapProject(): AstGraphMap {
    const files = this.collectSourceFiles();
    const components = new Map<string, ComponentInfo>();
    const relations: AstGraphMap["relations"] = [];

    for (const file of files) {
      const info = this.analyzeFile(file);
      components.set(info.name, info);
    }

    for (const [name, info] of components.entries()) {
      for (const rendered of info.renders) {
        relations.push({ from: name, rel: "renders", to: rendered, weight: 1.5 });
      }
      for (const imp of info.imports) {
        const importedBase = path.basename(imp.from).replace(/\.[^/.]+$/, "");
        if (components.has(importedBase)) {
          relations.push({ from: name, rel: "depends_on", to: importedBase, weight: 1.2 });
        }
      }
    }

    return { components, relations };
  }

  public generateCtxContent(): string {
    const { components, relations } = this.mapProject();
    const lines: string[] = [];

    lines.push("# =============================================================================");
    lines.push("# AST GRAPH-RAG ARCHITECTURAL DEPENDENCY SPECIFICATION (AUTOGENERATED)");
    lines.push(`# Generated At: ${new Date().toISOString()}`);
    lines.push("# =============================================================================");
    lines.push("");

    for (const [name, info] of components.entries()) {
      lines.push(`@${info.kind} ${name} {`);
      lines.push(`  file: "${info.filePath}"`);
      if (info.exports.length > 0) {
        lines.push(`  exports: [${info.exports.map((e) => `"${e}"`).join(", ")}]`);
      }
      if (info.renders.length > 0) {
        lines.push(`  renders: [${info.renders.map((r) => `"${r}"`).join(", ")}]`);
      }
      lines.push("}");
      lines.push("");
    }

    lines.push("# Directional GraphRAG Relations");
    for (const rel of relations) {
      lines.push(`@relation ${rel.from} ${rel.rel} ${rel.to} (weight=${rel.weight.toFixed(1)})`);
    }

    return lines.join("\n");
  }
}
