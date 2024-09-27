import express, { NextFunction, Request, Response } from 'express';
import { buildCommonFailureResponse, buildFailureResponse, buildSuccessResponse } from './utils/RspUtil';
import { BizError } from './types';
import axios from 'axios';
import { configDotenv } from 'dotenv';
import { Brevis, ErrCode, ProofRequest, Prover, TransactionData } from 'brevis-sdk-typescript';
import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';
import * as process from 'node:process';
import { ABI } from './abi/BrevisRequest';

const app = express();
configDotenv();
const port = 8081;
const needCheckVaribales = ['ENV_BSC_SCAN_API_KEY',
    'ENV_KEYSTORE_PATH',
    'ENV_KEYSTORE_PASSWORD',
    'ENV_BSC_SCAN_API_URL',
    'ENV_APP_CONTRACT_ADDRESS',
    'ENV_BSC_SCAN_API_URL',
    'ENV_BSC_SRC_CHAIN_ID',
    'ENV_BSC_DES_CHAIN_ID',
    'ENV_SRC_RPC_URL',
    'ENV_DES_RPC_URL'];

needCheckVaribales.forEach((key) => {
    if (!process.env[key]) {
        throw new Error(`${key} is required`);
    }
});
const keyStorePath = process.env.ENV_KEYSTORE_PATH;
const keyStorePassword = process.env.ENV_KEYSTORE_PASSWORD;

const srcChainId = process.env.ENV_BSC_SRC_CHAIN_ID;
const desChainId = process.env.ENV_BSC_DES_CHAIN_ID;

// @ts-ignore
let brevisRequestContract: ethers.Contract;

const appCallBackAddress = process.env.ENV_APP_CONTRACT_ADDRESS;
const bscScanApiUrl = process.env.ENV_BSC_SCAN_API_URL;

if (!(process.env.ENV_PROVER_URL && process.env.ENV_BREVIS_SERVICE_URL)) {
    throw new Error('ENV_PROVER_URL and ENV_BREVIS_SERVICE_URL are required');
}
// @ts-ignore
const prover = new Prover(process.env.ENV_PROVER_URL);
// @ts-ignore
const brevis = new Brevis(process.env.ENV_BREVIS_SERVICE_URL);

app.use(express.static('static'));
app.use(express.json());

let signer;
app.listen(port, async () => {
    // @ts-ignore
    const wallet = await loadKeystoreFromFile(keyStorePath, keyStorePassword);
    const provider = new ethers.providers.JsonRpcProvider(process.env.ENV_DES_RPC_URL);
    signer = wallet.connect(provider);
    const brevisRequestAddress = process.env.ENV_BREVIS_REQUEST_CONTRACT_ADDRESS;
    // @ts-ignore
    brevisRequestContract = new ethers.Contract(brevisRequestAddress, ABI, signer);
    console.log(`Server running on port ${port}`);
});


//curl http://ip:port/brevis-network/transaction/proof?address=0x?????
app.get('/brevis-network/transaction/proof', (req: Request, res: Response, next: NextFunction) => {
    transactionProof(req, res, next);
});

app.use((req: Request, res: Response) => {
    res.status(404).send('404 Not Found');
});


app.use((err: BizError, req: Request, res: Response, next: Function) => {
    return res.status(200).set('Content-Type', 'application/json').send(buildFailureResponse(err));
});

app.use((err: Error, req: Request, res: Response, next: Function) => {
    return res.status(200).set('Content-Type', 'application/json').send(buildCommonFailureResponse());
});

