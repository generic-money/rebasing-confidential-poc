# cGUSD - Rebasing Confidential GUSD Whitelabel

- **Shield** by wrapping Generic Unit tokens
- **Unshield** by first burning cGUSD, then claiming the unwrapped unit tokens
    - This two-step process is necessary because the contract cannot verify if the caller has sufficient balance to unwrap
- **Rebasing multiplier** calculated using the underlying Generic Unit balance and total cGUSD supply
    - Confidential total supply is updated on multiplier sync
    - Confidential user balances are updated on transfer or must be updated manually
    - Wallets can fetch user shares and apply the multiplier to obtain the current balance
- **Optional reveal** of users balance or transaction amount to any address for transparency

**Why do we need a confidential total supply if the total supply information is available via the unit token balance?** To comply with ERC7984.

**Why can't we apply the multiplier to confidential user balances before returning them?** Because Zama encrypted values are pointers that cannot be used in algebraic operations.