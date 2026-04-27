import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { CGUSD, MockERC20, CGUSD__factory, MockERC20__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import {
  initSDK,
  createInstance,
  SepoliaConfig,
} from '@zama-fhe/relayer-sdk/bundle';

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

async function fetchClearBalance(cGUSDContract: CGUSD, signer: HardhatEthersSigner) {
    let encryptedBalance = await cGUSDContract.confidentialBalanceOf(signer.address);
    return fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedBalance,
        await cGUSDContract.getAddress(),
        signer,
    );
}

async function updateSecret(cGUSDContract: CGUSD, signer: HardhatEthersSigner, secret: BigInt) {
    const encryptedSecret = await fhevm
        .createEncryptedInput(await cGUSDContract.getAddress(), signer.address)
        .add256(secret)
        .encrypt();

    const secretTx = await cGUSDContract.connect(signer).updateSecret(
        encryptedSecret.handles[0],
        encryptedSecret.inputProof
    );
    await secretTx.wait();
}

async function anonymousTransfer(cGUSDContract: CGUSD, relayer: HardhatEthersSigner, secret: BigInt, anons: string[], clearBalanceChanges: number[], senderIndex: number) {
    const cGUSDContractAddress = await cGUSDContract.getAddress();

    // Transfer inputs
    let transferInputs = fhevm
        .createEncryptedInput(cGUSDContractAddress, relayer.address)
    for (const change of clearBalanceChanges) {
      transferInputs.add64(change)
    }
    const encryptedInputs = await transferInputs.encrypt();

    // Input commitment
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedInput = abiCoder.encode(["address[]", "bytes32[]"], [anons, encryptedInputs.handles]);
    const inputHash = ethers.keccak256(encodedInput);
    const encodedSenderInput = abiCoder.encode(["bytes32", "address"], [inputHash, anons[senderIndex]]);
    const senderInputHash = ethers.keccak256(encodedSenderInput);
    const commitment = BigInt(secret) ^ BigInt(senderInputHash);
    const encryptedCommitment = await fhevm
      .createEncryptedInput(cGUSDContractAddress, relayer.address)
      .add256(commitment)
      .encrypt();

    // Execute transfer
    const privateTransferTx = await cGUSDContract.connect(relayer).anonymousTransfer(
        anons,
        encryptedInputs.handles,
        encryptedInputs.inputProof,
        encryptedCommitment.handles[0],
        encryptedCommitment.inputProof,
    );
    return await privateTransferTx.wait();
}

