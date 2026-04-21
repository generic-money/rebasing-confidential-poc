# cGUSD - Confidential GUSD Whitelabel

- **Shield** by wrapping Generic Unit tokens
- **Unshield** by first burning cGUSD, then claiming the unwrapped unit tokens
    - This two-step process is necessary because the contract cannot verify if the caller has sufficient balance to unwrap
- **Optional reveal** of users balance or transaction amount to any address for transparency

**Why do we need a confidential total supply if the total supply information is available via the unit token balance?** To comply with ERC7984.
