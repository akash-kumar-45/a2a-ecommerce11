import type { bytes, uint64 } from "@algorandfoundation/algorand-typescript";
import {
  abimethod,
  Account,
  assert,
  assertMatch,
  BoxMap,
  clone,
  Contract,
  GlobalState,
  op,
  Bytes,
  Txn,
  Uint64,
} from "@algorandfoundation/algorand-typescript";

/**
 * On-chain ZK Commitment Registry for A2A Commerce
 *
 * Sellers commit SHA-256(secret|seller|price|desc) on-chain.
 * After negotiation, sellers reveal the preimage; this contract
 * recomputes SHA-256 on-chain and marks the commitment verified.
 *
 * Storage: BoxMap keyed by the 32-byte commitment hash.
 */

type CommitmentRecord = {
  committer: Account;
  createdRound: uint64;
  isRevealed: uint64;
}

export class ZKCommitment extends Contract {
  admin = GlobalState<Account>();
  commitCount = GlobalState<uint64>({ initialValue: Uint64(0) });
  revealCount = GlobalState<uint64>({ initialValue: Uint64(0) });

  commitments = BoxMap<bytes<32>, CommitmentRecord>({ keyPrefix: "c" });

  @abimethod({ allowActions: "NoOp", onCreate: "require" })
  public createApplication(): void {
    this.admin.value = Txn.sender;
  }

  /**
   * Store a commitment hash on-chain.
   * The commitment is SHA-256(secret|seller|price|desc) computed off-chain.
   * The seller sends the 32-byte hash; the contract stores it.
   */
  public commit(commitmentHash: bytes<32>): void {
    assert(!this.commitments(commitmentHash).exists, "Commitment already exists");

    const record: CommitmentRecord = {
      committer: Txn.sender,
      createdRound: Uint64(0),
      isRevealed: Uint64(0),
    };
    this.commitments(commitmentHash).value = clone(record);
    this.commitCount.value = this.commitCount.value + Uint64(1);
  }

  /**
   * Reveal and verify a commitment on-chain.
   * The caller provides the preimage; the contract computes SHA-256 on-chain
   * and asserts it matches the stored commitment hash.
   */
  public reveal(commitmentHash: bytes<32>, preimage: bytes): void {
    assert(this.commitments(commitmentHash).exists, "Commitment not found");

    const record = clone(this.commitments(commitmentHash).value);
    assert(record.isRevealed === Uint64(0), "Already revealed");

    const computed: bytes<32> = op.sha256(preimage);
    assert(computed === commitmentHash, "SHA-256 mismatch: preimage does not match commitment");

    const updated = clone(record);
    updated.isRevealed = Uint64(1);
    this.commitments(commitmentHash).value = clone(updated);
    this.revealCount.value = this.revealCount.value + Uint64(1);
  }

  /**
   * Check if a commitment exists and whether it has been revealed.
   * Returns: 0 = not found, 1 = committed but not revealed, 2 = revealed & verified
   */
  @abimethod({ readonly: true })
  public getStatus(commitmentHash: bytes<32>): uint64 {
    if (!this.commitments(commitmentHash).exists) {
      return Uint64(0);
    }
    const record = clone(this.commitments(commitmentHash).value);
    if (record.isRevealed === Uint64(1)) {
      return Uint64(2);
    }
    return Uint64(1);
  }

  @abimethod({ readonly: true })
  public getCommitter(commitmentHash: bytes<32>): Account {
    assert(this.commitments(commitmentHash).exists, "Commitment not found");
    return clone(this.commitments(commitmentHash).value).committer;
  }

  @abimethod({ readonly: true })
  public getCommitCount(): uint64 {
    return this.commitCount.value;
  }

  @abimethod({ readonly: true })
  public getRevealCount(): uint64 {
    return this.revealCount.value;
  }

  @abimethod({ allowActions: "DeleteApplication" })
  public deleteApplication(): void {
    assertMatch(Txn, { sender: this.admin.value });
  }
}
