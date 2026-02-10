// SPDX-License-Identifier: MIT
// OpenZeppelin Confidential Contracts (last updated v0.3.0) (utils/FHESafeMath.sol)
pragma solidity ^0.8.24;

import {FHE, ebool, euint128} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @dev Library providing safe arithmetic operations for encrypted values
 * to handle potential overflows in FHE operations.
 *
 * NOTE: An uninitialized `euint128` value (equivalent to euint128.wrap(bytes32(0))) is evaluated as 0.
 * This library will may return an uninitialized value if all inputs are uninitialized.
 */
library FHESafeMath {
    /**
     * @dev Try to increase the encrypted value `oldValue` by `delta`. If the operation is successful,
     * `success` will be true and `updated` will be the new value. Otherwise, `success` will be false
     * and `updated` will be the original value.
     */
    function tryIncrease(euint128 oldValue, euint128 delta) internal returns (ebool success, euint128 updated) {
        if (!FHE.isInitialized(oldValue)) {
            return (FHE.asEbool(true), delta);
        }
        euint128 newValue = FHE.add(oldValue, delta);
        success = FHE.ge(newValue, oldValue);
        updated = FHE.select(success, newValue, oldValue);
    }

    /**
     * @dev Try to decrease the encrypted value `oldValue` by `delta`. If the operation is successful,
     * `success` will be true and `updated` will be the new value. Otherwise, `success` will be false
     * and `updated` will be the original value.
     */
    function tryDecrease(euint128 oldValue, euint128 delta) internal returns (ebool success, euint128 updated) {
        if (!FHE.isInitialized(oldValue)) {
            if (!FHE.isInitialized(delta)) {
                return (FHE.asEbool(true), oldValue);
            }
            return (FHE.eq(delta, 0), FHE.asEuint128(0));
        }
        success = FHE.ge(oldValue, delta);
        updated = FHE.select(success, FHE.sub(oldValue, delta), oldValue);
    }

    /**
     * @dev Try to add `a` and `b`. If the operation is successful, `success` will be true and `res`
     * will be the sum of `a` and `b`. Otherwise, `success` will be false, and `res` will be 0.
     */
    function tryAdd(euint128 a, euint128 b) internal returns (ebool success, euint128 res) {
        if (!FHE.isInitialized(a)) {
            return (FHE.asEbool(true), b);
        }
        if (!FHE.isInitialized(b)) {
            return (FHE.asEbool(true), a);
        }

        euint128 sum = FHE.add(a, b);
        success = FHE.ge(sum, a);
        res = FHE.select(success, sum, FHE.asEuint128(0));
    }

    /**
     * @dev Try to subtract `b` from `a`. If the operation is successful, `success` will be true and `res`
     * will be `a - b`. Otherwise, `success` will be false, and `res` will be 0.
     */
    function trySub(euint128 a, euint128 b) internal returns (ebool success, euint128 res) {
        if (!FHE.isInitialized(b)) {
            return (FHE.asEbool(true), a);
        }

        euint128 difference = FHE.sub(a, b);
        success = FHE.le(difference, a);
        res = FHE.select(success, difference, FHE.asEuint128(0));
    }
}
