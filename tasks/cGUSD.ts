import { task } from "hardhat/config";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { TaskArguments } from "hardhat/types";

const cGUSDAddress = "0xE98Fd322C8dEd61Fd7b4550Bba6f13f44e0A6601"; // latest cGUSD Sepolia deployment
const mock20Address = "0x2456ca90f5C89a07051De8645DC16109C615B0F5";

function compareAddrs(a: string, b: string) {
    return Number.parseInt(a) - Number.parseInt(b);
}

task("distribute:eth:all", "Distribute 0.01 ETH from the first to the following 29 test accounts")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);
        const signers = await ethers.getSigners();
        console.log(`Distributor ${signers[0].address}`)

        for (let i = 2; i < 30; i++) {
            const tx = await signers[0].sendTransaction({
                to: signers[i],
                value: ethers.parseEther("0.01")
            })
            console.log(`Waiting for tx: ${tx.hash}`);

            const receipt = await tx.wait();
            console.log(`tx: ${tx.hash} status=${receipt?.status}`);

            console.log(`Address [${i}] ${signers[i].address} funded 0.01 eth`);
        }
    });

task("setup:secret:all", "Set the same secrets to the first 30 test signers")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        await fhevm.initializeCLIApi();

        const secret = 44;

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        const signers = await ethers.getSigners();
        for (let i = 0; i < 30; i++) {
            const user = signers[i];

            console.log(`Setting secret for [${i}] ${user.address}`);

            const encryptedValue = await fhevm
                .createEncryptedInput(cGUSDAddress, user.address)
                .add256(secret)
                .encrypt();

            console.log("Secret encrypted");

            const tx = await cGUSD.connect(user).updateSecret(encryptedValue.handles[0], encryptedValue.inputProof);
            console.log(`Waiting for tx: ${tx.hash}`);

            const receipt = await tx.wait();
            console.log(`tx: ${tx.hash} status=${receipt?.status}`);

            console.log(`Secret updated to ${secret}`);
        }
    });

task("m:mint", "Mint Mock20 tokens")
    .addParam("amount", "Amount to mint")
    .addParam("signer", "Index of the test signer")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const amount = parseInt(taskArguments.amount);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --amount is not an integer`);
        }

        const index = parseInt(taskArguments.signer);
        if (!Number.isInteger(index)) {
            throw new Error(`Argument --signer is not an integer`);
        }

        const mock20 = await ethers.getContractAt("MockERC20", mock20Address);
        const signers = await ethers.getSigners();

        // Mint mock unit tokens
        const tx = await mock20.connect(signers[index]).mint(signers[index].address, amount);
        console.log(`Wait for tx: ${tx.hash}`);

        const mintReceipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${mintReceipt?.status}`);

        console.log(`${signers[index].address} minting ${amount} MockERC20 succeeded!`);
    });

task("m:mint:all", "Mint Mock20 tokens to the first 30 test signers")
task("m:approve:all", "Approve cGUSD to the first 30 test signers")
    .addParam("amount", "Amount to approve")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const amount = parseInt(taskArguments.amount);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --amount is not an integer`);
        }

        const mock20 = await ethers.getContractAt("MockERC20", mock20Address);
        const signers = await ethers.getSigners();

        for (let i = 0; i < 30; i++) {
            // Mint mock unit tokens
            const tx = await mock20.connect(signers[i]).approve(cGUSDAddress, amount);
            console.log(`Wait for tx: ${tx.hash}`);

            console.log(`[${i}] ${signers[i].address} approving ${amount} MockERC20`);
        }
    });

task("c:wrap", "Wraps Mock20 tokens")
    .addParam("amount", "Amount to wrap")
    .addParam("signer", "Index of the test signer")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const amount = parseInt(taskArguments.amount);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --amount is not an integer`);
        }

        const index = parseInt(taskArguments.signer);
        if (!Number.isInteger(index)) {
            throw new Error(`Argument --signer is not an integer`);
        }

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);
        const signers = await ethers.getSigners();

        const tx = await cGUSD.connect(signers[index]).wrap(amount);
        console.log(`Wait for tx: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${receipt?.status}`);

        console.log(`Wrapping ${amount} cGUSD succeeded!`);
    });

