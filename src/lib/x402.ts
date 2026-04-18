/**
 * Lightweight x402-inspired payment verification.
 *
 * Instead of using an external facilitator, the server directly verifies
 * payment transactions on-chain via algod. This gives full decentralization
 * without external HTTP dependencies.
 *
 * Protocol:
 *  GET /api/products/{txId}              → 402 with PaymentRequirements
 *  GET /api/products/{txId}?proof={txId} → verify on-chain → return credentials
 */

import algosdk from "@/lib/blockchain/algosdk-mock";
import { getClient } from "@/lib/blockchain/algorand";

export const NETWORK = process.env.ALGORAND_NETWORK?.toLowerCase() === "mainnet"
  ? "algorand:mainnet"
  : "algorand:testnet";

/**
 * Build the 402 PaymentRequirements object for a given listing.
 */
export function buildPaymentRequirements(params: {
  resource:      string;
  description:   string;
  sellerAddress: string;
  priceAlgo:     number;
}) {
  const microAlgo = String(Math.round(params.priceAlgo * 1_000_000));
  return {
    scheme:            "exact",
    network:           NETWORK,
    maxAmountRequired: microAlgo,
    asset:             "algo",
    payTo:             params.sellerAddress,
    resource:          params.resource,
    description:       params.description,
    mimeType:          "application/json",
    maxTimeoutSeconds: 300,
    extra:             {} as Record<string, unknown>,
  };
}

export interface PaymentVerificationResult {
  isValid:      boolean;
  txId?:        string;
  amount?:      number;
  confirmedRound?: number;
  reason?:      string;
}

/**
 * Verify an on-chain payment:
 *  - Transaction must be confirmed
 *  - Recipient must match sellerAddress
 *  - Amount must be >= requiredMicroAlgo
 */
export async function verifyOnChainPayment(params: {
  paymentTxId:      string;
  sellerAddress:    string;
  requiredAlgo:     number;
}): Promise<PaymentVerificationResult> {
  try {
    const algod = getClient().client.algod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txInfo: any = await algod.pendingTransactionInformation(params.paymentTxId).do();

    const confirmedRound = Number(txInfo.confirmedRound ?? txInfo["confirmed-round"] ?? 0);
    if (confirmedRound === 0) {
      return { isValid: false, reason: "Transaction not confirmed yet" };
    }

    // Extract receiver — handle algosdk v3 (payment.receiver) and v2 (txn.rcv) formats
    let receiver = "";
    const innerTxn = txInfo.txn?.txn ?? txInfo.txn ?? {};

    // v3: Transaction object has .payment.receiver (Address with .toString())
    if (innerTxn.payment?.receiver) {
      receiver = String(innerTxn.payment.receiver);
    }
    // v2: raw msgpack has .rcv as Uint8Array
    else if (innerTxn.rcv) {
      try {
        receiver = algosdk.encodeAddress(innerTxn.rcv);
      } catch {
        receiver = String(innerTxn.rcv);
      }
    }
    // v2 alt: some responses have .receiver directly
    else if (txInfo.txn?.receiver || txInfo.receiver) {
      receiver = String(txInfo.txn?.receiver ?? txInfo.receiver);
    }
    // Last resort: stringify and regex-extract an Algorand address
    if (!receiver) {
      const dump = JSON.stringify(txInfo);
      const addrMatch = dump.match(/[A-Z2-7]{58}/);
      if (addrMatch) receiver = addrMatch[0];
    }

    // Extract amount — handle v3 (payment.amount as bigint) and v2 (amt as number)
    let amtMicro = 0;
    if (innerTxn.payment?.amount !== undefined) {
      amtMicro = Number(innerTxn.payment.amount);
    } else if (innerTxn.amt !== undefined) {
      amtMicro = Number(innerTxn.amt);
    } else if (txInfo.txn?.amt !== undefined) {
      amtMicro = Number(txInfo.txn.amt);
    } else if (txInfo.amount !== undefined) {
      amtMicro = Number(txInfo.amount);
    }

    const requiredMicro = Math.round(params.requiredAlgo * 1_000_000);

    if (receiver.toLowerCase() !== params.sellerAddress.toLowerCase()) {
      return { isValid: false, reason: `Payment went to ${receiver}, expected ${params.sellerAddress}` };
    }
    if (amtMicro < requiredMicro * 0.99) { // 1% tolerance for rounding
      return {
        isValid: false,
        reason: `Paid ${amtMicro} µAlgo but required ${requiredMicro} µAlgo`,
      };
    }

    return {
      isValid:        true,
      txId:           params.paymentTxId,
      amount:         amtMicro / 1_000_000,
      confirmedRound,
    };
  } catch (err) {
    return { isValid: false, reason: err instanceof Error ? err.message : "Verification failed" };
  }
}
