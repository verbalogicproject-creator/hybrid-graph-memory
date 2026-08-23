import { LocalGeneratorProvider } from "../core/types";

export class LocalLlamaGenerator implements LocalGeneratorProvider {
  private generatorUrl: string;
  readonly availableModels: string[];
  activeModel: string;
  isAvailable = false;

  constructor(
    generatorUrl = "http://127.0.0.1:8147/v1/chat/completions",
    availableModels = [
      "qwen2.5-3b-instruct-q4_0",
      "microsoft_Phi-4-mini-instruct",
      "Llama-3.2-3B-Instruct-Q4_0",
      "gemma-4-E4B-it-Q4_0",
    ],
    defaultModel = "qwen2.5-3b-instruct-q4_0"
  ) {
    this.generatorUrl = generatorUrl;
    this.availableModels = availableModels;
    this.activeModel = defaultModel;
    this.checkHealth();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(
        this.generatorUrl.replace("/v1/chat/completions", "/health"),
        { signal: AbortSignal.timeout(1000) }
      );
      this.isAvailable = res.ok;
      return res.ok;
    } catch (e) {
      this.isAvailable = false;
      return false;
    }
  }

  async generateCompletion(
    prompt: string,
    systemPrompt = "You are the Antigravity Memory OS Assistant. Answer accurately using provided context.",
    model?: string,
    temperature = 0.7
  ): Promise<string> {
    const targetModel = model || this.activeModel;

    try {
      const res = await fetch(this.generatorUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature,
          max_tokens: 1024,
        }),
      });

      if (!res.ok) {
        throw new Error(`Local generator returned HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("Local generator returned an empty response candidate.");
      }

      return content;
    } catch (err: any) {
      throw new Error(`Failed to generate local on-device completion: ${err.message}`);
    }
  }
}
