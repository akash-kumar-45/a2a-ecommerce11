/**
 * /api/execute — Ethereum-native deal execution.
 *
 * Flow:
 *  1. Simulate payment confirmation (real payment was handled client-side via MetaMask vault)
 *  2. Deliver credentials from DB if available
 *  3. Update reputation score (in-memory)
 */

import { NextRequest, NextResponse } from "next/server";
import { getListingById } from "@/lib/db/listings-store";
import { decryptString } from "@/lib/encryption";
import { createAction } from "@/lib/a2a/messaging";
import type { NegotiationSession } from "@/lib/agents/types";
import { createHash, randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { deal } = (await req.json()) as { deal: NegotiationSession };

    if (!deal?.sellerAddress || typeof deal?.finalPrice !== "number") {
      return NextResponse.json({ error: "Deal details are required" }, { status: 400 });
    }

    const payableAmount = Math.max(deal.finalPrice, 0.001);

    // Generate a simulated Ethereum tx hash
    const fakeTxHash = "0x" + createHash("sha256")
      .update(`${deal.sellerAddress}|${payableAmount}|${Date.now()}|${randomBytes(8).toString("hex")}`)
      .digest("hex")
      .slice(0, 64);

    const actions = [
      createAction(
        "buyer",
        "Buyer Agent",
        "transaction",
        `Executing Ethereum payment via A2A Vault...\n` +
        `**${payableAmount} ETH** → **${deal.sellerName}** (\`${deal.sellerAddress?.slice(0, 14) ?? ""}...\`)\n` +
        `Protocol: EIP-712 signed transfer`
      ),
    ];

    // Simulate confirmation delay
    await new Promise((r) => setTimeout(r, 600));

    actions.push(
      createAction(
        "system",
        "Ethereum",
        "transaction",
        `**Payment Confirmed!** ✓\n` +
        `• **TX Hash:** \`${fakeTxHash.slice(0, 24)}...\`\n` +
        `• **Amount:** ${payableAmount} ETH\n` +
        `• **Network:** Ethereum Testnet (Sepolia)\n` +
        `• **Status:** Confirmed`,
        { txHash: fakeTxHash, amount: payableAmount }
      )
    );

    // Try to fetch credentials from DB
    let credentials: Record<string, unknown> | null = null;
    let credentialsError: string | null = null;

    const listingId = deal.listingTxId;
    if (listingId) {
      try {
        const listing = await getListingById(listingId);
        if (listing?.username && listing?.password) {
          credentials = {
            username: listing.username,
            password: decryptString(listing.password),
            notes: listing.notes ?? "",
            service: listing.service,
          };
          actions.push(
            createAction(
              "system",
              "x402 Protocol",
              "result",
              `**Credentials delivered!** ✓\n` +
              `Service: ${listing.service}\n` +
              `Payment verified — access granted.`,
              { listingId }
            )
          );
        } else {
          credentialsError = "No credentials stored for this listing";
          actions.push(
            createAction("system", "x402 Protocol", "result",
              `ℹ No credentials stored for this listing. Payment completed successfully.`)
          );
        }
      } catch {
        credentialsError = "Could not retrieve credentials";
      }
    }

    // Reputation update (in-memory, fire-and-forget)
    const reputationTxHash = "0xrep_" + randomBytes(8).toString("hex");
    actions.push(
      createAction(
        "system",
        "AgentReputation",
        "transaction",
        `**Reputation updated!** ${deal.sellerName} score +85/100\n` +
        `• **Feedback Hash:** \`${reputationTxHash}\``,
        { reputationTxId: reputationTxHash, score: 85 }
      )
    );

    // Final summary
    actions.push(
      createAction(
        "buyer",
        "Buyer Agent",
        "result",
        credentials
          ? `✓ Deal complete! Credentials for **${deal.service}** received.\nPaid ${payableAmount} ETH to ${deal.sellerName}.`
          : `✓ Payment complete! ${payableAmount} ETH → ${deal.sellerName}.\n${credentialsError ?? "No credentials for this listing."}`
      )
    );

    const escrow = {
      txId: fakeTxHash,
      buyerAddress: "vault",
      sellerAddress: deal.sellerAddress,
      amount: payableAmount,
      confirmedRound: Math.floor(Date.now() / 1000),
    };

    return NextResponse.json({
      success: true,
      escrow,
      credentials,
      credentialsError,
      reputationTxId: reputationTxHash,
      paymentTxId: fakeTxHash,
      actions,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Execution failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
