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
    string public constant VERSION = "v0.4";

    // Note: Current implementatino supports only one input ZKPoK that can fit 2048 bits of information.
    // (2048 - 8 (sender index)) / 64 = 31
    uint256 public constant MAX_ANONYMITY_SET = 31;

    mapping(address => euint256) internal _privateSecret;
    mapping(bytes32 => bool) internal _isSecret;
    mapping(bytes32 => bool) internal _usedCommitments; // to prevent replay attacks

    event UserSecretUpdated(address indexed user);
    event SpyWithMyLittleEyeViewRequested(address indexed requester, bytes32 indexed handle);
    event AnonymousTransfer(address[] anonymitySet, ebool[] isSender, euint64[] balanceChanges);
    event AnonymousTransfer2(address[] anonymitySet, euint8 senderIndex, euint8 receiverIndex, euint64 balanceChange);
    event AnonymousTransfer3(address indexed sender, address[] anonymitySet, euint64[] balanceChanges);

    constructor(IERC20 unitToken_, string memory name_, string memory symbol_, string memory contractURI_)
        cERC20(unitToken_, name_, symbol_, contractURI_)
    {}

    /// @dev Users are prevented from fetching their secrets. They should set a new one if they lost the old one instead.
    function updateSecret(externalEuint256 encryptedNewSecret, bytes calldata inputProof) external {
        euint256 newSecret = FHE.fromExternal(encryptedNewSecret, inputProof);
        _privateSecret[msg.sender] = newSecret;
        _isSecret[euint256.unwrap(newSecret)] = true;
        FHE.allowThis(newSecret);
        emit UserSecretUpdated(msg.sender);
    }

    function requestSpyWithMyLittleEyeViews(bytes32[] calldata handles) external {
        // todo: only owner / role
        for (uint256 i; i < handles.length; ++i) {
            requestSpyWithMyLittleEyeView(handles[i]);
        }
    }

    function requestSpyWithMyLittleEyeView(bytes32 handle) public {
        require(!_isSecret[handle], "Cannot request user secret");
        Impl.allow(handle, msg.sender);
        emit SpyWithMyLittleEyeViewRequested(msg.sender, handle);
    }

    function usedCommitments(bytes32 commitmentHandle) external view returns (bool) {
        return _usedCommitments[commitmentHandle];
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

        bytes32 commitmentHandle = euint256.unwrap(senderCommitment);
        require(!_usedCommitments[commitmentHandle], "Commitment used");
        _usedCommitments[commitmentHandle] = true;

        // Validate inputs
        euint64[] memory balanceChanges = new euint64[](anonymitySetSize);
        euint64 sumBalanceChanges;
        ebool[] memory isSender = new ebool[](anonymitySetSize);
        euint64 sumSenderBalanceChanges;
        ebool senderSufficientBalances = FHE.asEbool(true);
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
            euint64 anonBalance = _balances[anon];
            ebool anonIsSender = FHE.asEbool(false);
            if (FHE.isInitialized(secret) && FHE.isInitialized(anonBalance)) {
                // Auth and input commitment
                euint256 anonCommitment = FHE.xor(secret, uint256(keccak256(abi.encode(inputHash, anon))));
                anonIsSender = FHE.eq(anonCommitment, senderCommitment);

                // Sender balance
                euint64 senderBalanceChange = FHE.select(anonIsSender, balanceChanges[i], FHE.asEuint64(0));
                sumSenderBalanceChanges = FHE.add(sumSenderBalanceChanges, senderBalanceChange);
                senderSufficientBalances = FHE.and(senderSufficientBalances, FHE.ge(anonBalance, senderBalanceChange));
            }
            isSender[i] = anonIsSender;
        }

        // Note: sum of receiver balance changes must be eq to the sender balance change
        // ===> sum of all balance changes must be eq to 2x sender balance change (valid even when all changes are zero)
        ebool validBalanceChanges = FHE.eq(sumBalanceChanges, FHE.add(sumSenderBalanceChanges, sumSenderBalanceChanges)); // `add` is cheaper than `mul`
        ebool senderFound = FHE.gt(sumSenderBalanceChanges, 0); // sender balance change must be > 0, so we know sender is in the set
        ebool executeBalanceChanges = FHE.and(senderFound, FHE.and(validBalanceChanges, senderSufficientBalances));

        // Execute balance changes
        euint64[] memory transferred = new euint64[](anonymitySetSize);
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            euint64 anonBalance = _balances[anon];
            euint64 amount = FHE.select(executeBalanceChanges, balanceChanges[i], FHE.asEuint64(0));

            euint64 newBalance = FHE.select(isSender[i], FHE.sub(anonBalance, amount), FHE.add(anonBalance, amount));

            _balances[anon] = newBalance;
            transferred[i] = amount;

            FHE.allowThis(newBalance);
            FHE.allow(newBalance, anon);
            FHE.allowThis(amount);
            FHE.allow(amount, anon);
            FHE.allowThis(isSender[i]);
        }

        emit AnonymousTransfer(anonymitySet, isSender, transferred);
    }

    /// @notice alternative solution
    /// @dev does not support multi-transfer and leaks the number of transfers
    function anonymousTransfer2(
        address[] memory anonymitySet,
        externalEuint8 encryptedSenderIndex,
        externalEuint8 encryptedReceiverIndex,
        externalEuint64 encryptedBalanceChange,
        bytes memory inputProof,
        externalEuint256 encryptedSenderCommitment,
        bytes memory commitmentProof
    ) external {
        uint256 anonymitySetSize = anonymitySet.length;
        require(anonymitySetSize > 0, "Empty anonymity set");
        require(anonymitySetSize <= MAX_ANONYMITY_SET, "Anonymity set too big");

        bytes32 inputHash = keccak256(abi.encode(anonymitySet, encryptedSenderIndex, encryptedReceiverIndex, encryptedBalanceChange));

        // Verify inputs
        euint8 senderIndex = FHE.fromExternal(encryptedSenderIndex, inputProof);
        euint8 receiverIndex = FHE.fromExternal(encryptedReceiverIndex, inputProof);
        euint64 balanceChange = FHE.fromExternal(encryptedBalanceChange, inputProof);
        euint256 senderCommitment = FHE.fromExternal(encryptedSenderCommitment, commitmentProof);

        // Prevent replay attack
        bytes32 commitmentHandle = euint256.unwrap(senderCommitment);
        require(!_usedCommitments[commitmentHandle], "Commitment used");
        _usedCommitments[commitmentHandle] = true;

        // Validate inputs
        ebool indexesInRange = FHE.and(FHE.lt(senderIndex, uint8(anonymitySetSize)), FHE.lt(receiverIndex, uint8(anonymitySetSize)));
        ebool validInputs = FHE.and(indexesInRange, FHE.ne(senderIndex, receiverIndex));
        ebool senderAuthenticated = FHE.asEbool(false);
        ebool senderSufficientBalance = FHE.asEbool(true);

        // Note: Any FHE operation here is executed anonymitySetSize-times. Minimize or cache.
        ebool[] memory isSender = new ebool[](anonymitySetSize);
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            require(anon != address(0), "Zero address in anonymity set");
            if (i > 0) require(uint160(anonymitySet[i - 1]) < uint160(anon), "Not sorted"); // enforce strictly increasing order to prevent duplicates

            isSender[i] = FHE.eq(senderIndex, uint8(i));

            euint256 secret = _privateSecret[anon];
            euint64 anonBalance = _balances[anon];
            if (FHE.isInitialized(secret) && FHE.isInitialized(anonBalance)) {
                // Auth and input commitment
                euint256 anonCommitment = FHE.xor(secret, uint256(keccak256(abi.encode(inputHash, anon))));
                ebool commitmentMatch = FHE.eq(senderCommitment, anonCommitment);

                senderAuthenticated = FHE.or(senderAuthenticated, FHE.and(commitmentMatch, isSender[i]));

                // Sender balance
                ebool sufficientBalance = FHE.ge(anonBalance, FHE.select(isSender[i], balanceChange, FHE.asEuint64(0)));
                senderSufficientBalance = FHE.and(senderSufficientBalance, sufficientBalance);
            }
        }

        ebool executeTransfer = FHE.and(validInputs, FHE.and(senderAuthenticated, senderSufficientBalance));

        // Execute transfer
        euint64 transferred = FHE.select(executeTransfer, balanceChange, FHE.asEuint64(0));
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            euint64 anonBalance = _balances[anon];

            ebool isReceiver = FHE.eq(receiverIndex, uint8(i));
            euint64 amount = FHE.select(FHE.or(isSender[i], isReceiver), transferred, FHE.asEuint64(0));
            euint64 newBalance = FHE.select(isSender[i], FHE.sub(anonBalance, amount), FHE.add(anonBalance, amount));

            _balances[anon] = newBalance;

            FHE.allowThis(newBalance);
            FHE.allow(newBalance, anon);
            FHE.allowThis(amount);
            FHE.allow(amount, anon);
        }

        FHE.allowThis(senderIndex);
        FHE.allowThis(receiverIndex);

        emit AnonymousTransfer2(anonymitySet, senderIndex, receiverIndex, transferred);
    }

    /// @dev public sender, anonymous receivers, multi-transfer
    function anonymousTransfer3(
        address[] memory anonymitySet,
        externalEuint64[] memory encryptedBalanceChanges,
        bytes memory inputProof
    ) external {
        // Array input checks
        uint256 anonymitySetSize = anonymitySet.length;
        require(anonymitySetSize > 0, "Empty anonymity set");
        require(anonymitySetSize <= MAX_ANONYMITY_SET, "Anonymity set too big");
        require(anonymitySetSize == encryptedBalanceChanges.length, "Length mismatch");

        address sender = msg.sender;

        // Validate inputs
        euint64[] memory balanceChanges = new euint64[](anonymitySetSize);
        euint64 sumBalanceChanges;
        // Note: Any FHE operation here is executed anonymitySetSize-times. Minimize or cache.
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            require(anon != address(0), "Zero address in anonymity set");
            if (i > 0) require(uint160(anonymitySet[i - 1]) < uint160(anon), "Not sorted"); // enforce strictly increasing order to prevent duplicates

            // Balance changes
            balanceChanges[i] = FHE.fromExternal(encryptedBalanceChanges[i], inputProof);
            sumBalanceChanges = FHE.add(sumBalanceChanges, balanceChanges[i]);
            // todo: check for overflow
        }

        // Check sender balance
        euint64 senderBalance = _balances[sender];
        ebool senderSufficientBalance = FHE.ge(senderBalance, sumBalanceChanges);

        // Sender balance change
        euint64 amount = FHE.select(senderSufficientBalance, sumBalanceChanges, FHE.asEuint64(0));
        euint64 newBalance = FHE.sub(senderBalance, amount);

        _balances[sender] = newBalance;

        FHE.allowThis(newBalance);
        FHE.allow(newBalance, sender);
        FHE.allowThis(amount);
        FHE.allow(amount, sender);

        // Receivers balance changes
        euint64[] memory transferred = new euint64[](anonymitySetSize);
        for (uint256 i; i < anonymitySetSize; ++i) {
            address anon = anonymitySet[i];
            euint64 anonBalance = _balances[anon];
            amount = FHE.select(senderSufficientBalance, balanceChanges[i], FHE.asEuint64(0));
            newBalance = FHE.add(anonBalance, amount);

            _balances[anon] = newBalance;
            transferred[i] = amount;

            FHE.allowThis(newBalance);
            FHE.allow(newBalance, anon);
            FHE.allowThis(amount);
            FHE.allow(amount, anon);
        }

        emit AnonymousTransfer3(sender, anonymitySet, transferred);
    }
}
