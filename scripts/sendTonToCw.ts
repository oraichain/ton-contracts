import { Address, beginCell, toNano } from '@ton/core';
import * as dotenv from 'dotenv';
import { calculateIbcTimeoutTimestamp, createTonWallet, waitSeqno } from './utils';
import { JettonMinter, JettonWallet } from '../wrappers';
dotenv.config();

export async function updateClient() {
    var { client, walletContract, key } = await createTonWallet();
    const usdt = JettonMinter.createFromAddress(Address.parse(process.env.USDT_CLIENT as string));
    const bridgeAdapterAddress = Address.parse(process.env.BRIDGE_ADAPTER_CLIENT as string);
    const usdtContract = client.open(usdt);
    const usdtWalletAddress = await usdtContract.getWalletAddress(walletContract.address);
    const usdtJettonWallet = JettonWallet.createFromAddress(usdtWalletAddress);
    const usdtJettonWalletContract = client.open(usdtJettonWallet);

    // console.log(BigInt(calculateIbcTimeoutTimestamp(3600)));
    // BigInt(Math.floor(new Date().getTime() / 1000) - 3600)
    // BigInt(calculateIbcTimeoutTimestamp(3600))

    await usdtJettonWalletContract.sendTransfer(
        walletContract.sender(key.secretKey),
        {
            fwdAmount: toNano(0.1),
            jettonAmount: 10_000n,
            jettonMaster: usdtContract.address,
            toAddress: bridgeAdapterAddress,
            timeout: BigInt(Math.floor(new Date().getTime() / 1000) - 3600),
            remoteReceiver: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
            memo: beginCell().endCell(),
        },
        {
            value: toNano(0.2),
            queryId: 0,
        },
    );
    await waitSeqno(walletContract, await walletContract.getSeqno());
}

updateClient()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .then(() => {
        console.log('done');
        process.exit(0);
    });
