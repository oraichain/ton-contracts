import { Address, beginCell, toNano } from '@ton/core';
import * as dotenv from 'dotenv';
import { createTonWallet, waitSeqno } from './utils';
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

    await usdtJettonWalletContract.sendTransfer(
        walletContract.sender(key.secretKey),
        {
            fwdAmount: toNano(0.45), // 1.95
            jettonAmount: toNano(100_000_000),
            jettonMaster: usdtContract.address,
            toAddress: bridgeAdapterAddress,
            memo: beginCell()
                .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                .storeRef(beginCell().storeBuffer(Buffer.from('channel-1')).endCell())
                .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                .storeRef(beginCell().storeBuffer(Buffer.from('orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx')).endCell())
                .endCell(),
        },
        {
            value: toNano(0.5), // 2- 0.05
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
