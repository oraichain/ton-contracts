import { Address, toNano } from '@ton/core';
import * as dotenv from 'dotenv';
import { createTonWallet, waitSeqno } from './utils';
import { JettonMinter } from '../wrappers';
dotenv.config();

export async function updateClient() {
    var { client, walletContract, key } = await createTonWallet();
    const usdt = JettonMinter.createFromAddress(Address.parse(process.env.USDT_CLIENT as string));
    const usdtContract = client.open(usdt);
    await usdtContract.sendMint(
        walletContract.sender(key.secretKey),
        {
            toAddress: walletContract.address,
            jettonAmount: toNano(1000000000),
            amount: toNano(0.5),
        },
        { value: toNano('1') },
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