describe("cGUSD", function () {
  let ethSigners: HardhatEthersSigner[];
  let signers: Signers;
  let mockERC20Contract: MockERC20;
  let mockERC20ContractAddress: string;
  let cGUSDContract: CGUSD;
  let cGUSDContractAddress: string;
  let initialSupply: number = 1000;
  let receivers: HardhatEthersSigner[];
  let relayer: HardhatEthersSigner;

  const secret = 1n;

  before(async function () {
    ethSigners = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], clark: ethSigners[3] };
    receivers = ethSigners.slice(0,6);
    relayer = ethSigners[7];
  });

  beforeEach(async function () {
    // Check whether the tests are running against an FHEVM mock environment
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ mockERC20Contract, mockERC20ContractAddress } = await deployMockUnitToken());
    ({ cGUSDContract, cGUSDContractAddress } = await deployCGUSD(mockERC20ContractAddress));

    for (const receiver of receivers) {
        await mockERC20Contract.mint(receiver.address, initialSupply);
        await mockERC20Contract.connect(receiver).approve(cGUSDContractAddress, initialSupply);
        await cGUSDContract.connect(receiver).wrap(initialSupply);
        await updateSecret(cGUSDContract, receiver, secret);
    }
  });

  it("fetch current balance of owner", async function() {
    const encryptedBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
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
      .add64(clearTransferAmount)
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
      FhevmType.euint64,
      encryptedAliceBalance,
      cGUSDContractAddress,
      signers.alice,
    );
    expect(clearAliceBalance).to.eq(initialSupply - clearTransferAmount);

    const encryptedBobBalance = await cGUSDContract.confidentialBalanceOf(signers.bob.address);
    const clearBobBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
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
      FhevmType.euint64,
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
      .add64(clearTransferAmount)
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
      FhevmType.euint64,
      transferAmount,
      cGUSDContractAddress,
      signers.clark,
    );
    expect(clearDecryptedBalanceByClark).to.eq(clearTransferAmount);
  });

  it("execute anonymous transfer", async function() {
    // execute anonymous transfer from alice to receiver on index 1
    const anons = receivers.toSorted((a, b) => Number(a.address) - Number(b.address));
    const clearBalanceChanges = [0, 250, 0, 100, 150, 0];
    await anonymousTransfer(cGUSDContract, relayer, secret, anons.map((x) => x.address), clearBalanceChanges, 1);

    // check final state
    expect(await fetchClearBalance(cGUSDContract, anons[0])).to.eq(initialSupply, "Incorrect balance: 0");
    expect(await fetchClearBalance(cGUSDContract, anons[1])).to.eq(initialSupply - 250, "Incorrect balance: 1");
    expect(await fetchClearBalance(cGUSDContract, anons[2])).to.eq(initialSupply, "Incorrect balance: 2");
    expect(await fetchClearBalance(cGUSDContract, anons[3])).to.eq(initialSupply + 100, "Incorrect balance: 3");
    expect(await fetchClearBalance(cGUSDContract, anons[4])).to.eq(initialSupply + 150, "Incorrect balance: 4");
    expect(await fetchClearBalance(cGUSDContract, anons[5])).to.eq(initialSupply, "Incorrect balance: 5");
  });

  it("request SWLE view", async function() {
    const encryptedAliceBalanceBefore = await cGUSDContract.confidentialBalanceOf(signers.alice.address);

    const clearTransferAmount = 250;
    const encryptedTransferAmount = await fhevm
      .createEncryptedInput(cGUSDContractAddress, signers.alice.address)
      .add64(clearTransferAmount)
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

    const encryptedAliceBalanceAfter = await cGUSDContract.confidentialBalanceOf(signers.alice.address);

    const swleBalanceAfterTx = await cGUSDContract.connect(signers.clark).requestSpyWithMyLittleEyeView(encryptedAliceBalanceAfter);
    await swleBalanceAfterTx.wait();

    const clearAliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedAliceBalanceAfter,
      cGUSDContractAddress,
      signers.clark,
    );
    expect(clearAliceBalance).to.eq(initialSupply - clearTransferAmount);

    const swleBalanceBeforeTx = await cGUSDContract.connect(signers.clark).requestSpyWithMyLittleEyeView(encryptedAliceBalanceBefore);
    await swleBalanceBeforeTx.wait();

    const clearAliceBalanceBefore = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedAliceBalanceBefore,
      cGUSDContractAddress,
      signers.clark,
    );
    expect(clearAliceBalanceBefore).to.eq(initialSupply);

    const swleTransferAmountTx = await cGUSDContract.connect(signers.clark).requestSpyWithMyLittleEyeView(transferAmount);
    await swleTransferAmountTx.wait();

    const clearActualTransferAmount = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      transferAmount,
      cGUSDContractAddress,
      signers.clark,
    );
    expect(clearActualTransferAmount).to.eq(clearTransferAmount);
  });

  it("measure gas of anonymous transfer", async function() {
    // execute anonymous transfer from alice to receiver on index 1
    const signersSorted = ethSigners.map((x) => x.address).toSorted((a, b) => Number(a) - Number(b));

    let anons = signersSorted.slice(1, 5);
    let clearBalanceChanges = [250, 250, 0, 0];
    let receipt = await anonymousTransfer(cGUSDContract, relayer, secret, anons, clearBalanceChanges, 0);
    console.log(`4 anons gas used: ${receipt?.gasUsed}`);

    anons = signersSorted.slice(1, 9);
    for (let i = 0; i < 4; i++) { clearBalanceChanges.push(0); }
    receipt = await anonymousTransfer(cGUSDContract, relayer, secret, anons, clearBalanceChanges, 0);
    console.log(`8 anons gas used: ${receipt?.gasUsed}`);

    anons = signersSorted.slice(1, 13);
    for (let i = 0; i < 4; i++) { clearBalanceChanges.push(0); }
    receipt = await anonymousTransfer(cGUSDContract, relayer, secret, anons, clearBalanceChanges, 0);
    console.log(`12 anons gas used: ${receipt?.gasUsed}`);

    anons = signersSorted.slice(1, 14);
    clearBalanceChanges.push(0);
    receipt = await anonymousTransfer(cGUSDContract, relayer, secret, anons, clearBalanceChanges, 0);
    console.log(`13 anons gas used: ${receipt?.gasUsed}`);

    anons = signersSorted.slice(1, 15);
    clearBalanceChanges.push(0);
    receipt = await anonymousTransfer(cGUSDContract, relayer, secret, anons, clearBalanceChanges, 0);
    console.log(`14 anons gas used: ${receipt?.gasUsed}`);

    anons = signersSorted.slice(1, 16);
    clearBalanceChanges.push(0);
    receipt = await anonymousTransfer(cGUSDContract, relayer, secret, anons, clearBalanceChanges, 0);
    console.log(`15 anons gas used: ${receipt?.gasUsed}`);

    anons = signersSorted.slice(1, 17);
    clearBalanceChanges.push(0);
    receipt = await anonymousTransfer(cGUSDContract, relayer, secret, anons, clearBalanceChanges, 0);
    console.log(`16 anons gas used: ${receipt?.gasUsed}`);
  });
});
