import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { MemoryRelation } from "../core/types";
import { computeSha256 } from "../chunkers/code";

export interface ComponentInfo {
  name: string;
  kind: "component" | "module" | "store" | "api_route" | "class" | "interface";
  filePath: string;
  imports: Array<{ symbol: string; from: string }>;
  exports: string[];
  stateDependencies: string[];
  renders: string[];
  invokes: string[];
  extendsClasses?: string[];
  implementsInterfaces?: string[];
  referencedTypes?: string[];
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
    targetDirs: string[] = ["components", "app", "lib", "memory", "src", "types", "bin", "tests"]
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
          (entry.name.endsWith(".ts") ||
            entry.name.endsWith(".tsx") ||
            entry.name.endsWith(".js") ||
            entry.name.endsWith(".jsx"))
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
    return this.analyzeSource(relativeFilePath, content);
  }

  public analyzeSource(filePath: string, content: string): ComponentInfo {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const baseName = path.basename(filePath, path.extname(filePath));
    let inferredName = baseName;
    if (baseName === "route" || baseName === "page" || baseName === "index") {
      const parentDir = path.basename(path.dirname(filePath));
      inferredName = `${parentDir}_${baseName}`;
    }

    let kind: ComponentInfo["kind"] = "module";
    if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
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
    const extendsClasses: string[] = [];
    const implementsInterfaces: string[] = [];
    const referencedTypes: string[] = [];

    const visit = (node: ts.Node) => {
      // 1. Imports
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
        if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const elem of node.importClause.namedBindings.elements) {
            imports.push({ symbol: elem.name.text, from: moduleSpecifier });
          }
        } else if (node.importClause?.name) {
          imports.push({ symbol: node.importClause.name.text, from: moduleSpecifier });
        }
      }

      // 2. Classes (extends & implements)
      if (ts.isClassDeclaration(node) && node.name) {
        kind = "class";
        inferredName = node.name.text;
        if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          exports.push(node.name.text);
        }

        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
              for (const type of clause.types) {
                extendsClasses.push(type.expression.getText(sourceFile));
              }
            } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
              for (const type of clause.types) {
                implementsInterfaces.push(type.expression.getText(sourceFile));
              }
            }
          }
        }
      }

      // 3. Interfaces
      if (ts.isInterfaceDeclaration(node) && node.name) {
        if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          exports.push(node.name.text);
        }
        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            for (const type of clause.types) {
              extendsClasses.push(type.expression.getText(sourceFile));
            }
          }
        }
      }

      // 4. Function Declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          exports.push(node.name.text);
        }
      }

      // 5. JSX Render Elements
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        if (/^[A-Z]/.test(tagName) && !renders.includes(tagName)) {
          renders.push(tagName);
        }
      }

      // 6. Function Invocations & Calls
      if (ts.isCallExpression(node)) {
        const callText = node.expression.getText(sourceFile);
        if (callText.includes("useStudioStore") || callText.includes("useStore")) {
          const fullExpr = node.getText(sourceFile);
          if (!stateDependencies.includes(fullExpr)) {
            stateDependencies.push(fullExpr);
          }
        }
        const callSymbol = callText.split(".").pop() || callText;
        if (/^[A-Za-z0-9_]+$/.test(callSymbol) && !invokes.includes(callSymbol)) {
          invokes.push(callSymbol);
        }
      }

      // 7. Type References
      if (ts.isTypeReferenceNode(node)) {
        const typeName = node.typeName.getText(sourceFile);
        if (!["string", "number", "boolean", "any", "void", "unknown", "Promise", "Array", "Record"].includes(typeName)) {
          if (!referencedTypes.includes(typeName)) {
            referencedTypes.push(typeName);
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return {
      name: inferredName,
      kind,
      filePath,
      imports,
      exports,
      stateDependencies,
      renders,
      invokes,
      extendsClasses,
      implementsInterfaces,
      referencedTypes,
    };
  }

  public extractRelationsFromSource(
    filePath: string,
    content: string,
    workspace = "default",
    project = "default",
    module = "root"
  ): MemoryRelation[] {
    const info = this.analyzeSource(filePath, content);
    const relations: MemoryRelation[] = [];
    const now = Date.now();
    const baseName = info.name;

    // Helper for creating relation
    const addRel = (fromId: string, relation: string, toId: string, weight: number) => {
      const relHash = computeSha256(`${workspace}:${project}:${fromId}:${relation}:${toId}`).slice(0, 16);
      relations.push({
        id: `rel_${relHash}`,
        fromId,
        relation,
        toId,
        source: filePath,
        weight,
        confidence: 1.0,
        workspace,
        project,
        module,
        createdAt: now,
      });
    };

    // Class extends
    for (const parent of info.extendsClasses || []) {
      addRel(baseName, "extends", parent, 2.0);
    }

    // Class implements
    for (const iface of info.implementsInterfaces || []) {
      addRel(baseName, "implements", iface, 1.8);
    }

    // JSX renders
    for (const child of info.renders) {
      addRel(baseName, "renders", child, 1.5);
    }

    // Exported symbols
    for (const exp of info.exports) {
      if (exp !== baseName) {
        addRel(baseName, "defines", exp, 1.4);
      }
    }

    // Imports
    for (const imp of info.imports) {
      addRel(baseName, "imports_symbol", imp.symbol, 1.3);
      const modName = path.basename(imp.from).replace(/\.[^/.]+$/, "");
      addRel(baseName, "depends_on", modName, 1.2);
    }

    // Invocations
    for (const invoked of info.invokes) {
      if (invoked !== baseName && !info.exports.includes(invoked)) {
        addRel(baseName, "calls", invoked, 1.4);
      }
    }

    // Type references
    for (const t of info.referencedTypes || []) {
      if (t !== baseName) {
        addRel(baseName, "references_type", t, 1.1);
      }
    }

    return relations;
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
      for (const parent of info.extendsClasses || []) {
        relations.push({ from: name, rel: "extends", to: parent, weight: 2.0 });
      }
      for (const iface of info.implementsInterfaces || []) {
        relations.push({ from: name, rel: "implements", to: iface, weight: 1.8 });
      }
      for (const rendered of info.renders) {
        relations.push({ from: name, rel: "renders", to: rendered, weight: 1.5 });
      }
      for (const imp of info.imports) {
        const importedBase = path.basename(imp.from).replace(/\.[^/.]+$/, "");
        if (components.has(importedBase)) {
          relations.push({ from: name, rel: "depends_on", to: importedBase, weight: 1.2 });
        }
      }
      for (const invoked of info.invokes) {
        if (components.has(invoked)) {
          relations.push({ from: name, rel: "calls", to: invoked, weight: 1.4 });
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
      if (info.extendsClasses && info.extendsClasses.length > 0) {
        lines.push(`  extends: [${info.extendsClasses.map((e) => `"${e}"`).join(", ")}]`);
      }
      if (info.implementsInterfaces && info.implementsInterfaces.length > 0) {
        lines.push(`  implements: [${info.implementsInterfaces.map((i) => `"${i}"`).join(", ")}]`);
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
