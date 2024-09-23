import abi from './abi/TransactionTimeFrame.json';
import { ethers } from 'ethers';
import { configDotenv } from 'dotenv';
configDotenv()

const privateKey = process.env.PRIVATE_KEY;
console.log(`privateKey:${privateKey}`)
// @ts-ignore
const wallet = new ethers.Wallet(privateKey);

const provider = new ethers.JsonRpcProvider(process.env.BSC_TEST_ENDPOINT); //
// const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com'); //
const signer = wallet.connect(provider);

//https://github.com/Eoracle/eoracle-middleware/tree/develop/src
const contractAddress = '0x26D9AFB34eE9D1e860607f1D4c06d6Fc8E66d67E';
// @ts-ignore
const contract = new ethers.Contract(contractAddress, abi, signer);

async function callContractFunction() {
    const tx = await contract.setVkHash('0x09e53f06941342eac68c04897bb991ea990f8ecf0a2a31c41e93dd0b9a8a3caf')
    const receipt = await tx.wait();
    console.log(receipt)
}

callContractFunction();

