import { Address, beginCell, toNano } from '@ton/core';
import * as dotenv from 'dotenv';
import { calculateIbcTimeoutTimestamp, createTonWallet, waitSeqno } from './utils';
import { BridgeAdapter, JettonMinter } from '../wrappers';
dotenv.config();

export async function updateClient() {
    var { client, walletContract, key } = await createTonWallet();
    const bridgeAdapterAddress = Address.parse(process.env.BRIDGE_ADAPTER_CLIENT as string);
    const bridgeAdapter = BridgeAdapter.createFromAddress(bridgeAdapterAddress);
    const bridgeAdapterContract = client.open(bridgeAdapter);

    await bridgeAdapterContract.sendBridgeTon(
        walletContract.sender(key.secretKey),
        {
            amount: toNano('1'),
            timeout: BigInt(Math.floor(new Date().getTime() / 1000) + 3600),
            remoteReceiver: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
            memo: beginCell().endCell(),
        },
        {
            value: toNano(1.2),
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
