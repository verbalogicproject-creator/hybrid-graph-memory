import { GoogleGenAI } from "@google/genai";
import { LocalGeneratorProvider } from "../core/types";

export class GeminiCloudGenerator implements LocalGeneratorProvider {
  private ai: GoogleGenAI;
  readonly availableModels: string[];
  activeModel: string;
  isAvailable = true;

  constructor(
    apiKey?: string,
    defaultModel = "gemini-2.5-flash"
  ) {
    let resolvedApiKey = apiKey || process.env.GEMINI_API_KEY;
    if (!resolvedApiKey) {
      this.isAvailable = false;
      this.ai = null as any;
    } else {
      this.ai = new GoogleGenAI({ apiKey: resolvedApiKey });
    }
    
    this.availableModels = [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ];
    this.activeModel = defaultModel;
  }

  async checkHealth(): Promise<boolean> {
    return this.isAvailable;
  }

  async generateCompletion(
    prompt: string,
    systemPrompt = "You are the Antigravity Memory OS Assistant. Answer accurately using provided context.",
    model?: string,
    temperature = 0.7
  ): Promise<string> {
    if (!this.isAvailable) {
      throw new Error("Gemini API key not found. Cannot generate cloud completion.");
    }

    const targetModel = model || this.activeModel;

    try {
      const response = await this.ai.models.generateContent({
        model: targetModel,
        contents: [
          { role: "user", parts: [{ text: prompt }] }
        ],
        config: {
          systemInstruction: systemPrompt,
          temperature,
        }
      });

      if (!response.text) {
        throw new Error("Gemini generator returned an empty response.");
      }

      return response.text;
    } catch (err: any) {
      throw new Error(`Failed to generate Gemini cloud completion: ${err.message}`);
    }
  }
}
