import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MockERC20", (m) => {
  const mock = m.contract("MockERC20", ["Mock ERC20", "M20"]);

  return { mock };
});
