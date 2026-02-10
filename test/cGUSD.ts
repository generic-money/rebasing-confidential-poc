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

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], clark: ethSigners[3] };
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
    expect(clearBobBalance).to.eq(clearTransferAmount);
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

  it("update user balance on multiplier increase", async function() {
    // increase supply to 150%
    await mockERC20Contract.mint(cGUSDContractAddress, initialSupply / 2);

    await cGUSDContract.syncMultiplier();
    await cGUSDContract.syncUserBalance(signers.alice.address);

    const encryptedBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedBalance,
      cGUSDContractAddress,
      signers.alice,
    );

    expect(clearBalance).to.eq((initialSupply * 3) / 2);

    const multiplier = await cGUSDContract.multiplier();
    expect(multiplier).to.eq(1500000000000000000n); // 1.5
  });

  it("update user balance on multiplier decrease", async function() {
    // increase supply to 150%
    await mockERC20Contract.burn(cGUSDContractAddress, initialSupply / 2);

    await cGUSDContract.syncMultiplier();
    await cGUSDContract.syncUserBalance(signers.alice.address);

    const encryptedBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedBalance,
      cGUSDContractAddress,
      signers.alice,
    );

    expect(clearBalance).to.eq(initialSupply / 2);

    const multiplier = await cGUSDContract.multiplier();
    expect(multiplier).to.eq(500000000000000000n); // 0.5
  });

  it("update user balance on multiplier increase on transfer", async function() {
    // increase supply to 150%
    await mockERC20Contract.mint(cGUSDContractAddress, initialSupply / 2);

    await cGUSDContract.syncMultiplier();
    let isAliceUpdated = await cGUSDContract.isUpToDate(signers.alice.address);
    expect(isAliceUpdated).to.eq(false);

    // do not sync user balance, test that the balance is updated on transfer with the new multiplier
    const clearTransferAmount = (initialSupply * 3) / 2; // transfer the entire balance after multiplier increase to trigger balance update
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

    isAliceUpdated = await cGUSDContract.isUpToDate(signers.alice.address);
    expect(isAliceUpdated).to.eq(true);

    const encryptedAliceBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    const clearAliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedAliceBalance,
      cGUSDContractAddress,
      signers.alice,
    );
    expect(clearAliceBalance).to.eq(0);

    const isBobUpdated = await cGUSDContract.isUpToDate(signers.bob.address);
    expect(isBobUpdated).to.eq(true);

    const encryptedBobBalance = await cGUSDContract.confidentialBalanceOf(signers.bob.address);
    const clearBobBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedBobBalance,
      cGUSDContractAddress,
      signers.bob,
    );
    expect(clearBobBalance).to.eq(clearTransferAmount);
  });

  it("test sync multiplier during unwrapping", async function() {
    const originalMultiplier = await cGUSDContract.multiplier();
    expect(originalMultiplier).to.eq(1000000000000000000n); // 1.0

    const unwrappingAmount = initialSupply / 2;
    const tx = await cGUSDContract.connect(signers.alice).unwrap(unwrappingAmount);
    const receipt = await tx.wait();
    const log = receipt!.logs.find((log) => log.eventName === "UnwrapRequested");
    const requestId = log.args[0];
    const unwrappingEncryptedAmount = log.args[2];

    await cGUSDContract.syncMultiplier();
    let multiplier = await cGUSDContract.multiplier();
    expect(multiplier).to.eq(originalMultiplier); // 1.0, should not change

    let unitAliceBalance = await mockERC20Contract.balanceOf(signers.alice.address);
    expect(unitAliceBalance).to.eq(0); // balance should not be transferred before claim

    let encryptedAliceBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    let clearAliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedAliceBalance,
      cGUSDContractAddress,
      signers.alice,
    );
    expect(clearAliceBalance).to.eq(initialSupply - unwrappingAmount); // confidential balance should be burned immediately

    // finish unwrapping by claiming the unwrapped units with the decryption proof of the unwrapping amount

    const clearUnwrappingResult = await fhevm.publicDecrypt([unwrappingEncryptedAmount]);
    await cGUSDContract.claimUnwrappedUnits(requestId, unwrappingAmount, clearUnwrappingResult.decryptionProof);

    // unwrapping finished

    await cGUSDContract.syncMultiplier();
    multiplier = await cGUSDContract.multiplier();
    expect(multiplier).to.eq(originalMultiplier); // 1.0, should not change

    unitAliceBalance = await mockERC20Contract.balanceOf(signers.alice.address);
    expect(unitAliceBalance).to.eq(unwrappingAmount); // balance should be transferred after claim

    encryptedAliceBalance = await cGUSDContract.confidentialBalanceOf(signers.alice.address);
    clearAliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint128,
      encryptedAliceBalance,
      cGUSDContractAddress,
      signers.alice,
    );
    expect(clearAliceBalance).to.eq(initialSupply - unwrappingAmount); // confidential balance should be the same as before claim
  });
});