async function transactionProof(req: Request, res: Response, next: NextFunction) {
    if (!brevisRequestContract) {
        return next(new BizError('-10000', 'Server not ready'));
    }
    let address = req.query.address as string;
    let signature = req.query.signature as string;
    let timestamp = req.query.timestamp as string;
    console.log(`Generate transaction proof for ${address},timestamp:${timestamp},signature:${signature}`);
    if (!address) {
        return next(new BizError('-10001', 'Address is required'));
    }
    //select transaction from dune
    const url = `${bscScanApiUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=1&sort=desc&apikey=${process.env.ENV_BSC_SCAN_API_KEY}`;
    const rsp = await axios.get(url);
    if (!(rsp.status && rsp.data.result.length > 0)) {
        return next(new BizError('-10003', 'No transaction found'));
    }
    const transactionApi = rsp.data.result[0];
    const blockTime = transactionApi.timeStamp;
    if (!checkBlockTime(blockTime)) {
        return next(new BizError('-10003', 'Transaction is not met requirement!'));
    }
    const transactionId = transactionApi.hash;
    //start to handle brevis process
    console.log(`transactionId :${transactionId}`);
    const proofReq = new ProofRequest();

    const provider = new ethers.providers.JsonRpcProvider(process.env.ENV_SRC_RPC_URL);

    console.log(`Get transaction info for ${transactionId}`);
    const transaction = await provider.getTransaction(transactionId);
    if (!transaction) {
        return next(new BizError('-10005', 'Transaction not found'));
    }

    const gasLimit = new BigNumber(transaction.gasLimit.toString());
    const maxSafeInteger = new BigNumber(Number.MAX_SAFE_INTEGER);
    if (gasLimit.gt(maxSafeInteger)) {
        return next(new BizError('-10009', 'Transaction invalid. Gas limit is too large.'));
    }
    console.log(`transactionId :{}, transaction type:${transaction.type}`)
    if (transaction.type != 0 && transaction.type != 2) {
        return next(new BizError('-10008', 'Only type 0 and  2 transactions are supported'));
    }

    const receipt = await provider.getTransactionReceipt(transactionId)
    var gas_tip_cap_or_gas_price = '';
    var gas_fee_cap = '';
    if (transaction.type === 0) {
        gas_tip_cap_or_gas_price = transaction.gasPrice?._hex ?? '0';
        gas_fee_cap = '0';
    } else {
        gas_tip_cap_or_gas_price = transaction.maxPriorityFeePerGas?._hex ?? '0';
        gas_fee_cap = transaction.maxFeePerGas?._hex ?? '0';
    }

    proofReq.addTransaction(
        // @ts-ignore
        new TransactionData({
            hash: transactionId,
            chain_id: transaction.chainId,
            block_num: transaction.blockNumber,
            nonce: transaction.nonce,
            gas_tip_cap_or_gas_price: gas_tip_cap_or_gas_price,
            gas_fee_cap: gas_fee_cap,
            gas_limit: transaction.gasLimit.toNumber(),
            from: transaction.from,
            to: transaction.to,
            value: transaction.value._hex,
        }),
    );

    console.log(`Send prove request for ${transactionId}`);

    let proofRes;

    try {
        proofRes = await prover.prove(proofReq);
    } catch (err) {
        // @ts-ignore
        console.log(err.message);
        return next(new BizError('-10006', 'Call prover error'));
    }
    // error handling
    if (proofRes.has_err) {
        const err = proofRes.err;
        switch (err.code) {
            case ErrCode.ERROR_INVALID_INPUT:
                console.error('invalid receipt/storage/transaction input:', err.msg);
                break;

            case ErrCode.ERROR_INVALID_CUSTOM_INPUT:
                console.error('invalid custom input:', err.msg);
                break;

            case ErrCode.ERROR_FAILED_TO_PROVE:
                console.error('failed to prove:', err.msg);
                break;
        }
        return;
    }
    console.log('proof', proofRes.proof);

    try {

        // @ts-ignore
        const brevisRes = await brevis.submit(proofReq, proofRes, srcChainId, desChainId, 0, '', appCallBackAddress);

        // console.log('brevis res', brevisRes);

        console.log('brevis proofId', brevisRes.queryKey.query_hash);
        console.log('brevis _nonce', brevisRes.queryKey.nonce);
        console.log('brevisRes fee', brevisRes.fee);
        const nonce = await brevisRequestContract.signer.getTransactionCount();
        //pay for the order
        const tx = await brevisRequestContract.sendRequest(brevisRes.queryKey.query_hash,
            brevisRes.queryKey.nonce,
            address,
            [appCallBackAddress, 1],
            0, { value: brevisRes.fee, nonce: nonce, gasPrice: 5000000000});
        await tx.wait();
        console.log(`tx hash:${tx.hash},nonce:${nonce}`);
        console.log(`pay for transactionId:${transactionId}, proofId:${brevisRes.queryKey.query_hash},nonce:${brevisRes.queryKey.nonce},fee:${brevisRes.fee}`);
        return res.status(200).set('Content-Type', 'application/json').send(buildSuccessResponse({
            proofId: brevisRes.queryKey.query_hash,
            blockNumber: transaction.blockNumber,
        }));
    } catch (err) {
        console.error(err);
        return next(new BizError('-10007', 'Call brevis error'));
    }

    return res.status(200).set('Content-Type', 'application/json').send(buildCommonFailureResponse());
}

function checkBlockTime(timestamp: number): boolean {
    // check timestamp > 2024-07-01
    //month starts from 0, so param month should be  6
    const july1st2024 = new Date(2024, 6, 1).getTime();
    const timestampMs = timestamp * 1000;
    return timestampMs >= july1st2024;
}

async function loadKeystoreFromFile(keystorePath: string, password: string): Promise<ethers.Wallet> {
    const fs = require('fs');
    const keystoreJson = fs.readFileSync(keystorePath, 'utf8');
    return ethers.Wallet.fromEncryptedJson(keystoreJson, password);
}


