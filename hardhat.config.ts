import hardhatVerify from '@nomicfoundation/hardhat-verify';
import { configVariable, type HardhatUserConfig } from 'hardhat/config';

const config: HardhatUserConfig = {
  plugins: [hardhatVerify],
  networks: {
    sepolia: { type: 'http', chainType: 'l1', url: configVariable('SEPOLIA_RPC_URL') },
  },
  verify: {
    etherscan: { apiKey: configVariable('ETHERSCAN_API_KEY') },
    sourcify: { enabled: true },
  },
  test: {
    solidity: {
      forking: { rpcEndpoints: { sepolia: configVariable('SEPOLIA_RPC_URL', { default: '' }) } },
    },
  },
  solidity: {
    version: '0.8.29',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: 'contracts',
    tests: { solidity: 'contracts' },
  },
};

export default config;
