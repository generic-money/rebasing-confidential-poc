// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, externalEuint256, externalEuint64, externalEuint8, euint256, euint64, euint8, ebool} from "@fhevm/solidity/lib/FHE.sol";

import {FHESafeMath} from "./utils/FHESafeMath.sol";
import {cERC20, IERC20} from "./cERC20.sol";

contract cGUSD is cERC20 {
    // Note: Current implementatino supports only one input ZKPoK that can fit 2048 bits of information.
    // (2048 - 8 (sender index)) / 64 = 31
    uint256 public constant MAX_ANONYMITY_SET = 31;

    mapping(address => euint256) internal _privateSecret;

    constructor(
        IERC20 unitToken_,
        string memory name_,
        string memory symbol_,
        string memory contractURI_
    ) cERC20(unitToken_, name_, symbol_, contractURI_) { }

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
        externalEuint64[] calldata encryptedBalanceChanges,
        externalEuint8 encryptedSenderIndex,
        bytes calldata inputProof,
        externalEuint256 encryptedSenderCommitment,
        bytes calldata commitmentProof
    ) external {
        // Array input checks
        uint256 anonymitySetSize = anonymitySet.length;
        require(anonymitySetSize > 0, "Empty anonymity set");
        require(anonymitySetSize <= MAX_ANONYMITY_SET, "Anonymity set too big");
        require(anonymitySetSize == encryptedBalanceChanges.length, "Length mismatch");

        uint256 inputHash = uint256(keccak256(abi.encode(anonymitySet, encryptedBalanceChanges, encryptedSenderIndex)));

        euint8 senderIndex = FHE.fromExternal(encryptedSenderIndex, inputProof);
        euint256 senderCommitment = FHE.fromExternal(encryptedSenderCommitment, commitmentProof);

        // Validate inputs
        euint64 sumBalanceChanges;
        euint64 senderBalanceChange;
        euint64[] memory balanceChanges = new euint64[](anonymitySetSize);
        ebool validCommitment = FHE.asEbool(true);
        // Note: Any FHE operation here is executed anonymitySetSize-times.
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            require(anon != address(0), "Zero address in anonymity set");
            if (i > 0) require(uint160(anonymitySet[i - 1]) < uint160(anon), "Not sorted"); // enforce strictly increasing order to prevent duplicates

            balanceChanges[i] = FHE.fromExternal(encryptedBalanceChanges[i], inputProof);
            sumBalanceChanges = FHE.add(sumBalanceChanges, balanceChanges[i]);
            // todo: check for overflow

            ebool isSender = FHE.eq(senderIndex, uint8(i));
            senderBalanceChange = FHE.add(senderBalanceChange, FHE.select(isSender, balanceChanges[i], FHE.asEuint64(0)));

            euint256 secret = _privateSecret[anon];
            euint256 txCommitment = FHE.xor(secret, inputHash);
            // Note: will not revert on uninitialized secret, but cannot use the address as sender
            ebool commitmentMatch = FHE.and(FHE.eq(txCommitment, senderCommitment), FHE.isInitialized(secret));
            validCommitment = FHE.and(validCommitment, FHE.select(isSender, commitmentMatch, FHE.asEbool(true)));
        }

        // Note: sum of receiver balance changes must be eq to the sender balance change
        // ===> sum of all balance changes must be eq to 2x sender balance change (valid when all changes are zero)
        // Saves one FHE `select` operation in the loop.
        ebool validBalanceChanges = FHE.eq(sumBalanceChanges, FHE.add(senderBalanceChange, senderBalanceChange)); // `add` is cheaper than `mul`
        ebool validSenderIndex = FHE.lt(senderIndex, uint8(anonymitySetSize));
        ebool validInputs = FHE.and(validCommitment, FHE.and(validBalanceChanges, validSenderIndex));

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

        // Execute sender balance changes
        // Note: Only one sender has a non-zero change, so sender changes can be invalid only if the sender has insufficient balance.
        // In that case zero is used as change amount, so balances won't be updated for any sender and no rollback is needed.
        ebool sufficientBalances = FHE.asEbool(true);
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];

            ebool isSender = FHE.eq(senderIndex, uint8(i));
            euint64 amount = FHE.select(FHE.and(validInputs, isSender), balanceChanges[i], FHE.asEuint64(0));

            (ebool success, euint64 newBalance) = FHESafeMath.tryDecrease(_balances[anon], amount);
            sufficientBalances = FHE.and(sufficientBalances, success);

            _balances[anon] = newBalance;
            FHE.allowThis(newBalance);
            FHE.allow(newBalance, anon);
        }

        ebool proceed = FHE.and(validInputs, sufficientBalances);
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];

            ebool isNotSender = FHE.ne(senderIndex, uint8(i));
            euint64 amount = FHE.select(FHE.and(isNotSender, proceed), balanceChanges[i], FHE.asEuint64(0));

            euint64 newBalance = FHE.add(_balances[anon], amount);

            _balances[anon] = newBalance;
            FHE.allowThis(newBalance);
            FHE.allow(newBalance, anon);
        }

        // todo: emit event
    }
}
