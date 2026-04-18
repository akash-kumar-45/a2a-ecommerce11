/**
 * AI helpers — fully offline, template-based (no API key required).
 * Replaces the Groq/LLM integration with deterministic logic.
 */

import type { ParsedIntent } from "@/lib/agents/types";

// ─── Intent parsing ────────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  cloud: "cloud-storage", storage: "cloud-storage", backup: "cloud-storage", s3: "cloud-storage",
  api: "api-access", gateway: "api-access", endpoint: "api-access", key: "api-access",
  gpu: "gpu-compute", compute: "gpu-compute", server: "gpu-compute", vm: "gpu-compute", cuda: "gpu-compute",
  host: "hosting", hosting: "hosting", vps: "hosting", deploy: "hosting", website: "hosting",
};

const STOP = new Set(["buy", "get", "me", "a", "the", "under", "for", "i", "need", "want", "eth", "algo", "some", "please", "find", "cheapest", "best"]);

export async function parseUserIntent(message: string): Promise<ParsedIntent> {
  const lower = message.toLowerCase();

  // Extract budget
  const budgetMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:eth|algo)/i);
  const maxBudget = budgetMatch ? parseFloat(budgetMatch[1]) : 10;

  // Extract service type
  const words = lower.split(/\s+/);
  let serviceType = "cloud-storage";
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, "");
    if (TYPE_MAP[clean]) { serviceType = TYPE_MAP[clean]; break; }
  }

  // If no standard type matched, use the meaningful nouns as the type
  if (serviceType === "cloud-storage" && !lower.match(/cloud|storage|backup/)) {
    const terms = words.filter(w => w.length > 3 && !STOP.has(w)).slice(0, 2);
    if (terms.length) serviceType = terms.join("-").replace(/[^a-z-]/g, "");
  }

  // Preferences
  const preferences: string[] = [];
  if (lower.includes("cheap") || lower.includes("cheap") || lower.includes("low")) preferences.push("cheap");
  if (lower.includes("fast") || lower.includes("quick")) preferences.push("fast");
  if (lower.includes("secure") || lower.includes("encrypt")) preferences.push("encrypted");
  if (lower.includes("reliable") || lower.includes("uptime")) preferences.push("reliable");

  const searchTerms = words.filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/[^a-z]/g, "")).filter(Boolean);

  return { serviceType, maxBudget, preferences, searchTerms, rawMessage: message };
}

// ─── Negotiation response ──────────────────────────────────────────────────────

const ACCEPT_LINES = [
  (price: number) => `Deal! I'll accept ${price} ETH — you drive a hard bargain. Credentials will be delivered instantly.`,
  (price: number) => `Agreed at ${price} ETH. You've got yourself a deal — processing now.`,
  (price: number) => `${price} ETH works for me. Let's close this!`,
];

const COUNTER_LINES = [
  (counter: number, base: number) => `My service is valued at ${base} ETH — I can come down to ${counter} ETH, but that's my best offer.`,
  (counter: number) => `I appreciate the interest. How about ${counter} ETH? The uptime guarantee alone is worth it.`,
  (counter: number) => `${counter} ETH is a fair price for enterprise-grade service. What do you say?`,
];

export async function generateNegotiationResponse(
  _sellerName: string,
  _strategy: string,
  _buyerOffer: number,
  _sellerMin: number,
  sellerBase: number,
  counterPrice: number,
  round: number,
  isAccepting: boolean
): Promise<string> {
  const idx = round % 3;
  if (isAccepting) {
    return ACCEPT_LINES[idx](counterPrice);
  }
  return COUNTER_LINES[idx](counterPrice, sellerBase);
}

// ─── Deal summary ──────────────────────────────────────────────────────────────

export async function generateDealSummary(
  sellerName: string,
  serviceType: string,
  finalPrice: number,
  originalPrice: number,
  rounds: number
): Promise<string> {
  const savings = originalPrice > 0
    ? Math.round(((originalPrice - finalPrice) / originalPrice) * 100)
    : 0;
  const roundWord = rounds === 1 ? "round" : "rounds";
  return (
    `Agent secured **${serviceType}** from ${sellerName || "the seller"} at **${finalPrice} ETH** ` +
    `(${savings > 0 ? `saving ${savings}%` : "at listed price"}) after ${rounds} negotiation ${roundWord}. ` +
    `ZK commitment verified. Credentials ready for delivery.`
  );
}
