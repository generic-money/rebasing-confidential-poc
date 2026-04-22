import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("cGUSD", (m) => {
  const mock = "0x2456ca90f5C89a07051De8645DC16109C615B0F5";
  const cgusd = m.contract("cGUSD", [mock, "Confidential Generic USD", "cGUSD", ""]);
  return { cgusd };
});
