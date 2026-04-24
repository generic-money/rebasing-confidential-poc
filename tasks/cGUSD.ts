import { task } from "hardhat/config";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { TaskArguments } from "hardhat/types";

const cGUSDAddress = "0xa335D08543A60745b1FA6b1220Df15E37538C795"; // latest cGUSD Sepolia deployment
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

task("c:wrap:all", "Wraps Mock20 tokens")
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
npx hardhat --network sepolia p:transfer --r 0 --rc 1,0,0,0,0 --s 44 --senders 1,2,3,4,5 --receivers 1,2,3,4,5
*/
// 1-to-n transfer
task("p:transfer", "Execute private transfer")
    .addParam("r", "Relayer index in the signers list")
    .addParam("rc", "Receiver balance changes")
    .addParam("s", "Sender secret")
    .addParam("senders", "Comma-separated list of decoy indexes in the signers list")
    .addParam("receivers", "Comma-separated list of decoy indexes in the signers list")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const relayerIndex = parseInt(taskArguments.r);
        const secret = parseInt(taskArguments.s);
        const senderIndexes: number[] = taskArguments.senders.split(",").map(Number);
        const receiverIndexes: number[] = taskArguments.receivers.split(",").map(Number);
        const balanceChanges: number[] = taskArguments.rc.split(",").map(Number); // need to sort as receivers

        const signers = await ethers.getSigners();
        const relayer = signers[relayerIndex];

        const senders = senderIndexes.map((i) => signers[i].address).sort(compareAddrs);
        const receivers = receiverIndexes.map((rIndex, i) => ({
            address: signers[rIndex].address,
            change: balanceChanges[i]
        })).sort((a,b) => Number.parseInt(a.address) - Number.parseInt(b.address));
        const receiversAddrs = receivers.map((r) => r.address);
        const receiverChanges = receivers.map((r) => r.change);

        console.log("Inputs:");
        console.log("-------");
        console.log("senders:")
        console.log(senders);
        console.log("receivers:");
        console.log(receivers);

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        console.log("Initializing CLI API...");
        await fhevm.initializeCLIApi();

        console.log("Encrypting balance changes...");
        const encryptedTransferAmountsStart = Date.now();
        let input = fhevm
            .createEncryptedInput(cGUSDAddress, relayer.address)
            .add64(amount);
        for (const receiverChange of receiverChanges) {
            input.add64(receiverChange);
        }
        const encryptedTransferAmounts = await input.encrypt();
        const encryptedTransferAmountsDuration = Date.now() - encryptedTransferAmountsStart;
        console.log(`Balance changes encrypted (${encryptedTransferAmountsDuration}ms)`);

        const encAmountHandle = encryptedTransferAmounts.handles[0];
        const encReceiverChanges = encryptedTransferAmounts.handles.slice(1);

        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const encodedInput = abiCoder.encode(["address[]", "address[]", "bytes32", "bytes32[]"], [senders, receiversAddrs, encAmountHandle, encReceiverChanges]);
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
            senders,
            receiversAddrs,
            encAmountHandle,
            encReceiverChanges,
            encryptedTransferAmounts.inputProof,
            encryptedTransferCommitment.handles[0],
            encryptedTransferCommitment.inputProof,
        );
        console.log(`Wait for tx: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`tx: ${tx.hash} status=${receipt?.status} gasUsed=${receipt?.gasUsed}`);

        console.log(`Anonymous transfer succeeded!`);
    });
