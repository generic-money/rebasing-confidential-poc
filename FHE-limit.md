# FHE Operation Cost Limits

Source: `node_modules/@fhevm/host-contracts/contracts/HCULimit.sol`

Notes:
- `scalar` means the operation uses one encrypted operand and one clear scalar operand.
- `enc` means ciphertext-ciphertext.
- `N/A` means the operation is not supported for that type in `HCULimit.sol`.
- Values are HCU operation costs as defined in the contract.

## Arithmetic

| Operation | Bool | Uint8 | Uint16 | Uint32 | Uint64 | Uint128 | Uint160 | Uint256 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Add (scalar) | N/A | 84000 | 93000 | 95000 | 133000 | 172000 | N/A | N/A |
| Add (enc) | N/A | 88000 | 93000 | 125000 | 162000 | 259000 | N/A | N/A |
| Sub (scalar) | N/A | 84000 | 93000 | 95000 | 133000 | 172000 | N/A | N/A |
| Sub (enc) | N/A | 91000 | 93000 | 125000 | 162000 | 260000 | N/A | N/A |
| Mul (scalar) | N/A | 122000 | 193000 | 265000 | 365000 | 696000 | N/A | N/A |
| Mul (enc) | N/A | 150000 | 222000 | 328000 | 596000 | 1686000 | N/A | N/A |
| Div (scalar only) | N/A | 210000 | 302000 | 438000 | 715000 | 1225000 | N/A | N/A |
| Rem (scalar only) | N/A | 440000 | 580000 | 792000 | 1153000 | 1943000 | N/A | N/A |
| Neg | N/A | 79000 | 93000 | 95000 | 131000 | 168000 | N/A | 269000 |

## Bitwise

| Operation | Bool | Uint8 | Uint16 | Uint32 | Uint64 | Uint128 | Uint160 | Uint256 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BitAnd (scalar) | 22000 | 31000 | 31000 | 32000 | 34000 | 37000 | N/A | 38000 |
| BitAnd (enc) | 25000 | 31000 | 31000 | 32000 | 34000 | 37000 | N/A | 38000 |
| BitOr (scalar) | 22000 | 30000 | 30000 | 32000 | 34000 | 37000 | N/A | 38000 |
| BitOr (enc) | 24000 | 30000 | 31000 | 32000 | 34000 | 37000 | N/A | 38000 |
| BitXor (scalar) | 22000 | 31000 | 31000 | 32000 | 34000 | 37000 | N/A | 39000 |
| BitXor (enc) | 22000 | 31000 | 31000 | 32000 | 34000 | 37000 | N/A | 39000 |
| Not | 2 | 9 | 16 | 32 | 63 | 130 | N/A | 130 |

## Shifts and Rotations

| Operation | Bool | Uint8 | Uint16 | Uint32 | Uint64 | Uint128 | Uint160 | Uint256 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Shl (scalar) | N/A | 32000 | 32000 | 32000 | 34000 | 37000 | N/A | 39000 |
| Shl (enc) | N/A | 92000 | 125000 | 162000 | 208000 | 272000 | N/A | 378000 |
| Shr (scalar) | N/A | 32000 | 32000 | 32000 | 34000 | 37000 | N/A | 38000 |
| Shr (enc) | N/A | 91000 | 123000 | 163000 | 209000 | 272000 | N/A | 369000 |
| Rotl (scalar) | N/A | 31000 | 31000 | 32000 | 34000 | 37000 | N/A | 38000 |
| Rotl (enc) | N/A | 91000 | 125000 | 163000 | 209000 | 278000 | N/A | 378000 |
| Rotr (scalar) | N/A | 31000 | 31000 | 32000 | 34000 | 37000 | N/A | 40000 |
| Rotr (enc) | N/A | 93000 | 125000 | 160000 | 209000 | 283000 | N/A | 375000 |

## Comparisons

| Operation | Bool | Uint8 | Uint16 | Uint32 | Uint64 | Uint128 | Uint160 | Uint256 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Eq (scalar) | 25000 | 55000 | 55000 | 82000 | 83000 | 117000 | 117000 | 118000 |
| Eq (enc) | 26000 | 55000 | 83000 | 86000 | 120000 | 122000 | 137000 | 152000 |
| Ne (scalar) | 23000 | 55000 | 55000 | 83000 | 84000 | 117000 | 117000 | 117000 |
| Ne (enc) | 23000 | 55000 | 83000 | 85000 | 118000 | 122000 | 136000 | 150000 |
| Ge (scalar) | N/A | 52000 | 55000 | 84000 | 116000 | 149000 | N/A | N/A |
| Ge (enc) | N/A | 63000 | 84000 | 118000 | 152000 | 210000 | N/A | N/A |
| Gt (scalar) | N/A | 52000 | 55000 | 84000 | 117000 | 150000 | N/A | N/A |
| Gt (enc) | N/A | 59000 | 84000 | 118000 | 152000 | 218000 | N/A | N/A |
| Le (scalar) | N/A | 58000 | 58000 | 84000 | 119000 | 150000 | N/A | N/A |
| Le (enc) | N/A | 58000 | 83000 | 117000 | 149000 | 218000 | N/A | N/A |
| Lt (scalar) | N/A | 52000 | 58000 | 83000 | 118000 | 149000 | N/A | N/A |
| Lt (enc) | N/A | 59000 | 84000 | 117000 | 146000 | 215000 | N/A | N/A |
| Min (scalar) | N/A | 84000 | 88000 | 117000 | 150000 | 186000 | N/A | N/A |
| Min (enc) | N/A | 119000 | 146000 | 182000 | 219000 | 289000 | N/A | N/A |
| Max (scalar) | N/A | 89000 | 89000 | 117000 | 149000 | 180000 | N/A | N/A |
| Max (enc) | N/A | 121000 | 145000 | 180000 | 218000 | 290000 | N/A | N/A |

## Casts, Selection, and Randomness

| Operation | Bool | Uint8 | Uint16 | Uint32 | Uint64 | Uint128 | Uint160 | Uint256 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Cast | 32 | 32 | 32 | 32 | 32 | 32 | N/A | 32 |
| TrivialEncrypt | 32 | 32 | 32 | 32 | 32 | 32 | 32 | 32 |
| IfThenElse | 55000 | 55000 | 55000 | 55000 | 55000 | 57000 | 83000 | 108000 |
| Rand | 19000 | 23000 | 23000 | 24000 | 24000 | 25000 | N/A | 30000 |
| RandBounded | N/A | 23000 | 23000 | 24000 | 24000 | 25000 | N/A | 30000 |