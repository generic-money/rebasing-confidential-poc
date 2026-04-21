// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {FHE, externalEuint256, externalEuint128, euint256, euint128, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {ERC7984Utils} from "./utils/ERC7984Utils.sol";
import {FHESafeMath} from "./utils/FHESafeMath.sol";
import {IERC7984} from "./interfaces/IERC7984.sol";

contract cGUSD is ZamaEthereumConfig, ERC165, IERC7984 {
    using SafeERC20 for IERC20;

    euint128 private _totalSupply;
    mapping(address holder => euint128) private _balances;
    mapping(address holder => mapping(address spender => uint48)) private _operators;

    uint256 lastRequestId;

    struct UnwrapRequest {
        address owner;
        euint128 encryptedAmount;
    }
    mapping(uint256 requestId => UnwrapRequest) private _unwrapRequests;

    mapping(address => euint256) private _privateSecret;

    string public name;
    string public symbol;
    string public contractURI;

    IERC20 public unitToken;

    event AmountDiscloseRequested(euint128 indexed encryptedAmount, address indexed requester);
    event UnwrapRequested(uint256 indexed requestId, address indexed owner, euint128 indexed encryptedAmount);

    error ERC7984InvalidReceiver(address receiver);
    error ERC7984InvalidSender(address sender);
    error ERC7984UnauthorizedSpender(address holder, address spender);
    error ERC7984ZeroBalance(address holder);
    error ERC7984UnauthorizedUseOfEncryptedAmount(euint128 amount, address user);

    constructor(
        IERC20 unitToken_,
        string memory name_,
        string memory symbol_,
        string memory contractURI_
    ) {
        unitToken = unitToken_;
        name = name_;
        symbol = symbol_;
        contractURI = contractURI_;
    }

    /// @inheritdoc ERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IERC7984).interfaceId || super.supportsInterface(interfaceId);
    }

    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    function confidentialTotalSupply() public view virtual returns (euint128) {
        return _totalSupply;
    }

    function confidentialBalanceOf(address account) public view virtual returns (euint128) {
        return _balances[account];
    }

    function isOperator(address holder, address spender) public view virtual returns (bool) {
        return holder == spender || block.timestamp <= _operators[holder][spender];
    }

    function setOperator(address operator, uint48 until) public virtual {
        _setOperator(msg.sender, operator, until);
    }

    function confidentialTransfer(
        address to,
        externalEuint128 encryptedAmount,
        bytes calldata inputProof
    ) public virtual returns (euint128) {
        return _transfer(msg.sender, to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    function confidentialTransfer(address to, euint128 amount) public virtual returns (euint128) {
        require(FHE.isAllowed(amount, msg.sender), ERC7984UnauthorizedUseOfEncryptedAmount(amount, msg.sender));
        return _transfer(msg.sender, to, amount);
    }

    function confidentialTransferFrom(
        address from,
        address to,
        externalEuint128 encryptedAmount,
        bytes calldata inputProof
    ) public virtual returns (euint128 transferred) {
        require(isOperator(from, msg.sender), ERC7984UnauthorizedSpender(from, msg.sender));
        transferred = _transfer(from, to, FHE.fromExternal(encryptedAmount, inputProof));
        FHE.allowTransient(transferred, msg.sender);
    }

    function confidentialTransferFrom(
        address from,
        address to,
        euint128 amount
    ) public virtual returns (euint128 transferred) {
        require(FHE.isAllowed(amount, msg.sender), ERC7984UnauthorizedUseOfEncryptedAmount(amount, msg.sender));
        require(isOperator(from, msg.sender), ERC7984UnauthorizedSpender(from, msg.sender));
        transferred = _transfer(from, to, amount);
        FHE.allowTransient(transferred, msg.sender);
    }

    function confidentialTransferAndCall(
        address to,
        externalEuint128 encryptedAmount,
        bytes calldata inputProof,
        bytes calldata data
    ) public virtual returns (euint128 transferred) {
        transferred = _transferAndCall(msg.sender, to, FHE.fromExternal(encryptedAmount, inputProof), data);
        FHE.allowTransient(transferred, msg.sender);
    }

    function confidentialTransferAndCall(
        address to,
        euint128 amount,
        bytes calldata data
    ) public virtual returns (euint128 transferred) {
        require(FHE.isAllowed(amount, msg.sender), ERC7984UnauthorizedUseOfEncryptedAmount(amount, msg.sender));
        transferred = _transferAndCall(msg.sender, to, amount, data);
        FHE.allowTransient(transferred, msg.sender);
    }

    function confidentialTransferFromAndCall(
        address from,
        address to,
        externalEuint128 encryptedAmount,
        bytes calldata inputProof,
        bytes calldata data
    ) public virtual returns (euint128 transferred) {
        require(isOperator(from, msg.sender), ERC7984UnauthorizedSpender(from, msg.sender));
        transferred = _transferAndCall(from, to, FHE.fromExternal(encryptedAmount, inputProof), data);
        FHE.allowTransient(transferred, msg.sender);
    }

    function confidentialTransferFromAndCall(
        address from,
        address to,
        euint128 amount,
        bytes calldata data
    ) public virtual returns (euint128 transferred) {
        require(FHE.isAllowed(amount, msg.sender), ERC7984UnauthorizedUseOfEncryptedAmount(amount, msg.sender));
        require(isOperator(from, msg.sender), ERC7984UnauthorizedSpender(from, msg.sender));
        transferred = _transferAndCall(from, to, amount, data);
        FHE.allowTransient(transferred, msg.sender);
    }

    /**
     * @dev Starts the process to disclose an encrypted amount `encryptedAmount` publicly by making it
     * publicly decryptable. Emits the {AmountDiscloseRequested} event.
     *
     * NOTE: Both `msg.sender` and `address(this)` must have permission to access the encrypted amount
     * `encryptedAmount` to request disclosure of the encrypted amount `encryptedAmount`.
     */
    function requestDiscloseEncryptedAmount(euint128 encryptedAmount) public virtual {
        require(
            FHE.isAllowed(encryptedAmount, msg.sender),
            ERC7984UnauthorizedUseOfEncryptedAmount(encryptedAmount, msg.sender)
        );

        FHE.makePubliclyDecryptable(encryptedAmount);
        emit AmountDiscloseRequested(encryptedAmount, msg.sender);
    }

    /**
     * @dev Publicly discloses an encrypted value with a given decryption proof. Emits the {AmountDisclosed} event.
     *
     * NOTE: May not be tied to a prior request via {requestDiscloseEncryptedAmount}.
     */
    function discloseEncryptedAmount(
        euint128 encryptedAmount,
        uint128 cleartextAmount,
        bytes calldata decryptionProof
    ) public virtual {
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint128.unwrap(encryptedAmount);

        bytes memory cleartextMemory = abi.encode(cleartextAmount);

        FHE.checkSignatures(handles, cleartextMemory, decryptionProof);
        emit AmountDisclosed(encryptedAmount, cleartextAmount);
    }

    /// Wrapping

    /// todo: owner and spender
    function wrap(uint128 amount) external returns (euint128 transferred) {
        unitToken.safeTransferFrom(msg.sender, address(this), amount);
        return _update(address(0), msg.sender, FHE.asEuint128(amount));
    }

    /// todo: owner and spender
    function unwrap(uint128 amount) external returns (uint256 requestId) {
        // Note: does not update _sharesSupply, as it's not possible to determine if caller has sufficient balance
        // This means that invariant total supply = sum of balances does not hold during burn,
        // but will be restored after claimUnwrappedUnits is called
        euint128 burned = _update(msg.sender, address(0), FHE.asEuint128(amount));
        requestId = ++lastRequestId;
        _unwrapRequests[requestId] = UnwrapRequest({
            owner: msg.sender,
            encryptedAmount: burned
        });
        requestDiscloseEncryptedAmount(burned); // needed to decide if user has sufficient balance
        emit UnwrapRequested(requestId, msg.sender, burned);
    }

    function claimUnwrappedUnits(uint256 requestId, uint128 amount, bytes calldata decryptionProof) external {
        UnwrapRequest memory request = _unwrapRequests[requestId];
        delete _unwrapRequests[requestId];
        discloseEncryptedAmount(request.encryptedAmount, amount, decryptionProof);
        unitToken.safeTransfer(request.owner, amount);
    }

    // Reveal an encrypted amount to another address
    function reveal(euint128 encryptedAmount, address to) external {
        require(
            FHE.isAllowed(encryptedAmount, msg.sender),
            ERC7984UnauthorizedUseOfEncryptedAmount(encryptedAmount, msg.sender)
        );
        FHE.allow(encryptedAmount, to);
    }

    /// Internal functions

    function _setOperator(address holder, address operator, uint48 until) internal virtual {
        _operators[holder][operator] = until;
        emit OperatorSet(holder, operator, until);
    }

    function _transfer(address from, address to, euint128 amount) internal returns (euint128 transferred) {
        require(from != address(0), ERC7984InvalidSender(address(0)));
        require(to != address(0), ERC7984InvalidReceiver(address(0)));
        return _update(from, to, amount);
    }

    function _transferAndCall(
        address from,
        address to,
        euint128 amount,
        bytes calldata data
    ) internal returns (euint128 transferred) {
        // Try to transfer amount + replace input with actually transferred amount.
        euint128 sent = _transfer(from, to, amount);

        // Perform callback
        ebool success = ERC7984Utils.checkOnTransferReceived(msg.sender, from, to, sent, data);

        // Try to refund if callback fails
        euint128 refund = _update(to, from, FHE.select(success, FHE.asEuint128(0), sent));
        transferred = FHE.sub(sent, refund);
    }

    function _update(address from, address to, euint128 amount) internal virtual returns (euint128 transferred) {
        ebool success;
        euint128 ptr;

        if (from != address(0)) {
            euint128 fromBalance = _balances[from];
            require(FHE.isInitialized(fromBalance), ERC7984ZeroBalance(from));
            (success, ptr) = FHESafeMath.tryDecrease(fromBalance, amount);
            FHE.allowThis(ptr);
            FHE.allow(ptr, from);
            _balances[from] = ptr;
        } else {
            success = FHE.asEbool(true);
        }

        if (to != address(0)) {
            ptr = FHE.add(_balances[to], FHE.select(success, amount, FHE.asEuint128(0)));
            FHE.allowThis(ptr);
            FHE.allow(ptr, to);
            _balances[to] = ptr;
        }

        transferred = FHE.select(success, amount, FHE.asEuint128(0));
        if (from != address(0)) FHE.allow(transferred, from);
        if (to != address(0)) FHE.allow(transferred, to);
        FHE.allowThis(transferred);
        emit ConfidentialTransfer(from, to, transferred);
    }

    // Multi-transfer

    /// @dev sender addresses must be initialized (i.e. non-zero balance, encrypted zero balance is allowed)
    function privateTransfer(
        address[] memory from,
        address[] memory to,
        externalEuint128 encryptedSenderChange,
        externalEuint128[] calldata encryptedReceiverChanges,
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
        euint128 senderChange = FHE.fromExternal(encryptedSenderChange, inputProof);
        euint256 senderCommitment = FHE.fromExternal(encryptedSenderCommitment, commitmentProof);

        ebool senderFound = FHE.asEbool(false);
        euint128[] memory senderChanges = new euint128[](totalSenderChanges);
        for (uint256 i; i < totalSenderChanges; ++i) {
            address _from = from[i];
            require(_from != address(0), ERC7984InvalidSender(address(0)));
            if (i > 0) require(uint160(from[i - 1]) < uint160(_from), "Not sorted"); // enforce strictly increasing order to prevent duplicates

            euint256 txSecret = FHE.xor(_privateSecret[_from], inputHash);
            ebool isSender = FHE.eq(senderCommitment, txSecret);
            senderFound = FHE.or(senderFound, isSender);
            senderChanges[i] = FHE.select(isSender, senderChange, FHE.asEuint128(0));
        }

        euint128[] memory receiverChanges = new euint128[](totalReceiverChanges);
        euint128 sumReceiverChanges;
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
            euint128 fromBalance = _balances[_from];
            euint128 amount = FHE.select(inputsValid, senderChanges[i], FHE.asEuint128(0));

            require(FHE.isInitialized(fromBalance), ERC7984ZeroBalance(_from));
            (ebool changeValid, euint128 newBalance) = FHESafeMath.tryDecrease(fromBalance, amount);
            allSenderChangesValid = FHE.and(allSenderChangesValid, changeValid);

            _balances[_from] = newBalance;
            FHE.allowThis(newBalance);
            FHE.allow(newBalance, _from);
        }

        // Increase receivers balance
        for (uint256 i; i < totalReceiverChanges; ++i) {
            address _to = to[i];
            // Adjust balance change in case of invalid sender changes
            euint128 amount = FHE.select(FHE.and(inputsValid, allSenderChangesValid), receiverChanges[i], FHE.asEuint128(0));
            euint128 newBalance = FHE.add(_balances[_to], amount);

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
