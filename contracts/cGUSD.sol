// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, externalEuint256, externalEuint64, euint256, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";

import {FHESafeMath} from "./utils/FHESafeMath.sol";
import {cERC20, IERC20} from "./cERC20.sol";

contract cGUSD is cERC20 {
    mapping(address => euint256) internal _privateSecret;

    constructor(
        IERC20 unitToken_,
        string memory name_,
        string memory symbol_,
        string memory contractURI_
    ) cERC20(unitToken_, name_, symbol_, contractURI_) { }

    // Anonymous transfer

    /// @dev sender addresses must be initialized (i.e. non-zero balance, encrypted zero balance is allowed)
    function anonymousTransfer(
        address[] memory from,
        address[] memory to,
        externalEuint64 encryptedSenderChange,
        externalEuint64[] calldata encryptedReceiverChanges,
        bytes calldata inputProof,
        externalEuint256 encryptedSenderCommitment,
        bytes calldata commitmentProof
    ) external {
        // Array input checks
        uint256 totalSenderChanges = from.length;
        require(totalSenderChanges <= type(uint8).max, "Too many senders");
        require(totalSenderChanges > 0, "At least one sender required");
        uint256 totalReceiverChanges = to.length;
        require(totalReceiverChanges == encryptedReceiverChanges.length, "Length mismatch");
        require(totalReceiverChanges > 0, "At least one receiver required");

        uint256 inputHash = uint256(keccak256(abi.encode(from, to, encryptedSenderChange, encryptedReceiverChanges)));

        // Validate inputs
        euint64 senderChange = FHE.fromExternal(encryptedSenderChange, inputProof);
        euint256 senderCommitment = FHE.fromExternal(encryptedSenderCommitment, commitmentProof);

        ebool senderFound = FHE.asEbool(false);
        euint64[] memory senderChanges = new euint64[](totalSenderChanges);
        for (uint256 i; i < totalSenderChanges; ++i) {
            address _from = from[i];
            require(_from != address(0), ERC7984InvalidSender(address(0)));
            if (i > 0) require(uint160(from[i - 1]) < uint160(_from), "Not sorted"); // enforce strictly increasing order to prevent duplicates

            // Note: assuming every sender has a different secret
            // If not, transfer amount is taken from all senders with the same secret
            euint256 secret = _privateSecret[_from];
            require(FHE.isInitialized(secret), "sender secret not initialized");
            euint256 txSecret = FHE.xor(secret, inputHash);
            ebool isSender = FHE.eq(senderCommitment, txSecret);
            senderFound = FHE.or(senderFound, isSender);
            senderChanges[i] = FHE.select(isSender, senderChange, FHE.asEuint64(0));
        }

        euint64[] memory receiverChanges = new euint64[](totalReceiverChanges);
        euint64 sumReceiverChanges;
        for (uint256 i; i < totalReceiverChanges; ++i) {
            address _to = to[i];
            require(_to != address(0), ERC7984InvalidReceiver(address(0)));
            if (i > 0) require(uint160(to[i - 1]) < uint160(_to), "Not sorted"); // enforce strictly increasing order to prevent duplicates

            receiverChanges[i] = FHE.fromExternal(encryptedReceiverChanges[i], inputProof);
            sumReceiverChanges = FHE.add(sumReceiverChanges, receiverChanges[i]);
        }

        ebool amountsMatch = FHE.eq(senderChange, sumReceiverChanges);
        ebool inputsValid = FHE.and(senderFound, amountsMatch);

        // Inputs are valid when:
        // - sender index is in range
        // - sender change matches sum of receiver changes
        // - sender secret is valid

        // Following invariants hold implicitly:
        // - sender changes is list of zeros with at most one non-zero value (i.e. only one sender)
        // - receiver changes are non-negative

        // At this point we have:
        // - list of senders with their respective changes, where only one sender has non-zero change
        // - list of receivers with their respective changes, where all changes are non-negative, and their sum matches the non-zero sender change

        // Decrese senders balance
        // Note: Only one sender has a non-zero change, so sender changes can be invalid only if the sender has insufficient balance.
        // In that case zero is used as change amount, so balances won't be updated for any sender and no rollback is needed.
        ebool allSenderChangesValid = FHE.asEbool(true);
        for (uint256 i; i < totalSenderChanges; ++i) {
            address _from = from[i];
            euint64 fromBalance = _balances[_from];
            euint64 amount = FHE.select(inputsValid, senderChanges[i], FHE.asEuint64(0));

            require(FHE.isInitialized(fromBalance), ERC7984ZeroBalance(_from));
            (ebool changeValid, euint64 newBalance) = FHESafeMath.tryDecrease(fromBalance, amount);
            allSenderChangesValid = FHE.and(allSenderChangesValid, changeValid);

            _balances[_from] = newBalance;
            FHE.allowThis(newBalance);
            FHE.allow(newBalance, _from);
        }

        // Increase receivers balance
        for (uint256 i; i < totalReceiverChanges; ++i) {
            address _to = to[i];
            // Adjust balance change in case of invalid sender changes
            euint64 amount = FHE.select(FHE.and(inputsValid, allSenderChangesValid), receiverChanges[i], FHE.asEuint64(0));
            euint64 newBalance = FHE.add(_balances[_to], amount);

            _balances[_to] = newBalance;
            FHE.allowThis(newBalance);
            FHE.allow(newBalance, _to);
        }

        // todo: emit event
    }

    function updateSecret(externalEuint256 encryptedNewSecret, bytes calldata inputProof) external {
        euint256 newSecret = FHE.fromExternal(encryptedNewSecret, inputProof);
        _privateSecret[msg.sender] = newSecret;
        FHE.allowThis(newSecret);
        // users are prevented from fetching their secret
        // they should set a new one if they lost the old one instead

        // todo: emit event
    }
}
