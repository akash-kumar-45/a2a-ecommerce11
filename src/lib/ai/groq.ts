import { Groq } from "groq-sdk";
import type { ParsedIntent } from "@/lib/agents/types";

// Fallback logic if API key is missing
const isEnabled = !!process.env.GROQ_API_KEY;
const groq = isEnabled ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Extracted from original mocked groq
const TYPE_MAP: Record<string, string> = {
  cloud: "cloud-storage", storage: "cloud-storage", backup: "cloud-storage", s3: "cloud-storage",
  api: "api-access", gateway: "api-access", endpoint: "api-access", key: "api-access",
  gpu: "gpu-compute", compute: "gpu-compute", server: "gpu-compute", vm: "gpu-compute", cuda: "gpu-compute",
  host: "hosting", hosting: "hosting", vps: "hosting", deploy: "hosting", website: "hosting",
};

export async function parseUserIntent(message: string): Promise<ParsedIntent> {
  if (groq) {
    try {
      const response = await groq.chat.completions.create({
        model: "llama3-8b-8192",
        messages: [
          {
            role: "system",
            content: `You are an intent parser for an automated Web3 marketplace. 
                      Extract the underlying shopping objective from the user's message.
                      Respond ONLY with a JSON object. No extra text.
                      Format: {"serviceType": "cloud-storage", "maxBudget": 5.5, "searchTerms": ["aws", "fast"]}`
          },
          { role: "user", content: message }
        ],
        temperature: 0.1,
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
      return {
        serviceType: parsed.serviceType || "cloud-storage",
        maxBudget: parsed.maxBudget || 10,
        preferences: [],
        searchTerms: parsed.searchTerms || [],
        rawMessage: message
      };
    } catch (e) {
      console.error("Groq parse failed, falling back to regex", e);
    }
  }

  // Regex Fallback
  const lower = message.toLowerCase();
  const budgetMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:eth|algo)/i);
  const maxBudget = budgetMatch ? parseFloat(budgetMatch[1]) : 10;
  const words = lower.split(/\s+/);
  let serviceType = "cloud-storage";
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, "");
    if (TYPE_MAP[clean]) { serviceType = TYPE_MAP[clean]; break; }
  }
  const searchTerms = words.filter(w => w.length > 2).map(w => w.replace(/[^a-z]/g, "")).filter(Boolean);
  
  return { serviceType, maxBudget, preferences: [], searchTerms, rawMessage: message };
}

export async function generateNegotiationResponse(
  sellerName: string,
  strategy: string,
  buyerOffer: number,
  sellerMin: number,
  sellerBase: number,
  counterPrice: number,
  round: number,
  isAccepting: boolean
): Promise<string> {
  if (groq) {
    try {
      const prompt = isAccepting 
        ? `Accept the buyer's offer of ${counterPrice} ETH warmly.`
        : `Haggle! The buyer offered ${buyerOffer} ETH. Counter-offer exactly ${counterPrice} ETH. Defend your price based on high quality ${strategy} standards. Keep it under 2 sentences. Act like an AI seller.`;
        
      const response = await groq.chat.completions.create({
        model: "llama3-8b-8192",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      });
      return response.choices[0]?.message?.content || `${counterPrice} ETH works!`;
    } catch (e) {
      console.error("Groq haggle failed", e);
    }
  }

  // Fallback
  return isAccepting 
    ? `Deal! I'll accept ${counterPrice} ETH. Credentials will be delivered instantly.`
    : `I can come down to ${counterPrice} ETH, but that's my best offer for enterprise-grade service.`;
}

export async function generateDealSummary(
  sellerName: string,
  serviceType: string,
  finalPrice: number,
  originalPrice: number,
  rounds: number
): Promise<string> {
  const savings = originalPrice > 0 ? Math.round(((originalPrice - finalPrice) / originalPrice) * 100) : 0;
  
  if (groq) {
    try {
      const response = await groq.chat.completions.create({
        model: "llama3-8b-8192",
        messages: [{ role: "user", content: `Summarize this deal in one short punchy sentence like a hacker: Secured ${serviceType} from ${sellerName} for ${finalPrice} ETH (Saved ${savings}%). Took ${rounds} rounds.` }],
        temperature: 0.5,
      });
      return response.choices[0]?.message?.content || "";
    } catch {}
  }

  return `Agent secured **${serviceType}** from ${sellerName || "the seller"} at **${finalPrice} ETH** (${savings > 0 ? `saving ${savings}%` : "at listed price"}) after ${rounds} rounds.`;
}
