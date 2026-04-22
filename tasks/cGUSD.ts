import { task } from "hardhat/config";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { TaskArguments } from "hardhat/types";

const cGUSDAddress = "0xa335D08543A60745b1FA6b1220Df15E37538C795"; // latest cGUSD Sepolia deployment

task("c:wrap", "Wraps Mock20 tokens")
    .addParam("amount", "Amount to wrap")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const amount = parseInt(taskArguments.amount);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --amount is not an integer`);
        }

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        const tx = await cGUSD.wrap(amount);
        console.log(`Wait for tx: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${receipt?.status}`);

        console.log(`Wrapping ${amount} cGUSD succeeded!`);
    });


task("c:balance", "Fetch user confidential balance")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        await fhevm.initializeCLIApi();

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        const signers = await ethers.getSigners();
        const user = signers[0];

        const encryptedBalance = await cGUSD.confidentialBalanceOf(user.address);
        if (encryptedBalance === ethers.ZeroHash) {
            console.log(`encrypted balance: ${encryptedBalance}`);
            console.log("clear balance    : 0");
            return;
        }

        const clearBalance = await fhevm.userDecryptEuint(
            FhevmType.euint128,
            encryptedBalance,
            cGUSDAddress,
            user,
        );
        console.log(`Encrypted balance: ${encryptedBalance}`);
        console.log(`Clear balance    : ${clearBalance}`);
    });

task("c:transfer", "Transfer confidential tokens to receiver")
    .addParam("to", "Receiver address")
    .addParam("amount", "Transfer amount")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        await fhevm.initializeCLIApi();

        const to = taskArguments.to;
        const amount = parseInt(taskArguments.amount);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --amount is not an integer`);
        }

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        const signers = await ethers.getSigners();
        const user = signers[0];

        const encryptedValue = await fhevm
            .createEncryptedInput(cGUSDAddress, user.address)
            .add128(amount)
            .encrypt();

        const tx = await cGUSD.connect(user)["confidentialTransfer(address,bytes32,bytes)"](to, encryptedValue.handles[0], encryptedValue.inputProof);
        console.log(`Wait for tx: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${receipt?.status}`);

        console.log(`Transfer of ${amount} cGUSD succeeded!`);
    });

task("p:secret", "Set user secret")
    .addParam("secret", "User secret")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        await fhevm.initializeCLIApi();

        const secret = parseInt(taskArguments.secret);
        if (!Number.isInteger(secret)) {
            throw new Error(`Argument --secret is not an integer`);
        }

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        const signers = await ethers.getSigners();
        const user = signers[0];

        const encryptedValue = await fhevm
            .createEncryptedInput(cGUSDAddress, user.address)
            .add256(secret)
            .encrypt();

        const tx = await cGUSD.connect(user).updateSecret(encryptedValue.handles[0], encryptedValue.inputProof);
        console.log(`Wait for tx: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${receipt?.status}`);

        console.log(`User secret updated to ${secret}`);
    });

// atm only 1-to-1 transfer
task("p:transfer", "Execute private transfer")
    .addParam("to", "Receiver address")
    .addParam("amount", "Transfer amount")
    .addParam("secret", "Sender secret")
    .addParam("decoysenders", "Comma-separated list of decoy sender addresses")
    .addParam("decoyreceivers", "Comma-separated list of decoy receiver addresses")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        await fhevm.initializeCLIApi();

        const to = taskArguments.to;
        const amount = parseInt(taskArguments.amount);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --amount is not an integer`);
        }
        let senders: string[] = taskArguments.decoysenders
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        let receivers: string[] = taskArguments.decoyreceivers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const secret = parseInt(taskArguments.secret);
        if (!Number.isInteger(secret)) {
            throw new Error(`Argument --secret is not an integer`);
        }

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        const signers = await ethers.getSigners();
        const user = signers[0];

        senders.push(user.address)
        senders.sort();
        receivers.push(to)
        receivers.sort();

        let receiverChanges: number[] = [];
        for (const receiver of receivers) {
            receiverChanges.push(receiver === to ? amount : 0);
        }

        console.log("Inputs:");
        console.log("-------");
        console.log("senders:")
        console.log(senders);
        console.log("receivers:");
        console.log(receivers);
        console.log("receiverChanges:");
        console.log(receiverChanges);

        console.log("Encrypting balance changes...");
        const encryptedTransferAmountsStart = Date.now();
        let input = fhevm
            .createEncryptedInput(cGUSDAddress, user.address)
            .add128(amount);
        for (const receiverChange of receiverChanges) {
            input.add128(receiverChange);
        }
        const encryptedTransferAmounts = await input.encrypt();
        const encryptedTransferAmountsDuration = Date.now() - encryptedTransferAmountsStart;
        console.log(`Balance changes encrypted (${encryptedTransferAmountsDuration}ms)`);

        const encAmountHandle = encryptedTransferAmounts.handles[0];
        const encReceiverChanges = encryptedTransferAmounts.handles.slice(1);

        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const encodedInput = abiCoder.encode(["address[]", "address[]", "bytes32", "bytes32[]"], [senders, receivers, encAmountHandle, encReceiverChanges]);
        const inputHash = ethers.keccak256(encodedInput);
        const commitment = BigInt(secret) ^ BigInt(inputHash);

        console.log("Encrypting transfer commitment...");
        const encryptedTransferCommitmentStart = Date.now();
        const encryptedTransferCommitment = await fhevm
            .createEncryptedInput(cGUSDAddress, user.address)
            .add256(commitment)
            .encrypt();
        const encryptedTransferCommitmentDuration = Date.now() - encryptedTransferCommitmentStart;
        console.log(`Transfer commitment encrypted (${encryptedTransferCommitmentDuration}ms)`);

        const tx = await cGUSD.connect(user).privateTransfer(
            senders,
            receivers,
            encAmountHandle,
            encReceiverChanges,
            encryptedTransferAmounts.inputProof,
            encryptedTransferCommitment.handles[0],
            encryptedTransferCommitment.inputProof,
        );
        console.log(`Wait for tx: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${receipt?.status}`);

        console.log(`Private transfer succeeded!`);
    });
