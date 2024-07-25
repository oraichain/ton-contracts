import { Address } from '@ton/core';
import { JettonMinter, JettonWallet } from '../wrappers';
import * as dotenv from 'dotenv';
import { createTonWallet } from './utils';
dotenv.config();

const main = async () => {
    const { client } = await createTonWallet();
    const jettonMinterAddress = 'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA';
    const bridgeAdapterAddress = process.env.BRIDGE_ADAPTER_CLIENT as string;
    const jettonMinter = JettonMinter.createFromAddress(Address.parse(jettonMinterAddress));
    const jettonMinterContract = client.open(jettonMinter);
    const jettonWalletAddress = await jettonMinterContract.getWalletAddress(
        Address.parse(bridgeAdapterAddress),
    );
    const jettonWallet = JettonWallet.createFromAddress(jettonWalletAddress);
    const jettonWalletContract = client.open(jettonWallet);
    const balance = await jettonWalletContract.getBalance();
    console.log(balance);
};

main();
