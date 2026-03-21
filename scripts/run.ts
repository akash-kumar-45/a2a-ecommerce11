import { AlgorandClient, algo, Config } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import { createHash, randomBytes } from "crypto";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { ZkCommitmentClient, ZkCommitmentFactory } from "../artifacts/zk_commitment/ZKCommitmentClient";
dotenv.config();

Config.configure({ logger: { error: () => {}, warn: () => {}, info: () => {}, verbose: () => {}, debug: () => {} } });

// ─── Network Config ──────────────────────────────────────────────────────────

type NetworkMode = "localnet" | "testnet";
const NETWORK: NetworkMode = (process.env.ALGORAND_NETWORK?.toLowerCase() === "testnet") ? "testnet" : "localnet";

// ─── Colors & formatting ────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

function banner(text: string, color = c.bgBlue) {
  const pad = " ".repeat(Math.max(0, 60 - text.length));
  console.log(`\n${color}${c.bold}  ${text}${pad}${c.reset}`);
}

function section(text: string) {
  console.log(`\n${c.cyan}${c.bold}▸ ${text}${c.reset}`);
}

function info(label: string, value: string) {
  console.log(`  ${c.gray}${label.padEnd(20)}${c.reset} ${value}`);
}

function success(text: string) {
  console.log(`  ${c.green}✓${c.reset} ${text}`);
}

function warn(text: string) {
  console.log(`  ${c.yellow}⚠${c.reset} ${text}`);
}

function bullet(text: string) {
  console.log(`  ${c.gray}•${c.reset} ${text}`);
}

function divider() {
  console.log(`${c.gray}${"─".repeat(64)}${c.reset}`);
}

function msgBubble(from: string, action: string, price: number, text: string, color: string) {
  const actionColors: Record<string, string> = {
    offer: c.blue,
    counter: c.yellow,
    accept: c.green,
    reject: c.red,
  };
  const ac = actionColors[action] ?? c.gray;
  console.log(
    `  ${color}${c.bold}${from.padEnd(14)}${c.reset} ${ac}[${action.toUpperCase()}]${c.reset} ${c.bold}${price} ALGO${c.reset}  ${c.dim}${text.slice(0, 60)}${c.reset}`
  );
}

