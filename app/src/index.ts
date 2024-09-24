import express, { NextFunction, Request, Response } from 'express';
import { buildCommonFailureResponse, buildFailureResponse } from './utils/RspUtil';
import { BizError } from './types';
import axios from 'axios';
import { configDotenv } from 'dotenv';
import { Brevis, ErrCode, ProofRequest, Prover, TransactionData } from 'brevis-sdk-typescript';
import {ethers } from 'ethers';
import BigNumber from 'bignumber.js';

const app = express();
configDotenv();
const port = 8081;

if (!process.env.ENV_BSC_SCAN_API_KEY) {
    throw new Error('ENV_BSC_SCAN_API_KEY is required');
}

if(!process.env.ENV_BSC_SCAN_API_URL){
    throw new Error('ENV_BSC_SCAN_API_URL is required');
}

if(!process.env.ENV_APP_CONTRACT_ADDRESS){
    throw new Error('ENV_APP_CONTRACT_ADDRESS is required!');
}

const appCallBackAddress  = process.env.ENV_APP_CONTRACT_ADDRESS
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

app.listen(port, () => {
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


// Create a map to store the auth requests and their session IDs
const requestMap = new Map();

// GetQR returns auth request
async function transactionProof(req: Request, res: Response, next: NextFunction) {
    let address = req.query.address as string;
    console.log(`Generate transaction proof for ${address}`);
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
    const timestamp = transactionApi.timeStamp;
    if (!isTimestampWithinLast30Days(timestamp)) {
        return next(new BizError('-10003', 'Transaction is not met requirement!'));
    }
    const transactionId = transactionApi.hash;
    //start to handle brevis process
    console.log(`transactionId :${transactionId}`);
    const proofReq = new ProofRequest();

    const provider = new ethers.providers.JsonRpcProvider(process.env.ENV_BSC_RPC_URL);

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

    if (transaction.type != 0 && transaction.type != 2) {
        return next(new BizError('-10008', 'Only type0 and type2 transactions are supported'));
    }

    // if (transaction.nonce != 0) {
    //     console.error("only transaction with nonce 0 is supported by sample circuit")
    //     return
    // }

    // const receipt = await provider.getTransactionReceipt(transactionId)
    var gas_tip_cap_or_gas_price = '';
    var gas_fee_cap = '';
    if (transaction.type === 0) {
        gas_tip_cap_or_gas_price = transaction.gasPrice?._hex ?? '0'
        gas_fee_cap = '0'
    } else {
        gas_tip_cap_or_gas_price = transaction.maxPriorityFeePerGas?._hex ?? '0'
        gas_fee_cap = transaction.maxFeePerGas?._hex ?? '0'
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
        console.log(err.message)
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

        const brevisRes = await brevis.submit(proofReq, proofRes, 56, 97, 0, '', appCallBackAddress);

        console.log('brevis res', brevisRes);

        await brevis.wait(brevisRes.queryKey, 97);
    } catch (err) {
        console.error(err);
        return next(new BizError('-10007', 'Call brevis error'))
    }

    return res.status(200).set('Content-Type', 'application/json').send({ success: true });
}

function isTimestampWithinLast30Days(timestamp: number): boolean {
    const now = new Date().getTime();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60) * 1000;
    return Number(timestamp) * 1000 >= thirtyDaysAgo;
}


