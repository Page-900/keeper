import { configVariable, type HardhatUserConfig } from 'hardhat/config';

const config: HardhatUserConfig = {
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
