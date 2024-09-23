import * as dotenv from 'dotenv';
import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

dotenv.config();

const deployFunc: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployments, getNamedAccounts } = hre;

  const [signer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(signer.address);

  console.log(`signer is:${signer.address} balance is:${balance}`)
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`deployer is:${deployer}`)
  const args: string[] = ['0xF7E9CB6b7A157c14BCB6E6bcf63c1C7c92E952f5']; // BrevisRequest contract address on bsc testnet
  const deployment = await deploy('TransactionTimeFrame', {
    from: deployer,
    log: true,
    args: args
  });
  await hre.run('verify:verify', {
    address: deployment.address,
    constructorArguments: args ?? deployment.args
  });
  console.log(`deployment address is:${deployment.address}`)
};


deployFunc.tags = ['TransactionTimeFrame'];
deployFunc.dependencies = [];


export default deployFunc;
