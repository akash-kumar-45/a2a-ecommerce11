import { AlgorandClient, algo, Config } from "@algorandfoundation/algokit-utils";
import algosdk from "algosdk";
import dotenv from "dotenv";
import { ZkCommitmentFactory } from "../artifacts/zk_commitment/ZKCommitmentClient";

dotenv.config();
Config.configure({ logger: { error: () => {}, warn: () => {}, info: () => {}, verbose: () => {}, debug: () => {} } });

const c = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", cyan: "\x1b[36m", red: "\x1b[31m", yellow: "\x1b[33m", dim: "\x1b[2m", bgGreen: "\x1b[42m", bgBlue: "\x1b[44m" };

async function main() {
  console.log(`\n${c.bgBlue}${c.bold}  DEPLOY ZK COMMITMENT CONTRACT → TestNet                    ${c.reset}\n`);

  const privKey = process.env.AVM_PRIVATE_KEY;
  if (!privKey) { console.error(`  ${c.red}AVM_PRIVATE_KEY missing in .env${c.reset}`); process.exit(1); }

  const secretKey = Buffer.from(privKey, "base64");
  const admin = algosdk.mnemonicToSecretKey(algosdk.secretKeyToMnemonic(secretKey));
  const adminAddr = admin.addr.toString();

  const algorand = AlgorandClient.testNet();
  algorand.setSignerFromAccount(admin);

  const balance = (await algorand.account.getInformation(adminAddr)).balance.algos;
  console.log(`  ${c.cyan}Admin:${c.reset}   ${adminAddr}`);
  console.log(`  ${c.cyan}Balance:${c.reset} ${balance.toFixed(4)} ALGO`);

  if (balance < 1.5) {
    console.error(`  ${c.red}${c.bold}Insufficient balance!${c.reset} Need >=1.5 ALGO.`);
    console.log(`  ${c.yellow}Fund at: https://lora.algokit.io/testnet/fund${c.reset}\n`);
    process.exit(1);
  }

  console.log(`\n  ${c.cyan}Deploying ZKCommitment contract...${c.reset}`);
  const factory = algorand.client.getTypedAppFactory(ZkCommitmentFactory, { defaultSender: adminAddr });
  const { result, appClient } = await factory.send.create.createApplication({ args: [] });
  const appId = appClient.appId;
  const appAddr = appClient.appAddress.toString();

  console.log(`  ${c.green}${c.bold}✓ Deployed!${c.reset}`);
  console.log(`  ${c.dim}App ID:   ${appId}${c.reset}`);
  console.log(`  ${c.dim}App Addr: ${appAddr}${c.reset}`);
  console.log(`  ${c.dim}TX:       ${result.txIds[0]}${c.reset}`);
  console.log(`  ${c.dim}Explorer: https://testnet.explorer.perawallet.app/application/${appId}${c.reset}`);

  console.log(`\n  ${c.cyan}Funding app for BoxMap MBR...${c.reset}`);
  await algorand.send.payment({ sender: adminAddr, receiver: appAddr, amount: algo(0.5) });
  console.log(`  ${c.green}✓ App funded with 0.5 ALGO${c.reset}`);

  console.log(`\n${c.bgGreen}${c.bold}  Add this to your .env:                                      ${c.reset}`);
  console.log(`  ZK_APP_ID=${appId}`);
  console.log(`  ZK_APP_ADDR=${appAddr}\n`);
}

main().catch((err) => {
  console.error(`\n  ${c.red}Fatal: ${err.message ?? err}${c.reset}\n`);
  process.exit(1);
});
