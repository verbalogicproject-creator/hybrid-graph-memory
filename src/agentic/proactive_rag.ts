import { RetrievedContext } from "../core/types";
import { checkDisambiguationGate, DisambiguationResult } from "./disambiguation";

export interface ProactiveRagOptions {
  disambiguationThreshold?: number;
  maxRetrievedChunks?: number;
  maxTotalChars?: number;
  autoDisambiguate?: boolean;
}

export interface ProactiveRagResult {
  hasInjectedContext: boolean;
  detectedSymbols: string[];
  resolvedContexts: RetrievedContext[];
  injectedContextXml: string;
  augmentedPrompt: string;
  disambiguation?: DisambiguationResult;
}

export interface SearchableEngine {
  search(query: string, options?: any): Promise<RetrievedContext[]>;
  getAllRelations(): any[];
}

export async function resolveProactiveContext(
  prompt: string,
  engine: SearchableEngine,
  options: ProactiveRagOptions = {}
): Promise<ProactiveRagResult> {
  const threshold = options.disambiguationThreshold ?? 0.60;
  const maxChunks = options.maxRetrievedChunks ?? 3;
  const maxChars = options.maxTotalChars ?? 3500;
  const autoDisambiguate = options.autoDisambiguate ?? true;

  const explicitTagMatches =
    prompt.match(/@(component|module|relation|decision|invariant|store)\s+([A-Za-z0-9_.-]+)/gi) || [];
  const symbolMatches =
    prompt.match(/\b(OrchestratorTab|StudioTab|CanvasMask|Gallery|PromptPreview|PromptCompiler|GenerateApiRoute|GeminiNanoBanana|MemoryEngine|useStudioStore|ColorPickerInput|Orchestrator3DCanvas)\b/g) || [];

  const detectedSet = new Set<string>();
  for (const tag of explicitTagMatches) {
    const parts = tag.split(/\s+/);
    if (parts[1]) detectedSet.add(parts[1].trim());
  }
  for (const sym of symbolMatches) {
    detectedSet.add(sym.trim());
  }

  const detectedSymbols = Array.from(detectedSet);

  let resolvedContexts: RetrievedContext[] = [];
  if (detectedSymbols.length > 0 || prompt.includes("?") || prompt.length > 20) {
    const searchQuery = detectedSymbols.length > 0 ? detectedSymbols.join(" ") : prompt;
    resolvedContexts = await engine.search(searchQuery, {
      limit: maxChunks,
      intent: detectedSymbols.length > 0 ? "architecture" : "general",
    });
  }

  let disambiguation: DisambiguationResult | undefined;
  if (autoDisambiguate && resolvedContexts.length > 0) {
    const allRelations = engine.getAllRelations();
    disambiguation = checkDisambiguationGate(prompt, resolvedContexts, allRelations, threshold);
  }

  if (resolvedContexts.length === 0) {
    return {
      hasInjectedContext: false,
      detectedSymbols,
      resolvedContexts: [],
      injectedContextXml: "",
      augmentedPrompt: prompt,
      disambiguation,
    };
  }

  let totalChars = 0;
  const xmlParts: string[] = [];
  xmlParts.push("<antigravity_proactive_context>");
  if (detectedSymbols.length > 0) {
    xmlParts.push(`  <detected_symbols>${detectedSymbols.join(", ")}</detected_symbols>`);
  }

  xmlParts.push("  <retrieved_architectural_chunks>");
  for (const ctx of resolvedContexts) {
    if (totalChars > maxChars) break;
    const chunkXml = [
      `    <chunk id="${ctx.id}" source="${ctx.filepath || ctx.sourceType}" symbol="${ctx.symbol || 'N/A'}" score="${(ctx.finalScore).toFixed(3)}">`,
      `      <![CDATA[${ctx.content.slice(0, 1000)}]]>`,
      "    </chunk>",
    ].join("\n");

    totalChars += chunkXml.length;
    xmlParts.push(chunkXml);
  }
  xmlParts.push("  </retrieved_architectural_chunks>");
  xmlParts.push("</antigravity_proactive_context>");

  const injectedContextXml = xmlParts.join("\n");
  const augmentedPrompt = `${injectedContextXml}\n\n${prompt}`;

  return {
    hasInjectedContext: true,
    detectedSymbols,
    resolvedContexts,
    injectedContextXml,
    augmentedPrompt,
    disambiguation,
  };
}
