const fs = require("fs");
const path = require("path");

function cleanEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  const quote = trimmed[0];

  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadRootEnv() {
  for (const rootEnvPath of [
    path.resolve(__dirname, "..", ".env"),
    path.resolve(__dirname, "..", "env", "sepolia.contracts.env"),
  ]) {
    if (!fs.existsSync(rootEnvPath)) {
      continue;
    }

    for (const line of fs.readFileSync(rootEnvPath, "utf8").split(/\r?\n/u)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
      if (!match || process.env[match[1]] !== undefined) {
        continue;
      }

      process.env[match[1]] = cleanEnvValue(match[2]);
    }
  }
}

loadRootEnv();

require("@fhevm/hardhat-plugin");
require("@nomicfoundation/hardhat-toolbox");
const { profileOptionalUrl, runtimeProfile } = require("../scripts/runtime-profile");

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const localProfile = runtimeProfile("local-dev");
const sepoliaProfile = runtimeProfile("sepolia-local-ui");
const localRpcUrl = profileOptionalUrl(localProfile, "rpcEnv", "defaultRpcUrl", "local RPC URL");
const sepoliaRpcUrl =
  profileOptionalUrl(sepoliaProfile, "rpcEnv", "defaultRpcUrl", "Sepolia RPC URL") ||
  "https://sepolia-rpc-unconfigured.zamapay.invalid";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: {
    localhost: {
      url: localRpcUrl,
      chainId: localProfile.chainId,
    },
    sepolia: {
      url: sepoliaRpcUrl,
      chainId: sepoliaProfile.chainId,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : [],
    },
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 800,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
