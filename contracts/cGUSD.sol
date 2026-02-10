// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {FHE, externalEuint128, euint128, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {ERC7984Utils} from "./utils/ERC7984Utils.sol";
import {FHESafeMath} from "./utils/FHESafeMath.sol";
import {IERC7984} from "./interfaces/IERC7984.sol";

contract cGUSD is ZamaEthereumConfig, ERC165, IERC7984 {
    using SafeERC20 for IERC20;

    uint128 public multiplier;
    mapping(address holder => uint128) public userMultipliers;

    uint128 private _sharesSupply; // must be plain value or we can't calcualte public multiplier
    mapping(address holder => euint128) private _shares;
    mapping(address holder => mapping(address spender => uint48)) private _operators;

    euint128 private _totalSupply;
    mapping(address holder => euint128) private _balances;

    uint256 lastRequestId;

    struct UnwrapRequest {
        address owner;
        euint128 encryptedAmount;
    }
    mapping(uint256 requestId => UnwrapRequest) private _unwrapRequests;

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

        multiplier = 1e18;
    }

    /// @inheritdoc ERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC165) returns (bool) {
        return interfaceId == type(IERC7984).interfaceId || super.supportsInterface(interfaceId);
    }

    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    /// @dev multiplier with 18 decimals
    function syncMultiplier() public {
        if (_sharesSupply != 0) {
            multiplier = uint128(unitToken.balanceOf(address(this))) * 1e18 / _sharesSupply;
            _updateTotalSupply();
        }
    }

    function syncUserBalance(address user) public {
        if (user != address(0)) {
            uint128 _multiplier = multiplier;
            userMultipliers[user] = _multiplier;
            _balances[user] = FHE.div(FHE.mul(_shares[user], _multiplier), 1e18);
            FHE.allowThis(_balances[user]);
            FHE.allow(_balances[user], user);
        }
    }

    function isUpToDate(address user) public view returns (bool) {
        return userMultipliers[user] == multiplier;
    }

    function confidentialTotalSupply() public view virtual returns (euint128) {
        return _totalSupply;
    }

    function confidentialBalanceOf(address account) public view virtual returns (euint128) {
        return _balances[account];
    }

    function totalSharesSupply() public view virtual returns (uint128) {
        return _sharesSupply;
    }

    function confidentialSharesOf(address account) public view virtual returns (euint128) {
        return _shares[account];
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
        _sharesSupply += amount * 1e18 / multiplier;
        _updateTotalSupply();
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
        _sharesSupply -= amount * 1e18 / multiplier;
        _updateTotalSupply();
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
        euint128 shares = FHE.div(FHE.mul(amount, 1e18), multiplier);

        if (from != address(0)) {
            euint128 fromShares = _shares[from];
            require(FHE.isInitialized(fromShares), ERC7984ZeroBalance(from));
            (success, ptr) = FHESafeMath.tryDecrease(fromShares, shares);
            FHE.allowThis(ptr);
            FHE.allow(ptr, from);
            _shares[from] = ptr;
            syncUserBalance(from);
        } else {
            success = FHE.asEbool(true);
        }

        if (to != address(0)) {
            ptr = FHE.add(_shares[to], FHE.select(success, shares, FHE.asEuint128(0)));
            FHE.allowThis(ptr);
            FHE.allow(ptr, to);
            _shares[to] = ptr;
            syncUserBalance(to);
        }

        transferred = FHE.select(success, amount, FHE.asEuint128(0));
        if (from != address(0)) FHE.allow(transferred, from);
        if (to != address(0)) FHE.allow(transferred, to);
        FHE.allowThis(transferred);
        emit ConfidentialTransfer(from, to, transferred);
    }

    function _updateTotalSupply() internal {
        _totalSupply = FHE.asEuint128(_sharesSupply * multiplier / 1e18);
        FHE.allowThis(_totalSupply);
    }
}
