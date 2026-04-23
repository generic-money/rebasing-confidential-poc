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

/**
npx hardhat --network sepolia p:transfer --r 0 --f 1 --t 2 --a 1 --s 44 --sdecoys 3,4,5,6,7,8,9,10,11,12,13,14,15,16 --rdecoys 3,4,5,6,7,8,9,10,11,12,13,14,15,16
*/
// atm only 1-to-1 transfer
task("p:transfer", "Execute private transfer")
    .addParam("r", "Relayer index in the signers list")
    .addParam("f", "Sender index in the signers list")
    .addParam("t", "Receiver index in the signers list")
    .addParam("a", "Transfer amount")
    .addParam("s", "Sender secret")
    .addParam("sdecoys", "Comma-separated list of decoy indexes in the signers list")
    .addParam("rdecoys", "Comma-separated list of decoy indexes in the signers list")
    .setAction(async function (taskArguments: TaskArguments, hre) {
        const { ethers } = hre;

        const relayerIndex = parseInt(taskArguments.r);
        if (!Number.isInteger(relayerIndex)) {
            throw new Error(`Argument --r is not an integer`);
        }
        const fromIndex = parseInt(taskArguments.f);
        if (!Number.isInteger(fromIndex)) {
            throw new Error(`Argument --f is not an integer`);
        }
        const toIndex = parseInt(taskArguments.t);
        if (!Number.isInteger(toIndex)) {
            throw new Error(`Argument --t is not an integer`);
        }
        const amount = parseInt(taskArguments.a);
        if (!Number.isInteger(amount)) {
            throw new Error(`Argument --a is not an integer`);
        }
        const secret = parseInt(taskArguments.s);
        if (!Number.isInteger(secret)) {
            throw new Error(`Argument --s is not an integer`);
        }
        let senderIndexes: number[] = taskArguments.sdecoys.split(",").map(Number);
        let receiverIndexes: string[] = taskArguments.rdecoys.split(",").map(Number);

        const signers = await ethers.getSigners();
        const relayer = signers[relayerIndex];

        senderIndexes.push(fromIndex);
        const senders = senderIndexes.map((i) => signers[i].address).sort(compareAddrs);
        receiverIndexes.push(toIndex);
        const receivers = receiverIndexes.map((i) => signers[i].address).sort(compareAddrs);

        let receiverChanges: number[] = [];
        for (const receiver of receivers) {
            receiverChanges.push(receiver === signers[toIndex].address ? amount : 0);
        }

        console.log("Inputs:");
        console.log("-------");
        console.log("senders:")
        console.log(senders);
        console.log("receivers:");
        console.log(receivers);
        console.log("receiverChanges:");
        console.log(receiverChanges);

        const cGUSD = await ethers.getContractAt("cGUSD", cGUSDAddress);

        console.log("Initializing CLI API...");
        await fhevm.initializeCLIApi();

        console.log("Encrypting balance changes...");
        const encryptedTransferAmountsStart = Date.now();
        let input = fhevm
            .createEncryptedInput(cGUSDAddress, relayer.address)
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
            .createEncryptedInput(cGUSDAddress, relayer.address)
            .add256(commitment)
            .encrypt();
        const encryptedTransferCommitmentDuration = Date.now() - encryptedTransferCommitmentStart;
        console.log(`Transfer commitment encrypted (${encryptedTransferCommitmentDuration}ms)`);

        const tx = await cGUSD.connect(relayer).privateTransfer(
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
        console.log(`tx: ${tx.hash} status=${receipt?.status} gasUsed=${receipt?.gasUsed}`);

        console.log(`Private transfer succeeded!`);
    });
