import { MemoryEngine } from "./engine";
import {
  LegacyEvidenceReference,
  RetrievedContext,
  SearchOptions,
} from "./types";

export interface FractalContextPacket {
  scope: { workspace: string; project: string };
  query: string;
  contexts: RetrievedContext[];
  authority: "context_only";
  evidenceNote: "Memory references are not SAG receipts or evidence levels.";
}

export class FractalMemoryPort {
  constructor(
    private engine: MemoryEngine,
    private strictWorkspace: string,
    private strictProject: string
  ) {}

  public async indexProject(onProgress?: any) {
    this.assertEngineScope();
    return this.engine.index(onProgress);
  }

  public async scopedSearch(
    query: string,
    options: Omit<SearchOptions, "workspace" | "project" | "strictNamespace" | "retrievalMode" | "federatedAdmission"> = {}
  ): Promise<RetrievedContext[]> {
    this.assertEngineScope();
    return this.engine.search(query, {
      ...options,
      workspace: this.strictWorkspace,
      project: this.strictProject,
      retrievalMode: "strict",
      strictNamespace: true,
    });
  }

  public async getContextPacket(
    query: string,
    options: Omit<SearchOptions, "workspace" | "project" | "strictNamespace" | "retrievalMode" | "federatedAdmission"> = {}
  ): Promise<FractalContextPacket> {
    return {
      scope: { workspace: this.strictWorkspace, project: this.strictProject },
      query,
      contexts: await this.scopedSearch(query, options),
      authority: "context_only",
      evidenceNote: "Memory references are not SAG receipts or evidence levels.",
    };
  }

  public getEvidenceReferences(incidentType?: string): LegacyEvidenceReference[] {
    return this.engine.getLegacyEvidenceReferences(incidentType);
  }

  public getEvidenceReference(id: string): LegacyEvidenceReference | null {
    return this.engine.getLegacyEvidenceReference(id);
  }

  private assertEngineScope(): void {
    const engineScope = this.engine.getProjectScope();
    if (
      engineScope.workspace !== this.strictWorkspace ||
      engineScope.project !== this.strictProject
    ) {
      throw new Error(
        "FractalMemoryPort scope must match the MemoryEngine configuration; create a separately configured engine for another project."
      );
    }
  }
}
