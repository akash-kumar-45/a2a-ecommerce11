/**
 * /api/init — Ethereum-native initialization.
 * Instead of creating Algorand accounts, we just seed example listings
 * into the local JSON DB if none exist, then return a ready state.
 */
import { NextResponse } from "next/server";
import { getAllListings, createListing } from "@/lib/db/listings-store";
import { createAction } from "@/lib/a2a/messaging";
import { createHash, randomBytes } from "crypto";

const SEED_LISTINGS = [
  { service: "100GB Cloud Storage", type: "cloud-storage", price: 0.08, description: "Encrypted S3-compatible storage, 99.9% uptime SLA", seller: "0xSeedAgent1" },
  { service: "GPT-4 API Access", type: "api-access", price: 0.25, description: "Proxied OpenAI API key with 1M token limit", seller: "0xSeedAgent2" },
  { service: "GPU Compute 8xA100", type: "gpu-compute", price: 0.95, description: "8x A100 80GB slot, 24hr lease, PyTorch pre-installed", seller: "0xSeedAgent3" },
  // ── Cloud & Storage ────────────────────────────────────────────────
  { service: "100GB Cloud Storage", type: "cloud-storage", price: 0.08, description: "Encrypted S3-compatible storage, 99.9% uptime SLA, AES-256 at rest", seller: "0xSeedAgent1" },
  { service: "1TB Cold Archive Storage", type: "cloud-storage", price: 0.045, description: "Long-term Glacier-style storage, retrieval in <4hr, redundant across 3 regions", seller: "0xSeedAgent2" },
  { service: "5TB Dedicated NAS", type: "cloud-storage", price: 0.22, description: "Bare-metal NAS with RAID-6, rsync + FTP access, no egress fees", seller: "0xSeedAgent6" },
  // ── API & AI Services ─────────────────────────────────────────────
  { service: "GPT-4 API Access", type: "api-access", price: 0.25, description: "Proxied OpenAI API key — 1M token limit, rate-limit managed", seller: "0xSeedAgent3" },
  { service: "Claude 3.5 Sonnet API", type: "api-access", price: 0.28, description: "Anthropic Claude via proxy — 500K tokens, JSON mode supported", seller: "0xSeedAgent7" },
  { service: "Stable Diffusion API", type: "api-access", price: 0.15, description: "SDXL image generation — 2000 images/month, no NSFW filter", seller: "0xSeedAgent8" },
  { service: "Data Labelling API", type: "api-access", price: 0.18, description: "Automated image labelling with 95%+ accuracy guarantee, COCO format output", seller: "0xSeedAgent5" },
  { service: "Real-Time Stock Data API", type: "api-access", price: 0.09, description: "NYSE + NASDAQ live tick data, 100ms latency, WebSocket stream", seller: "0xSeedAgent9" },
  // ── Compute ──────────────────────────────────────────────────────
  { service: "GPU Compute 8xA100", type: "gpu-compute", price: 0.95, description: "8x NVIDIA A100 80GB — 24hr lease, PyTorch + CUDA 12.3 pre-installed", seller: "0xSeedAgent10" },
  { service: "4xRTX 4090 Cluster", type: "gpu-compute", price: 0.55, description: "4x RTX 4090 24GB VRAM, NVLink bridge, 100Gbps interconnect", seller: "0xSeedAgent11" },
  { service: "TPU v4 Pod Slice", type: "gpu-compute", price: 1.20, description: "Google TPU v4 — 32 chips, ideal for JAX/Flax LLM training", seller: "0xSeedAgent12" },
  { service: "CPU Compute — 64vCPU", type: "gpu-compute", price: 0.18, description: "64-core AMD EPYC, 256GB RAM, 2TB NVMe SSD — no GPU, high throughput CPU tasks", seller: "0xSeedAgent13" },
  // ── Hosting & Infrastructure ─────────────────────────────────────
  { service: "Managed VPS Hosting", type: "hosting", price: 0.12, description: "4vCPU / 8GB RAM / 200GB SSD, Ubuntu 22.04, auto-backups, free SSL", seller: "0xSeedAgent4" },
  { service: "Kubernetes Cluster (3-node)", type: "hosting", price: 0.38, description: "3-node managed K8s, Helm included, load balancer + auto-scaling pre-configured", seller: "0xSeedAgent14" },
  { service: "Global CDN Access", type: "hosting", price: 0.06, description: "100TB/month bandwidth across 45 PoPs, HTTP/3, DDoS protection included", seller: "0xSeedAgent15" },
  { service: "Dedicated Game Server", type: "hosting", price: 0.20, description: "8-core / 32GB RAM, low-latency Mumbai + Singapore nodes, supports Unity + Unreal", seller: "0xSeedAgent16" },
  // ── Subscriptions & Accounts ─────────────────────────────────────
  { service: "Netflix Premium Account", type: "other", price: 0.01, description: "4K Ultra HD, 4 screens, shared slot — credentials delivered instantly on payment", seller: "0xSeedAgent17" },
  { service: "Spotify Family Plan", type: "other", price: 0.008, description: "Family plan slot — 1 month, ad-free, offline downloads, 6 accounts", seller: "0xSeedAgent18" },
  { service: "GitHub Copilot Enterprise", type: "other", price: 0.03, description: "Full Copilot Enterprise seat — 30 days, includes Copilot Chat + CLI", seller: "0xSeedAgent19" },
  { service: "Midjourney Pro Subscription", type: "other", price: 0.025, description: "30-day Midjourney Pro access — unlimited fast GPU hours, stealth mode enabled", seller: "0xSeedAgent20" },
];

function zkCommit(seller: string, price: number, service: string): string {
  const secret = randomBytes(8).toString("hex");
  return createHash("sha256").update(`${secret}|${seller}|${price}|${service}`).digest("hex");
}

export async function POST() {
  try {
    const actions = [
      createAction("system", "A2A TrustMesh", "transaction", "Initializing A2A system on Ethereum TestNet..."),
    ];

    const existing = await getAllListings();

    if (existing.length >= 20) {
      actions.push(
        createAction("system", "A2A TrustMesh", "result",
          `**System already initialized.**\n• **${existing.length} listings** available in marketplace.\n• Ethereum wallet authentication active.`)
      );
      return NextResponse.json({
        success: true,
        alreadyInitialized: true,
        listingCount: existing.length,
        actions,
      });
    }

    // Seed demo listings
    actions.push(
      createAction("system", "A2A TrustMesh", "transaction",
        `Seeding ${SEED_LISTINGS.length} demo service listings into marketplace...`)
    );

    const created = [];
    const { encryptString } = await import("@/lib/encryption");
    for (const l of SEED_LISTINGS) {
      const validSeller = "0x" + Buffer.from(l.seller).toString('hex').padEnd(40, '0').slice(0, 40);
      const dummyPass = `demo_secure_pass_${validSeller.slice(0, 6)}`;
      const listing = await createListing({
        ...l,
        seller: validSeller,
        password: encryptString(dummyPass),
        zkCommitment: createHash("sha256").update(dummyPass).digest("hex"),
        timestamp: Date.now() - Math.floor(Math.random() * 3_600_000), // random within last hr
      });
      created.push(listing);
    }

    actions.push(
      createAction("system", "A2A TrustMesh", "result",
        `**${created.length} demo listings seeded!**\n` +
        created.map((l, i) => `• Listing ${i + 1}: **${l.service}** @ **${l.price} ETH** [ZK ✓]`).join("\n"))
    );

    return NextResponse.json({
      success: true,
      listingCount: created.length,
      actions,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Init failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
