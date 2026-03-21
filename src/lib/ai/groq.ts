import Groq from "groq-sdk";
import { ParsedIntent } from "@/lib/agents/types";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = "llama-3.3-70b-versatile";

export async function parseUserIntent(message: string): Promise<ParsedIntent> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are an AI agent that parses user purchase intents for a marketplace.
Extract structured data from the user's message. Respond ONLY with valid JSON, no markdown.

Output format:
{
  "serviceType": "cloud-storage" | "api-access" | "compute" | "hosting" | string,
  "maxBudget": number (in ALGO, default 100 if not specified),
  "preferences": string[] (extracted preferences like "cheap", "reliable", "fast", "encrypted")
}

Map common terms:
- "cloud", "storage", "backup" -> "cloud-storage"
- "API", "gateway", "endpoint" -> "api-access"
- "compute", "GPU", "server", "VM" -> "compute"
- "hosting", "website", "deploy" -> "hosting"`,
      },
      { role: "user", content: message },
    ],
    temperature: 0.1,
    max_tokens: 200,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
    return {
      serviceType: parsed.serviceType ?? "cloud-storage",
      maxBudget: parsed.maxBudget ?? 100,
      preferences: parsed.preferences ?? [],
      rawMessage: message,
    };
  } catch {
    return {
      serviceType: "cloud-storage",
      maxBudget: 100,
      preferences: [],
      rawMessage: message,
    };
  }
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
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are ${sellerName}, a ${strategy} negotiator for a cloud/API service provider in India.
Generate a SHORT (1-2 sentences) negotiation response. Be conversational and natural.
Strategy: ${strategy === "aggressive" ? "Hold firm on price, make small concessions" : strategy === "moderate" ? "Be reasonable but protect margins" : "Be friendly and willing to negotiate"}`,
      },
      {
        role: "user",
        content: isAccepting
          ? `The buyer offered ${buyerOffer} ALGO and you're accepting at ${counterPrice} ALGO. Respond with acceptance.`
          : `The buyer offered ${buyerOffer} ALGO (round ${round}). Your base is ${sellerBase} ALGO and minimum is ${sellerMin} ALGO. Counter at ${counterPrice} ALGO. Explain why your service is worth it.`,
      },
    ],
    temperature: 0.7,
    max_tokens: 100,
  });

  return completion.choices[0]?.message?.content ?? `I can offer this at ${counterPrice} ALGO.`;
}

export async function generateDealSummary(
  sellerName: string,
  serviceType: string,
  finalPrice: number,
  originalPrice: number,
  rounds: number
): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a concise deal analyst. Summarize the completed deal in 2-3 sentences. Mention the savings percentage and number of negotiation rounds.",
      },
      {
        role: "user",
        content: `Deal completed: ${serviceType} from ${sellerName}. Original price: ${originalPrice} ALGO, Final: ${finalPrice} ALGO. Took ${rounds} rounds.`,
      },
    ],
    temperature: 0.5,
    max_tokens: 100,
  });

  return (
    completion.choices[0]?.message?.content ??
    `Deal closed with ${sellerName} at ${finalPrice} ALGO (${Math.round(((originalPrice - finalPrice) / originalPrice) * 100)}% savings).`
  );
}