task("c:wrap:all", "Wraps Mock20 tokens of the first 30 test signers")
    .addParam("amount", "Amount to wrap")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const amount = parseInt(taskArguments.amount);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --amount is not an integer`);
        }

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);
        const signers = await ethers.getSigners();

        for (let i = 0; i < 30; i++) {
            const tx = await cGUSD.connect(signers[i]).wrap(amount);
            console.log(`Wait for tx: ${tx.hash}`);

            console.log(`[${i}] ${signers[i].address} wrapping ${amount}`);
        }
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
            FhevmType.euint64,
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
            .add64(amount)
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

/**
npx hardhat --network sepolia p:transfer --r 0 --bc 1,0,0,1 --s 44 --anon 1,2,3,4 --si 0
*/
// 1-to-n transfer
task("p:transfer", "Execute private transfer")
    .addParam("r", "Relayer index in the signers list")
    .addParam("anon", "Comma-separated list of anon indexes in the signers list")
    .addParam("bc", "Balance changes")
    .addParam("si", "Sender index")
    .addParam("s", "Sender secret")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const relayerIndex = parseInt(taskArguments.r);
        const secret = parseInt(taskArguments.s);
        const senderIndex = parseInt(taskArguments.si);
        const anonIndexes: number[] = taskArguments.anon.split(",").map(Number);
        const balanceChanges: number[] = taskArguments.bc.split(",").map(Number); // need to sort as receivers

        const signers = await ethers.getSigners();
        const relayer = signers[relayerIndex];

        const anons = anonIndexes.map((rIndex, i) => ({
            address: signers[rIndex].address,
            change: balanceChanges[i],
            isSender: i == senderIndex,
        })).sort((a,b) => Number.parseInt(a.address) - Number.parseInt(b.address));
        const anonAddrsSorted = anons.map((a) => a.address);
        const balanceChangesSorted = anons.map((a) => a.change);
        const senderIndexSorted = anons.findIndex((a) => a.isSender);

        console.log("Inputs:");
        console.log("-------");
        console.log("anons:");
        console.log(anons);
        console.log("sender index:");
        console.log(senderIndexSorted);

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        console.log("Initializing CLI API...");
        await fhevm.initializeCLIApi();

        console.log("Encrypting balance changes...");
        const encryptedTransferInputsStart = Date.now();
        let input = fhevm
            .createEncryptedInput(cGUSDAddress, relayer.address)
            .add8(senderIndexSorted);
        for (const balanceChange of balanceChangesSorted) {
            input.add64(balanceChange);
        }
        const encryptedTransferInputs = await input.encrypt();
        const encryptedTransferInputsDuration = Date.now() - encryptedTransferInputsStart;
        console.log(`Transfer inputs encrypted (${encryptedTransferInputsDuration}ms)`);

        const senderIndexHandle = encryptedTransferInputs.handles[0];
        const balanceChangesHandles = encryptedTransferInputs.handles.slice(1);

        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const encodedInput = abiCoder.encode(["address[]", "bytes32[]", "bytes32"], [anonAddrsSorted, balanceChangesHandles, senderIndexHandle]);
        const inputHash = ethers.keccak256(encodedInput);
        const commitment = BigInt(secret) ^ BigInt(inputHash);

        console.log("Encrypting transfer commitment...");
        const encryptedTransferCommitmentStart = Date.now();
        const encryptedTransferCommitment = await fhevm
            .createEncryptedInput(cGUSDAddress, relayer.address)
            .add256(commitment)
            .encrypt();
        const encryptedTransferCommitmentDuration = Date.now() - encryptedTransferCommitmentStart;
        console.log(`Transfer commitment encrypted (${encryptedTransferCommitmentDuration}ms)`);

        const tx = await cGUSD.connect(relayer).anonymousTransfer(
            anonAddrsSorted,
            balanceChangesHandles,
            senderIndexHandle,
            encryptedTransferInputs.inputProof,
            encryptedTransferCommitment.handles[0],
            encryptedTransferCommitment.inputProof,
        );
        console.log(`Wait for tx: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${receipt?.status} gasUsed=${receipt?.gasUsed}`);

        console.log(`Anonymous transfer succeeded!`);
    });
