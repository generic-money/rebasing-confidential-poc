// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {
    FHE,
    externalEuint256,
    externalEuint64,
    externalEuint8,
    euint256,
    euint64,
    euint8,
    ebool
} from "@fhevm/solidity/lib/FHE.sol";
import {Impl} from "@fhevm/solidity/lib/Impl.sol";

import {cERC20, IERC20} from "./cERC20.sol";

contract cGUSD is cERC20 {
    string public constant VERSION = "v0.3";

    // Note: Current implementatino supports only one input ZKPoK that can fit 2048 bits of information.
    // (2048 - 8 (sender index)) / 64 = 31
    uint256 public constant MAX_ANONYMITY_SET = 31;

    mapping(address => euint256) internal _privateSecret;

    constructor(IERC20 unitToken_, string memory name_, string memory symbol_, string memory contractURI_)
        cERC20(unitToken_, name_, symbol_, contractURI_)
    {}

    function updateSecret(externalEuint256 encryptedNewSecret, bytes calldata inputProof) external {
        euint256 newSecret = FHE.fromExternal(encryptedNewSecret, inputProof);
        _privateSecret[msg.sender] = newSecret;
        FHE.allowThis(newSecret);
        // users are prevented from fetching their secret
        // they should set a new one if they lost the old one instead

        // todo: emit event
    }

    // Anonymous transfer

    /// @dev sender balance must be initialized (i.e. non-zero balance, encrypted zero balance is allowed)
    /// @dev the balance change on the sender index position is taken as negative
    /// @dev assume only one sender
    function anonymousTransfer(
        address[] memory anonymitySet,
        externalEuint64[] memory encryptedBalanceChanges,
        bytes memory inputProof,
        externalEuint256 encryptedSenderCommitment,
        bytes memory commitmentProof
    ) external {
        // Array input checks
        uint256 anonymitySetSize = anonymitySet.length;
        require(anonymitySetSize > 0, "Empty anonymity set");
        require(anonymitySetSize <= MAX_ANONYMITY_SET, "Anonymity set too big");
        require(anonymitySetSize == encryptedBalanceChanges.length, "Length mismatch");

        bytes32 inputHash = keccak256(abi.encode(anonymitySet, encryptedBalanceChanges));
        euint256 senderCommitment = FHE.fromExternal(encryptedSenderCommitment, commitmentProof);

        // Validate inputs
        euint64[] memory balanceChanges = new euint64[](anonymitySetSize);
        euint64 sumBalanceChanges;
        ebool[] memory isSender = new ebool[](anonymitySetSize);
        euint64 sumSenderBalanceChanges;
        ebool senderSufficientBalances = FHE.asEbool(true);
        ebool senderFound = FHE.asEbool(false);
        // Note: Any FHE operation here is executed anonymitySetSize-times. Minimize or cache.
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            require(anon != address(0), "Zero address in anonymity set");
            if (i > 0) require(uint160(anonymitySet[i - 1]) < uint160(anon), "Not sorted"); // enforce strictly increasing order to prevent duplicates

            // Balance changes
            balanceChanges[i] = FHE.fromExternal(encryptedBalanceChanges[i], inputProof);
            sumBalanceChanges = FHE.add(sumBalanceChanges, balanceChanges[i]);
            // todo: check for overflow

            euint256 secret = _privateSecret[anon];
            ebool commitmentMatch;
            if (FHE.isInitialized(secret)) {
                // Auth and input commitment
                euint256 anonCommitment = FHE.xor(secret, uint256(keccak256(abi.encode(inputHash, anon))));
                commitmentMatch = FHE.eq(anonCommitment, senderCommitment);
                senderFound = FHE.or(senderFound, commitmentMatch);

                // Sender balance
                euint64 senderBalanceChange = FHE.select(commitmentMatch, balanceChanges[i], FHE.asEuint64(0));
                sumSenderBalanceChanges = FHE.add(sumSenderBalanceChanges, senderBalanceChange);
                senderSufficientBalances = FHE.and(senderSufficientBalances, FHE.ge(_balances[anon], senderBalanceChange));
            }
            isSender[i] = commitmentMatch;
        }

        // Note: sum of receiver balance changes must be eq to the sender balance change
        // ===> sum of all balance changes must be eq to 2x sender balance change (valid when all changes are zero)
        // Saves one FHE `select` operation in the loop.
        ebool validBalanceChanges = FHE.eq(sumBalanceChanges, FHE.add(sumSenderBalanceChanges, sumSenderBalanceChanges)); // `add` is cheaper than `mul`
        ebool validInputs = FHE.and(senderFound, validBalanceChanges);
        ebool executeBalanceChanges = FHE.and(validInputs, senderSufficientBalances);

        // Inputs are valid when:
        // - sender index is in range -> we have one sender, with balance change and secret
        // - sender change matches sum of receiver changes
        // - sender knows its own secret
        // - inputs match the tx commitment with senders secret

        // Following invariants hold implicitly:
        // - only one negative balance change (only one sender index)
        // - all changes are non-negative

        // At this point we have:
        // - list of addresses paired with balances changes, without duplicates
        // - index of sender balance change
        // - bool variable about sender sufficient balance

        // Execute balance changes
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            euint64 anonBalance = _balances[anon];
            euint64 amount = FHE.select(executeBalanceChanges, balanceChanges[i], FHE.asEuint64(0));

            euint64 newBalance = FHE.select(isSender[i], FHE.sub(anonBalance, amount), FHE.add(anonBalance, amount));

            _balances[anon] = newBalance;
            FHE.allowThis(newBalance);
            FHE.allow(newBalance, anon);
        }

        // todo: emit event
    }
}
