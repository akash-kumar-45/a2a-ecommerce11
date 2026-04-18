// Mock replacement for algosdk to prevent build failures

const algosdkMock: any = {
  makePaymentTxnWithSuggestedParamsFromObject: () => new Uint8Array(),
  makeApplicationNoOpTxnFromObject: () => new Uint8Array(),
  algosToMicroalgos: (a: number) => a * 1000000,
  microalgosToAlgos: (a: number) => a / 1000000,
  decodeAddress: () => ({ publicKey: new Uint8Array(32) }),
  mnemonicToSecretKey: () => ({ addr: "", sk: new Uint8Array() }),
  secretKeyToMnemonic: () => "",
  generateAccount: () => ({ addr: "", sk: new Uint8Array() }),
  isValidAddress: () => true,
  Transaction: class {},
  Algodv2: class {},
  Indexer: class {},
};

export default algosdkMock;
export const algosdk = algosdkMock;
