# anonymousTransfer (v0.2) FHE Operation Counts

Source function: `contracts/cGUSD.sol::anonymousTransfer`

Definition:
- `n = anonymitySet.length`

Scope:
- This table counts only HCU-metered FHE operations that map to rows in `FHE-limit.md` / `HCULimit.sol`.
- Helper calls such as `fromExternal`, `asEbool`, `asEuint64`, `isInitialized`, `allowThis`, and `allow` are excluded.
- `FHE.select(...)` is counted as `IfThenElse`.
- `FHE.and(...)` on `ebool` is counted as `BitAnd (enc)` on `Bool`.
- Nested operations inside function arguments are counted individually. For example, `FHE.select(isSender, FHE.sub(...), FHE.add(...))` contributes one `Sub (enc)`, one `Add (enc)`, and one `IfThenElse`.

## Count Table

| Operation | ebool | euint8 | euint64 | euint256 | Transaction cost variable | Transaction cost fixed |
|---|---:|---:|---:|---:|---:|---:|
| Add (enc) | 0 | 0 | `3n + 1` | 0 | `486,000n` | `162,000` |
| Sub (enc) | 0 | 0 | `n` | 0 | `162,000n` | 0 |
| BitAnd (enc) | `3n + 3` | 0 | 0 | 0 | `75,000n` | `75,000` |
| BitXor (scalar) | 0 | 0 | 0 | `n` | `39,000n` | 0 |
| Eq (scalar) | 0 | `2n` | 0 | 0 | `110,000n` | 0 |
| Eq (enc) | 0 | 0 | `1` | `n` | `152,000n` | `120,000` |
| Ge (enc) | 0 | 0 | `n` | 0 | `152,000n` | 0 |
| Lt (scalar) | 0 | `1` | 0 | 0 | 0 | `52,000` |
| IfThenElse | `n` | 0 | `2n` | 0 | `165,000n` | 0 |

## Transaction Cost by Anonymity Set Size

Total transaction cost from the count table:
- `total(n) = 1,341,000n + 409,000`

| anonymitySet size (`n`) | Total transaction cost (HCU) |
|---:|---:|
| 4 | `5,773,000` |
| 8 | `11,137,000` |
| 12 | `16,501,000` |
| 16 | `21,865,000` |

## Derivation Notes

`Add (enc)` on `euint64`:
- `sumBalanceChanges = FHE.add(...)` in validation loop: `n`
- `sumSenderBalanceChanges = FHE.add(...)` in validation loop: `n`
- `FHE.add(sumSenderBalanceChanges, sumSenderBalanceChanges)`: `1`
- Receiver branch `FHE.add(anonBalance, amount)` in execution loop: `n`
- Total: `3n + 1`

`Sub (enc)` on `euint64`:
- Sender branch `FHE.sub(anonBalance, amount)` in execution loop: `n`

`BitAnd (enc)` on `ebool`:
- `senderSufficientBalances = FHE.and(...)`: `n`
- `commitmentMatch = FHE.and(...)`: `n`
- `validCommitment = FHE.and(...)`: `n`
- `FHE.and(validBalanceChanges, validSenderIndex)`: `1`
- `FHE.and(validCommitment, ...)`: `1`
- `executeBalanceChanges = FHE.and(...)`: `1`
- Total: `3n + 3`

`BitXor (scalar)` on `euint256`:
- `txCommitment = FHE.xor(secret, inputHash)`: `n`

`Eq (scalar)` on `euint8`:
- `isSender = FHE.eq(senderIndex, uint8(i))` in validation loop: `n`
- `isSender = FHE.eq(senderIndex, uint8(i))` in execution loop: `n`
- Total: `2n`

`Eq (enc)`:
- `FHE.eq(sumBalanceChanges, FHE.add(...))` on `euint64`: `1`
- `FHE.eq(txCommitment, senderCommitment)` on `euint256`: `n`

`Ge (enc)` on `euint64`:
- `FHE.ge(_balances[anon], senderBalanceChange)`: `n`

`Lt (scalar)` on `euint8`:
- `FHE.lt(senderIndex, uint8(anonymitySetSize))`: `1`

`IfThenElse`:
- `FHE.select(isSender, commitmentMatch, FHE.asEbool(true))` on `ebool`: `n`
- `FHE.select(isSender, balanceChanges[i], FHE.asEuint64(0))` on `euint64`: `n`
- `FHE.select(executeBalanceChanges, balanceChanges[i], FHE.asEuint64(0))` on `euint64`: `n`
- Total: `n` on `ebool`, `2n` on `euint64`