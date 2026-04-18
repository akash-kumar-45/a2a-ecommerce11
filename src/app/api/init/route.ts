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
  { service: "Managed VPS Hosting", type: "hosting", price: 0.12, description: "4vCPU / 8GB RAM / 200GB SSD, auto-backups", seller: "0xSeedAgent4" },
  { service: "Data Labelling API", type: "api-access", price: 0.18, description: "Automated image labelling with 95%+ accuracy guarantee", seller: "0xSeedAgent5" },
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

    const existing = getAllListings();

    if (existing.length >= SEED_LISTINGS.length) {
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
    for (const l of SEED_LISTINGS) {
      const listing = createListing({
        ...l,
        zkCommitment: zkCommit(l.seller, l.price, l.service),
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
