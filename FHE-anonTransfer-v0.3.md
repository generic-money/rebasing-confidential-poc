# anonymousTransfer (v0.3) FHE Operation Counts

Source function: `contracts/cGUSD.sol::anonymousTransfer`

Definitions:
- `n = anonymitySet.length`
- `m = number of addresses in anonymitySet with initialized secret` (`FHE.isInitialized(_privateSecret[anon]) == true`)

Scope:
- This table counts only HCU-metered FHE operations that map to rows in `FHE-limit.md` / `HCULimit.sol`.
- Helper calls such as `fromExternal`, `asEbool`, `asEuint64`, `isInitialized`, `allowThis`, and `allow` are excluded.
- `FHE.select(...)` is counted as `IfThenElse`.
- `FHE.and(...)` on `ebool` is counted as `BitAnd (enc)` on `Bool`.
- `FHE.or(...)` on `ebool` is counted as `BitOr (enc)` on `Bool`.
- Nested operations inside function arguments are counted individually. For example, `FHE.select(isSender[i], FHE.sub(...), FHE.add(...))` contributes one `Sub (enc)`, one `Add (enc)`, and one `IfThenElse`.

## Count Table (General: `0 <= m <= n`)

| Operation | ebool | euint8 | euint64 | euint256 | Transaction cost variable | Transaction cost fixed |
|---|---:|---:|---:|---:|---:|---:|
| Add (enc) | 0 | 0 | `2n + m + 1` | 0 | `324,000n + 162,000m` | `162,000` |
| Sub (enc) | 0 | 0 | `n` | 0 | `162,000n` | 0 |
| BitAnd (enc) | `m + 2` | 0 | 0 | 0 | `25,000m` | `50,000` |
| BitOr (enc) | `m` | 0 | 0 | 0 | `24,000m` | 0 |
| BitXor (scalar) | 0 | 0 | 0 | `m` | `39,000m` | 0 |
| Eq (enc) | 0 | 0 | `1` | `m` | `152,000m` | `120,000` |
| Ge (enc) | 0 | 0 | `m` | 0 | `152,000m` | 0 |
| IfThenElse | 0 | 0 | `2n + m` | 0 | `110,000n + 55,000m` | 0 |

Total transaction cost from the count table:
- `total(n, m) = 596,000n + 609,000m + 332,000`

## Common Case Table (All Secrets Initialized: `m = n`)

If every member in the anonymity set has an initialized secret, then:
- `total(n) = 1,205,000n + 332,000`

| anonymitySet size (`n`) | Total transaction cost (HCU) |
|---:|---:|
| 4 | `5,152,000` |
| 8 | `9,972,000` |
| 12 | `14,792,000` |
| 16 | `19,612,000` |

## Derivation Notes

`Add (enc)` on `euint64`:
- `sumBalanceChanges = FHE.add(...)` in validation loop: `n`
- `sumSenderBalanceChanges = FHE.add(...)` in initialized-secret branch: `m`
- `FHE.add(sumSenderBalanceChanges, sumSenderBalanceChanges)`: `1`
- Receiver branch `FHE.add(anonBalance, amount)` in execution loop: `n`
- Total: `2n + m + 1`

`Sub (enc)` on `euint64`:
- Sender branch `FHE.sub(anonBalance, amount)` in execution loop: `n`

`BitAnd (enc)` on `ebool`:
- `senderSufficientBalances = FHE.and(...)` in initialized-secret branch: `m`
- `FHE.and(senderFound, validBalanceChanges)`: `1`
- `FHE.and(validInputs, senderSufficientBalances)`: `1`
- Total: `m + 2`

`BitOr (enc)` on `ebool`:
- `senderFound = FHE.or(senderFound, commitmentMatch)` in initialized-secret branch: `m`

`BitXor (scalar)` on `euint256`:
- `anonCommitment = FHE.xor(secret, keccak256(...))` in initialized-secret branch: `m`

`Eq (enc)`:
- `FHE.eq(sumBalanceChanges, FHE.add(...))` on `euint64`: `1`
- `FHE.eq(anonCommitment, senderCommitment)` on `euint256`: `m`

`Ge (enc)` on `euint64`:
- `FHE.ge(_balances[anon], senderBalanceChange)` in initialized-secret branch: `m`

`IfThenElse` on `euint64`:
- `FHE.select(commitmentMatch, balanceChanges[i], FHE.asEuint64(0))` in initialized-secret branch: `m`
- `FHE.select(executeBalanceChanges, balanceChanges[i], FHE.asEuint64(0))` in execution loop: `n`
- `FHE.select(isSender[i], FHE.sub(...), FHE.add(...))` in execution loop: `n`
- Total: `2n + m`
