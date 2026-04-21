import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { CGUSD, MockERC20, CGUSD__factory, MockERC20__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  clark: HardhatEthersSigner;
};

async function deployMockUnitToken() {
  const factory = (await ethers.getContractFactory("MockERC20")) as MockERC20__factory;
  const mockERC20Contract = (await factory.deploy("Mock ERC20", "m20")) as MockERC20;
  const mockERC20ContractAddress = await mockERC20Contract.getAddress();

  return { mockERC20Contract, mockERC20ContractAddress };
}

async function deployCGUSD(unitToken: string) {
  const factory = (await ethers.getContractFactory("cGUSD")) as CGUSD__factory;
  const cGUSDContract = (await factory.deploy(unitToken, "Confidential Generic USD", "cGUSD", "https://example.com/tokenURI")) as CGUSD;
  const cGUSDContractAddress = await cGUSDContract.getAddress();

  return { cGUSDContract, cGUSDContractAddress };
}

describe("cGUSD", function () {
  let signers: Signers;
  let mockERC20Contract: MockERC20;
  let mockERC20ContractAddress: string;
  let cGUSDContract: CGUSD;
  let cGUSDContractAddress: string;
  let initialSupply: number = 1000;
  let receivers: HardhatEthersSigner[];

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], clark: ethSigners[3] };

    receivers = [ethSigners[4], ethSigners[5], ethSigners[6]];
  });

  beforeEach(async function () {
    // Check whether the tests are running against an FHEVM mock environment
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ mockERC20Contract, mockERC20ContractAddress } = await deployMockUnitToken());
    ({ cGUSDContract, cGUSDContractAddress } = await deployCGUSD(mockERC20ContractAddress));

    await mockERC20Contract.mint(signers.alice.address, initialSupply);
    await mockERC20Contract.connect(signers.alice).approve(cGUSDContractAddress, initialSupply);
    await cGUSDContract.connect(signers.alice).wrap(initialSupply);

    await mockERC20Contract.mint(signers.bob.address, initialSupply);
    await mockERC20Contract.connect(signers.bob).approve(cGUSDContractAddress, initialSupply);
    await cGUSDContract.connect(signers.bob).wrap(initialSupply);

    await mockERC20Contract.mint(signers.clark.address, initialSupply);
    await mockERC20Contract.connect(signers.clark).approve(cGUSDContractAddress, initialSupply);
    await cGUSDContract.connect(signers.clark).wrap(initialSupply);
  });

  it("fetch current balance of owner", async function() {
    const encryptedBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedBalance,
      cGUSDContractAddress,
      signers.alice,
    );

    expect(clearBalance).to.eq(initialSupply);
  });

  it("transfer cGUSD from owner to another user", async function() {
    const clearTransferAmount = 250;
    const encryptedTransferAmount = await fhevm
      .createEncryptedInput(cGUSDContractAddress, signers.alice.address)
      .add128(clearTransferAmount)
      .encrypt();

    const tx = await cGUSDContract
      .connect(signers.alice)
      ["confidentialTransfer(address,bytes32,bytes)"](
        signers.bob.address,
        encryptedTransferAmount.handles[0],
        encryptedTransferAmount.inputProof,
      );
    await tx.wait();

    const encryptedAliceBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    const clearAliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedAliceBalance,
      cGUSDContractAddress,
      signers.alice,
    );
    expect(clearAliceBalance).to.eq(initialSupply - clearTransferAmount);

    const encryptedBobBalance = await cGUSDContract.confidentialBalanceOf(signers.bob.address);
    const clearBobBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedBobBalance,
      cGUSDContractAddress,
      signers.bob,
    );
    expect(clearBobBalance).to.eq(initialSupply + clearTransferAmount);
  });

  it("reveal encrypted balance to another user", async function() {
    const encryptedAliceBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);

    // Alice reveals the encrypted balance to Bob
    const txReveal = await cGUSDContract
      .connect(signers.alice)
      .reveal(encryptedAliceBalance, signers.bob.address);
    await txReveal.wait();

    // Bob can now decrypt the revealed encrypted balance
    const clearDecryptedBalanceByBob = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedAliceBalance,
      cGUSDContractAddress,
      signers.bob,
    );
    expect(clearDecryptedBalanceByBob).to.eq(initialSupply);
  });

  it("reveal encrypted amount to another user", async function() {
    const clearTransferAmount = 250;
    const encryptedTransferAmount = await fhevm
      .createEncryptedInput(cGUSDContractAddress, signers.alice.address)
      .add128(clearTransferAmount)
      .encrypt();

    const tx = await cGUSDContract
      .connect(signers.alice)
      ["confidentialTransfer(address,bytes32,bytes)"](
        signers.bob.address,
        encryptedTransferAmount.handles[0],
        encryptedTransferAmount.inputProof,
      );
    const receipt = await tx.wait();
    const log = receipt!.logs.find((log) => log.eventName === "ConfidentialTransfer");
    const transferAmount = log.args[2];

    // Alice reveals the encrypted amount to Clark
    const txReveal = await cGUSDContract
      .connect(signers.alice)
      .reveal(transferAmount, signers.clark.address);
    await txReveal.wait();

    // Bob can now decrypt the revealed encrypted balance
    const clearDecryptedBalanceByClark = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      transferAmount,
      cGUSDContractAddress,
      signers.clark,
    );
    expect(clearDecryptedBalanceByClark).to.eq(clearTransferAmount);
  });

  it("execute private transfer", async function() {
    // set secret
    const secret = BigInt(1);
    const encryptedSecret = await fhevm
        .createEncryptedInput(cGUSDContractAddress, signers.alice.address)
        .add256(secret)
        .encrypt();

    const secretTx = await cGUSDContract.connect(signers.alice).updateSecret(
        encryptedSecret.handles[0],
        encryptedSecret.inputProof
    );
    await secretTx.wait();

    // execute private transfer from alice to receiver on index 1

    const from = [signers.alice.address, signers.bob.address, signers.clark.address].sort();
    const to = [receivers[0].address, receivers[1].address, receivers[2].address].sort();

    const clearTransferAmount = 250;
    const clearReceiverChanges = [0, clearTransferAmount, 0];

    const encryptedTransferAmounts = await fhevm
      .createEncryptedInput(cGUSDContractAddress, signers.alice.address) // need to pass alice or deployer as signer?
      .add128(clearTransferAmount)
      .add128(clearReceiverChanges[0])
      .add128(clearReceiverChanges[1])
      .add128(clearReceiverChanges[2])
      .encrypt();

    const encAmountHandle = encryptedTransferAmounts.handles[0];
    const encReceiverChanges = [encryptedTransferAmounts.handles[1], encryptedTransferAmounts.handles[3], encryptedTransferAmounts.handles[2]];

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedInput = abiCoder.encode(["address[]", "address[]", "bytes32", "bytes32[]"], [from, to, encAmountHandle, encReceiverChanges]);
    const inputHash = ethers.keccak256(encodedInput);
    const commitment = BigInt(secret) ^ BigInt(inputHash);

    const encryptedTransferCommitment = await fhevm
      .createEncryptedInput(cGUSDContractAddress, signers.alice.address) // need to pass alice or deployer as signer?
      .add256(commitment)
      .encrypt();

    const privateTransferTx = await cGUSDContract.connect(signers.alice).privateTransfer(
        from,
        to,
        encAmountHandle,
        encReceiverChanges,
        encryptedTransferAmounts.inputProof,
        encryptedTransferCommitment.handles[0],
        encryptedTransferCommitment.inputProof,
    );
    await privateTransferTx.wait();

    // check final state

    const encryptedAliceBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    const clearAliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedAliceBalance,
      cGUSDContractAddress,
      signers.alice,
    );
    expect(clearAliceBalance).to.eq(initialSupply - clearTransferAmount);

    const encryptedBobBalance = await cGUSDContract.confidentialBalanceOf(signers.bob.address);
    const clearBobBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedBobBalance,
      cGUSDContractAddress,
      signers.bob,
    );
    expect(clearBobBalance).to.eq(initialSupply);

    const encryptedClarkBalance = await cGUSDContract.confidentialBalanceOf(signers.clark.address);
    const clearClarkBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedClarkBalance,
      cGUSDContractAddress,
      signers.clark,
    );
    expect(clearClarkBalance).to.eq(initialSupply);

    let encryptedReceiverBalance = await cGUSDContract.confidentialBalanceOf(receivers[0].address);
    let clearReceiverBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedReceiverBalance,
      cGUSDContractAddress,
      receivers[0],
    );
    expect(clearReceiverBalance).to.eq(0);

    encryptedReceiverBalance = await cGUSDContract.confidentialBalanceOf(receivers[1].address);
    clearReceiverBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedReceiverBalance,
      cGUSDContractAddress,
      receivers[1],
    );
    expect(clearReceiverBalance).to.eq(clearTransferAmount);

    encryptedReceiverBalance = await cGUSDContract.confidentialBalanceOf(receivers[2].address);
    clearReceiverBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedReceiverBalance,
      cGUSDContractAddress,
      receivers[2],
    );
    expect(clearReceiverBalance).to.eq(0);
  });
});