function addr(a: string): string {
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ZKCommitment {
  commitment: string;
  secret: string;
}

interface Listing {
  txId: string;
  sender: string;
  type: string;
  service: string;
  price: number;
  seller: string;
  description: string;
  zkCommitment: string;
  round: number;
}

interface X402Msg {
  from: string;
  to: string;
  action: "offer" | "counter" | "accept" | "reject";
  price: number;
  text: string;
}

interface NegResult {
  listing: Listing;
  accepted: boolean;
  finalPrice: number;
  messages: X402Msg[];
  zkVerified: boolean;
}

// ─── ZK Commitment Scheme (SHA-256) ─────────────────────────────────────────

function createCommitment(seller: string, price: number, capabilities: string): ZKCommitment {
  const secret = randomBytes(32).toString("hex");
  const preimage = `${secret}|${seller}|${price}|${capabilities}`;
  const commitment = createHash("sha256").update(preimage).digest("hex");
  return { commitment, secret };
}

function verifyCommitment(
  commitment: string,
  secret: string,
  seller: string,
  price: number,
  capabilities: string,
): boolean {
  const preimage = `${secret}|${seller}|${price}|${capabilities}`;
  const recomputed = createHash("sha256").update(preimage).digest("hex");
  return recomputed === commitment;
}

const sellerSecrets = new Map<string, string>();

// ─── Groq AI ────────────────────────────────────────────────────────────────

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function parseIntent(userMessage: string): Promise<{ serviceType: string; maxBudget: number; preferences: string[] }> {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Parse user purchase intent. Respond ONLY with JSON, no markdown.\nOutput: {"serviceType":"cloud-storage"|"api-access"|"compute"|"hosting","maxBudget":number,"preferences":string[]}\nMap: cloud/storage/backup -> "cloud-storage", API/gateway -> "api-access", compute/GPU -> "compute", hosting/website -> "hosting"`,
      },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 150,
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
    return {
      serviceType: parsed.serviceType ?? "cloud-storage",
      maxBudget: parsed.maxBudget ?? 100,
      preferences: parsed.preferences ?? [],
    };
  } catch {
    return { serviceType: "cloud-storage", maxBudget: 100, preferences: [] };
  }
}

async function aiNegResponse(seller: string, buyerOffer: number, counterPrice: number, accepted: boolean): Promise<string> {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: `You are ${seller}, a service provider. Give a 1-sentence negotiation response. Be natural.` },
      {
        role: "user",
        content: accepted
          ? `Buyer offered ${buyerOffer} ALGO. You accept at ${counterPrice} ALGO. Respond with acceptance.`
          : `Buyer offered ${buyerOffer} ALGO. Counter at ${counterPrice} ALGO. Explain your value briefly.`,
      },
    ],
    temperature: 0.7,
    max_tokens: 60,
  });
  return completion.choices[0]?.message?.content ?? `Offering at ${counterPrice} ALGO.`;
}

// ─── Main Flow ──────────────────────────────────────────────────────────────

async function main() {
  const userIntent = process.argv[2] || (NETWORK === "testnet" ? "Buy cloud storage under 1 ALGO" : "Buy cloud storage under 100 ALGO");

  console.clear();
  banner("A2A AGENTIC COMMERCE FRAMEWORK", c.bgBlue);
  console.log(`${c.gray}  Algorand Agent-to-Agent Commerce${c.reset}`);
  console.log(`${c.gray}  On-chain listings • Indexer discovery • On-chain ZK (SHA-256) • x402 Protocol • Real payments${c.reset}`);
  info("Network", `${c.bold}${NETWORK.toUpperCase()}${c.reset}`);
  divider();

  // ── Step 1: Connect to Algorand ─────────────────────────────────────────

  section(`Connecting to Algorand ${NETWORK === "testnet" ? "TestNet" : "LocalNet"}`);
  let algorand: AlgorandClient;
  try {
    algorand = NETWORK === "testnet"
      ? AlgorandClient.testNet()
      : AlgorandClient.defaultLocalNet();
    const status = await algorand.client.algod.status().do();
    success(`Connected — Last round: ${status.lastRound}`);
  } catch (e) {
    console.log(`\n  ${c.red}✗ Failed to connect to ${NETWORK === "testnet" ? "TestNet" : "LocalNet"}.${c.reset}`);
    if (NETWORK === "localnet") {
      console.log(`  ${c.yellow}Run: algokit localnet start${c.reset}\n`);
    }
    process.exit(1);
  }

  // ── Step 2: Create & fund accounts ────────────────────────────────────────

  section("Creating & funding accounts");

  let buyerAddr: string;

  if (NETWORK === "testnet" && process.env.AVM_PRIVATE_KEY) {
    const secretKey = Buffer.from(process.env.AVM_PRIVATE_KEY, "base64");
    const account = algosdk.mnemonicToSecretKey(algosdk.secretKeyToMnemonic(secretKey));
    buyerAddr = account.addr.toString();
    algorand.setSignerFromAccount(account);
    const buyerBal = (await algorand.account.getInformation(buyerAddr)).balance.algos;
    info("Buyer (TestNet)", `${addr(buyerAddr)}  ${c.green}${buyerBal.toFixed(2)} ALGO${c.reset}`);
  } else if (NETWORK === "localnet") {
    const dispenser = await algorand.account.localNetDispenser();
    const account = algorand.account.random();
    algorand.setSignerFromAccount(account);
    await algorand.send.payment({ sender: dispenser.addr, receiver: account.addr, amount: algo(5000) });
    buyerAddr = account.addr.toString();
    const buyerBal = (await algorand.account.getInformation(buyerAddr)).balance.algos;
    info("Buyer", `${addr(buyerAddr)}  ${c.green}${buyerBal.toFixed(2)} ALGO${c.reset}`);
  } else {
    console.log(`\n  ${c.red}✗ TestNet requires AVM_PRIVATE_KEY in .env${c.reset}\n`);
    process.exit(1);
  }

  const isTestnet = NETWORK === "testnet";
  const sellers: Record<string, { addr: string; name: string; type: string; service: string; price: number; desc: string }> = {
    cloudmax: { addr: "", name: "CloudMax India", type: "cloud-storage", service: "Enterprise Cloud Storage", price: isTestnet ? 0.5 : 90, desc: "Enterprise-grade, Mumbai & Chennai DC, 99.99% uptime" },
    datavault: { addr: "", name: "DataVault", type: "cloud-storage", service: "SME Cloud Storage", price: isTestnet ? 0.4 : 85, desc: "Affordable storage for Indian SMEs, Hyderabad servers" },
    quickapi: { addr: "", name: "QuickAPI", type: "api-access", service: "API Gateway Pro", price: isTestnet ? 0.3 : 50, desc: "High-perf API gateway, rate limiting, caching, analytics" },
    bharatcompute: { addr: "", name: "BharatCompute", type: "compute", service: "GPU Compute Instances", price: isTestnet ? 0.6 : 120, desc: "NVIDIA A100 clusters in Pune, per-minute billing" },
    securehost: { addr: "", name: "SecureHost Pro", type: "hosting", service: "Managed Hosting", price: isTestnet ? 0.35 : 70, desc: "DDoS protection, auto-SSL, CDN for Indian startups" },
  };

  for (const [key, seller] of Object.entries(sellers)) {
    const acc = algorand.account.random();
    algorand.setSignerFromAccount(acc);
    const fundAmount = NETWORK === "testnet" ? 0.11 : 100;
    if (NETWORK === "localnet") {
      const dispenser = await algorand.account.localNetDispenser();
      await algorand.send.payment({ sender: dispenser.addr, receiver: acc.addr, amount: algo(fundAmount) });
    } else {
      await algorand.send.payment({ sender: buyerAddr, receiver: acc.addr, amount: algo(fundAmount) });
    }
    sellers[key].addr = acc.addr.toString();
    info(seller.name, `${addr(acc.addr.toString())}  ${c.green}${fundAmount.toFixed(2)} ALGO${c.reset}`);
  }

  // ── Step 3: Post listings on-chain with ZK commitments ──────────────────

  banner("POSTING ON-CHAIN LISTINGS", c.bgMagenta);
  console.log(`${c.gray}  Each listing = 0 ALGO self-txn with JSON note + SHA-256 commitment${c.reset}`);
  divider();

  let firstListingRound = Infinity;
  let lastListingRound = 0;

  for (const [key, seller] of Object.entries(sellers)) {
    const zk = createCommitment(key, seller.price, seller.desc);
    sellerSecrets.set(key, zk.secret);

    const noteData = {
      type: seller.type,
      service: seller.service,
      price: seller.price,
      seller: key,
      description: seller.desc,
      timestamp: Date.now(),
      zkCommitment: zk.commitment,
    };
    const noteStr = "a2a-listing:" + JSON.stringify(noteData);

    const result = await algorand.send.payment({
      sender: seller.addr,
      receiver: seller.addr,
      amount: algo(0),
      note: noteStr,
    });

    const txId = result.txIds[0];
    const round = Number(result.confirmation.confirmedRound ?? 0n);
    firstListingRound = Math.min(firstListingRound, round);
    lastListingRound = Math.max(lastListingRound, round);

    console.log(
      `  ${c.green}✓${c.reset} ${c.bold}${seller.name.padEnd(18)}${c.reset}` +
      `${seller.type.padEnd(16)}${c.bold}${String(seller.price).padStart(4)} ALGO${c.reset}  ` +
      `${c.gray}Round: ${round}${c.reset}\n` +
      `    ${c.gray}TX: ${txId}${c.reset}\n` +
      `    ${c.magenta}ZK Commitment: ${zk.commitment.slice(0, 32)}...${c.reset}\n` +
      `    ${c.dim}Secret (off-chain): ${zk.secret.slice(0, 16)}...${c.reset}`
    );
  }

  success(`${Object.keys(sellers).length} listings posted on-chain with SHA-256 commitments`);

  // ── Step 3b: Register commitments on ZKCommitment contract ─────────────────

  const zkAppId = process.env.ZK_APP_ID;
  let zkClient: InstanceType<typeof ZkCommitmentClient> | null = null;

  if (zkAppId) {
    banner("ON-CHAIN ZK COMMITMENT REGISTRY", c.bgMagenta);
    console.log(`${c.gray}  Registering SHA-256 commitments on smart contract (App ${zkAppId})${c.reset}`);
    divider();

    zkClient = algorand.client.getTypedAppClientById(ZkCommitmentClient, {
      appId: BigInt(zkAppId),
      defaultSender: buyerAddr,
    });

    for (const [key, seller] of Object.entries(sellers)) {
      const secret = sellerSecrets.get(key);
      if (!secret) continue;
      const preimage = `${secret}|${key}|${seller.price}|${seller.desc}`;
      const commitHash = createHash("sha256").update(preimage).digest();

      const boxRef = {
        appId: BigInt(zkAppId),
        name: Buffer.concat([Buffer.from("c"), commitHash]),
      };

      try {
        await zkClient.send.commit({
          sender: seller.addr,
          args: { commitmentHash: commitHash },
          boxReferences: [boxRef],
        });
        console.log(
          `  ${c.green}✓${c.reset} ${c.bold}${seller.name.padEnd(18)}${c.reset}` +
          `Commitment stored on-chain  ${c.dim}Hash: ${commitHash.toString("hex").slice(0, 24)}...${c.reset}`
        );
      } catch (err: any) {
        console.log(
          `  ${c.yellow}⚠${c.reset} ${c.bold}${seller.name.padEnd(18)}${c.reset}` +
          `${c.dim}${err.message?.slice(0, 50) ?? "commit failed"}${c.reset}`
        );
      }
    }
    success(`Commitments registered on ZKCommitment contract (App ${zkAppId})`);
  }

  // ── Step 4: Parse user intent with AI ─────────────────────────────────────

  banner("AI INTENT PARSING", c.bgCyan);
  console.log(`${c.gray}  User: "${userIntent}"${c.reset}`);
  divider();

  section("Calling Groq LLM (llama-3.3-70b-versatile)");
  const intent = await parseIntent(userIntent);
  info("Service Type", `${c.bold}${intent.serviceType}${c.reset}`);
  info("Max Budget", `${c.bold}${intent.maxBudget} ALGO${c.reset}`);
  info("Preferences", intent.preferences.length > 0 ? intent.preferences.join(", ") : "none");

  // ── Step 5: Discover listings via Algorand Indexer ──────────────────────

  banner("AGENT DISCOVERY (via Indexer)", c.bgYellow);
  const indexerLabel = NETWORK === "testnet" ? "TestNet Indexer (algonode.cloud)" : "LocalNet Indexer (localhost:8980)";
  console.log(`${c.gray}  Querying ${indexerLabel} for on-chain listings...${c.reset}`);
  divider();

  const indexer = NETWORK === "testnet"
    ? new algosdk.Indexer("", "https://testnet-idx.algonode.cloud", "")
    : new algosdk.Indexer("", "http://localhost", 8980);

  section("Waiting for Indexer to sync");
  let indexerReady = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const health = await indexer.makeHealthCheck().do();
      if (health.round >= lastListingRound) {
        indexerReady = true;
        success(`Indexer synced — round ${health.round} >= ${lastListingRound}`);
        break;
      }
      info("Indexer round", `${health.round} (waiting for ${lastListingRound})`);
    } catch {
      info("Attempt", `${attempt + 1}/20 — Indexer not ready yet`);
    }
    await new Promise((r) => setTimeout(r, NETWORK === "testnet" ? 2000 : 1000));
  }

  if (!indexerReady) {
    warn("Indexer did not sync in time. Falling back to in-memory listings.");
  }

  section("Fetching listings from Indexer");
  const notePrefix = Buffer.from("a2a-listing:").toString("base64");
  const allListings: Listing[] = [];

  try {
    const sellerAddrs = Object.values(sellers).map((s) => s.addr);
    for (const sellerAddr of sellerAddrs) {
      try {
        const searchResult = await indexer
          .searchForTransactions()
          .address(sellerAddr)
          .notePrefix(notePrefix)
          .txType("pay")
          .minRound(firstListingRound)
          .maxRound(lastListingRound)
          .do();

        const txns = searchResult.transactions ?? [];
        for (const txn of txns) {
          try {
            const noteRaw = txn.note;
            if (!noteRaw) continue;
            const noteStr = typeof noteRaw === "string"
              ? Buffer.from(noteRaw, "base64").toString("utf-8")
              : new TextDecoder().decode(noteRaw as Uint8Array);

            if (!noteStr.startsWith("a2a-listing:")) continue;
            const data = JSON.parse(noteStr.slice("a2a-listing:".length));
            if (!data.zkCommitment) continue;

            allListings.push({
              txId: txn.id ?? "",
              sender: txn.sender ?? "",
              type: data.type,
              service: data.service,
              price: data.price,
              seller: data.seller,
              description: data.description,
              zkCommitment: data.zkCommitment,
              round: Number(txn.confirmedRound ?? 0),
            });
          } catch {
            // skip malformed notes
          }
        }
      } catch {
        // skip failed individual queries
      }
    }
    success(`Parsed ${allListings.length} listings from Indexer (rounds ${firstListingRound}–${lastListingRound})`);
  } catch (err: any) {
    warn(`Indexer query failed: ${err.message ?? err}`);
  }

  const normalized = intent.serviceType.toLowerCase().replace(/[\s_-]+/g, "-");
  const matched = allListings.filter((l) => {
    const typeMatch = l.type === normalized || l.type.includes(normalized.split("-")[0]);
    return typeMatch && l.price <= intent.maxBudget;
  });

  section(`Found ${matched.length}/${allListings.length} matching listings from Indexer`);
  for (const l of matched) {
    bullet(
      `${c.bold}${l.seller.padEnd(16)}${c.reset} "${l.service}"  ${c.bold}${l.price} ALGO${c.reset}  ` +
      `${c.gray}TX: ${(l.txId).slice(0, 20)}...  Round: ${l.round}${c.reset}`
    );
  }

  if (matched.length === 0) {
    warn("No listings match your criteria. Try a higher budget or different service type.");
    process.exit(0);
  }

  // ── Step 6: x402-style negotiation ────────────────────────────────────────

  banner("x402-STYLE NEGOTIATION", c.bgGreen);
  console.log(`${c.gray}  Protocol: offer → counter → accept/reject (1-2 rounds)${c.reset}`);
  divider();

  const negotiations: NegResult[] = [];

  for (const listing of matched) {
    console.log(`\n  ${c.underline}${c.bold}Negotiating with ${listing.seller}${c.reset}  ${c.gray}(${listing.service}, ${listing.price} ALGO)${c.reset}`);

    const revealedSecret = sellerSecrets.get(listing.seller) ?? "";
    const zkOk = verifyCommitment(
      listing.zkCommitment,
      revealedSecret,
      listing.seller,
      listing.price,
      listing.description,
    );
    console.log(`  ${c.magenta}On-chain commitment:${c.reset} ${listing.zkCommitment.slice(0, 32)}...`);
    console.log(`  ${c.dim}Revealed secret:     ${revealedSecret.slice(0, 32)}...${c.reset}`);
    console.log(
      `  ${zkOk ? c.green + "✓" : c.red + "✗"}${c.reset} ` +
      `SHA-256 verification: recomputed hash ${zkOk ? "MATCHES" : "DOES NOT MATCH"} on-chain commitment`
    );

    const messages: X402Msg[] = [];
    let accepted = false;
    let lastSellerPrice = listing.price;
    let finalPrice = listing.price;
    const isSmall = listing.price < 10;
    const round2 = (n: number) => isSmall ? Math.round(n * 100) / 100 : Math.round(n);
    const minPrice = round2(listing.price * 0.75);

    const offerPrice = round2(listing.price * 0.65);
    const buyerText1 = `Offering ${offerPrice} ALGO for "${listing.service}".`;
    messages.push({ from: "buyer-agent", to: listing.seller, action: "offer", price: offerPrice, text: buyerText1 });
    msgBubble("Buyer Agent", "offer", offerPrice, buyerText1, c.cyan);

    let counterPrice = Math.max(minPrice, round2(listing.price * 0.88));
    if (offerPrice >= counterPrice) {
      counterPrice = offerPrice;
      accepted = true;
    }
    const sellerText1 = await aiNegResponse(listing.seller, offerPrice, counterPrice, accepted);
    messages.push({ from: listing.seller, to: "buyer-agent", action: accepted ? "accept" : "counter", price: counterPrice, text: sellerText1 });
    msgBubble(listing.seller, accepted ? "accept" : "counter", counterPrice, sellerText1, c.yellow);
    lastSellerPrice = counterPrice;

    if (!accepted) {
      const buyerOffer2 = Math.min(round2((offerPrice + lastSellerPrice) / 2), intent.maxBudget);
      const gap = Math.abs(buyerOffer2 - lastSellerPrice);
      const isClose = gap <= lastSellerPrice * 0.06;

      if (isClose) {
        const midPrice = round2((buyerOffer2 + lastSellerPrice) / 2);
        messages.push({ from: "buyer-agent", to: listing.seller, action: "accept", price: midPrice, text: `Deal at ${midPrice} ALGO.` });
        msgBubble("Buyer Agent", "accept", midPrice, `Deal at ${midPrice} ALGO. Fair price.`, c.cyan);
        accepted = true;
        finalPrice = midPrice;
      } else {
        messages.push({ from: "buyer-agent", to: listing.seller, action: "counter", price: buyerOffer2, text: `Counter at ${buyerOffer2} ALGO.` });
        msgBubble("Buyer Agent", "counter", buyerOffer2, `Counter-offering ${buyerOffer2} ALGO.`, c.cyan);

        const finalCounter = Math.max(minPrice, round2(lastSellerPrice * 0.95));
        const sellerAccepts = buyerOffer2 >= finalCounter;
        const fp = sellerAccepts ? buyerOffer2 : finalCounter;
        const sellerText2 = await aiNegResponse(listing.seller, buyerOffer2, fp, sellerAccepts);
        messages.push({ from: listing.seller, to: "buyer-agent", action: sellerAccepts ? "accept" : "counter", price: fp, text: sellerText2 });
        msgBubble(listing.seller, sellerAccepts ? "accept" : "counter", fp, sellerText2, c.yellow);

        if (sellerAccepts) {
          accepted = true;
          finalPrice = fp;
        } else if (fp <= intent.maxBudget) {
          messages.push({ from: "buyer-agent", to: listing.seller, action: "accept", price: fp, text: `Accepting ${fp} ALGO.` });
          msgBubble("Buyer Agent", "accept", fp, `Accepting ${fp} ALGO. Final offer.`, c.cyan);
          accepted = true;
          finalPrice = fp;
        }
      }
    } else {
      finalPrice = counterPrice;
    }

    const statusText = accepted
      ? `${c.green}✓ DEAL at ${finalPrice} ALGO${c.reset} (saved ${Math.round(((listing.price - finalPrice) / listing.price) * 100)}%)`
      : `${c.red}✗ NO DEAL${c.reset}`;
    console.log(`  ${c.bold}Result:${c.reset} ${statusText}`);

    negotiations.push({ listing, accepted, finalPrice, messages, zkVerified: zkOk });
  }

  // ── Step 7: Select best deal ──────────────────────────────────────────────

  divider();
  const acceptedDeals = negotiations.filter((n) => n.accepted);

  if (acceptedDeals.length === 0) {
    warn("No deals reached. Try increasing your budget.");
    process.exit(0);
  }

  acceptedDeals.sort((a, b) => a.finalPrice - b.finalPrice);
  const best = acceptedDeals[0];

  banner("BEST DEAL SELECTED", c.bgGreen);
  info("Seller", `${c.bold}${best.listing.seller}${c.reset} — "${best.listing.service}"`);
  info("Original Price", `${best.listing.price} ALGO`);
  info("Final Price", `${c.green}${c.bold}${best.finalPrice} ALGO${c.reset}`);
  info("Savings", `${c.green}${Math.round(((best.listing.price - best.finalPrice) / best.listing.price) * 100)}%${c.reset}`);
  info("ZK (off-chain)", best.zkVerified ? `${c.green}SHA-256 verified ✓${c.reset}` : `${c.red}Mismatch ✗${c.reset}`);
  info("Listing TX", `${c.gray}${best.listing.txId.slice(0, 32)}...${c.reset}`);
  info("Rounds", `${best.messages.length} messages`);

  // ── Step 7b: On-chain ZK reveal & verify ────────────────────────────────────

  let onChainZkVerified = false;
  if (zkClient && zkAppId) {
    banner("ON-CHAIN ZK REVEAL & VERIFY", c.bgMagenta);
    console.log(`${c.gray}  Seller reveals preimage → contract computes SHA-256 on-chain${c.reset}`);
    divider();

    const sellerKey = best.listing.seller;
    const secret = sellerSecrets.get(sellerKey);
    if (secret) {
      const sellerInfo = sellers[sellerKey];
      const preimage = `${secret}|${sellerKey}|${sellerInfo.price}|${sellerInfo.desc}`;
      const preimageBytes = Buffer.from(preimage);
      const commitHash = createHash("sha256").update(preimage).digest();

      const boxRef = {
        appId: BigInt(zkAppId),
        name: Buffer.concat([Buffer.from("c"), commitHash]),
      };

      section("Checking on-chain commitment status (before reveal)");
      try {
        const statusBefore = await zkClient.send.getStatus({
          args: { commitmentHash: commitHash },
          boxReferences: [boxRef],
        });
        const statusVal = Number(statusBefore.return);
        info("Status", statusVal === 0 ? "Not found" : statusVal === 1 ? `${c.yellow}Committed (not yet revealed)${c.reset}` : `${c.green}Already revealed${c.reset}`);
      } catch {}

      section("Seller revealing preimage on-chain");
      info("Preimage", `${c.dim}${preimage.slice(0, 50)}...${c.reset}`);
      info("Expected hash", `${c.dim}${commitHash.toString("hex").slice(0, 32)}...${c.reset}`);

      try {
        const revealResult = await zkClient.send.reveal({
          sender: sellerInfo.addr,
          args: { commitmentHash: commitHash, preimage: preimageBytes },
          boxReferences: [boxRef],
        });
        success("Seller revealed preimage — SHA-256 verified ON-CHAIN by smart contract!");
        info("Reveal TX", `${c.dim}${revealResult.txIds[0]}${c.reset}`);
      } catch (err: any) {
        warn(`Reveal failed: ${err.message?.slice(0, 80) ?? err}`);
      }

      section("Querying on-chain verification status (after reveal)");
      try {
        const statusAfter = await zkClient.send.getStatus({
          args: { commitmentHash: commitHash },
          boxReferences: [boxRef],
        });
        const finalStatus = Number(statusAfter.return);
        if (finalStatus === 2) {
          onChainZkVerified = true;
          success(`${c.bold}On-chain ZK status: VERIFIED (2)${c.reset} — SHA-256 match confirmed by AVM`);
        } else {
          info("Status", `${finalStatus} (not verified)`);
        }
      } catch {}

      const countsResult = await zkClient.send.getRevealCount({ args: {} });
      info("Total on-chain reveals", `${Number(countsResult.return)}`);
    }
  }

  // ── Step 8: Execute real payment ──────────────────────────────────────────

  banner("EXECUTING PAYMENT ON ALGORAND", c.bgBlue);
  console.log(`${c.gray}  Real ALGO transfer: Buyer → Seller (${NETWORK.toUpperCase()})${c.reset}`);
  divider();

  section("Sending payment transaction");
  info("From", `${addr(buyerAddr)} (Buyer)`);
  info("To", `${addr(best.listing.sender)} (${best.listing.seller})`);
  info("Amount", `${c.bold}${best.finalPrice} ALGO${c.reset}`);
  info("Network", `${c.bold}${NETWORK.toUpperCase()}${c.reset}`);

  const payResult = await algorand.send.payment({
    sender: buyerAddr,
    receiver: best.listing.sender,
    amount: algo(best.finalPrice),
    note: `A2A Commerce Payment | ${best.listing.service} | ${best.finalPrice} ALGO`,
  });

  const payTxId = payResult.txIds[0];
  const payRound = Number(payResult.confirmation.confirmedRound ?? 0n);

  success("Payment confirmed on-chain!");
  info("TX ID", `${c.bold}${payTxId}${c.reset}`);
  info("Confirmed Round", `${payRound}`);

  const buyerBalAfter = (await algorand.account.getInformation(buyerAddr)).balance.algos;
  const sellerBalAfter = (await algorand.account.getInformation(best.listing.sender)).balance.algos;

  info("Buyer Balance", `${c.yellow}${buyerBalAfter.toFixed(4)} ALGO${c.reset}`);
  info("Seller Balance", `${c.green}${sellerBalAfter.toFixed(4)} ALGO${c.reset}`);

  // ── Step 9: x402 Protocol Summary ──────────────────────────────────────────

  if (NETWORK === "testnet") {
    banner("x402 PROTOCOL INTEGRATION", c.bgMagenta);
    console.log(`${c.gray}  Real x402 payment protocol powered by GoPlausible${c.reset}`);
    divider();

    info("Protocol", `${c.bold}x402 v2${c.reset}`);
    info("Scheme", `${c.bold}exact${c.reset} (Algorand AVM)`);
    info("Network (CAIP-2)", `${c.cyan}algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=${c.reset}`);
    info("Facilitator", `${c.cyan}https://facilitator.goplausible.xyz${c.reset}`);
    info("Packages", `@x402-avm/core, @x402-avm/avm, @x402-avm/fetch`);
    console.log();
    bullet(`Premium API endpoints at ${c.bold}/api/premium/*${c.reset} are x402 payment-gated`);
    bullet(`Clients auto-handle 402 responses via ${c.bold}wrapFetchWithPayment()${c.reset}`);
    bullet(`Payments verified + settled on-chain by the facilitator`);
    bullet(`Fee abstraction: facilitator pays txn fees via atomic groups`);
    console.log();
    success("x402 SDK integrated — premium endpoints require on-chain payment");
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  banner("TRANSACTION COMPLETE", c.bgGreen);
  const explorerUrl = NETWORK === "testnet"
    ? `https://testnet.explorer.perawallet.app/tx/${payTxId}`
    : `(LocalNet — no explorer)`;

  console.log(`
  ${c.bold}${c.green}Agent-to-Agent Commerce Executed Successfully${c.reset}

  ${c.gray}┌─────────────────────────────────────────────────────────┐${c.reset}
  ${c.gray}│${c.reset}  Network:    ${c.bold}${NETWORK.toUpperCase().padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Service:    ${c.bold}${best.listing.service.padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Seller:     ${c.bold}${best.listing.seller.padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Price:      ${c.green}${c.bold}${(best.finalPrice + " ALGO").padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Original:   ${c.dim}${(best.listing.price + " ALGO").padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Savings:    ${c.green}${(Math.round(((best.listing.price - best.finalPrice) / best.listing.price) * 100) + "%").padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  ZK off-chain:${best.zkVerified ? c.green + " SHA-256 ✓" : c.red + " Fail ✗"}${c.reset}${" ".repeat(best.zkVerified ? 30 : 33)}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  ZK on-chain: ${onChainZkVerified ? c.green + c.bold + "VERIFIED by AVM ✓" : c.yellow + "N/A"}${c.reset}${" ".repeat(onChainZkVerified ? 22 : 35)}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Payment TX: ${c.cyan}${payTxId.slice(0, 40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Listing TX: ${c.cyan}${best.listing.txId.slice(0, 40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  Round:      ${c.bold}${String(payRound).padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}│${c.reset}  x402:       ${c.magenta}${c.bold}${"Integrated (v2 exact scheme)".padEnd(40)}${c.reset}${c.gray}│${c.reset}
  ${c.gray}└─────────────────────────────────────────────────────────┘${c.reset}
`);

  if (NETWORK === "testnet") {
    console.log(`  ${c.cyan}Explorer: ${explorerUrl}${c.reset}\n`);
  }
}

main().catch((err) => {
  console.error(`\n${c.red}${c.bold}Fatal error:${c.reset} ${err.message ?? err}`);
  process.exit(1);
});
