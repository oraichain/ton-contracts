import { getHttpEndpoint, Network } from '@orbs-network/ton-access';
import { WalletContractV3R2, WalletContractV4, TonClient, toNano, internal, OpenedContract } from '@ton/ton';
import { mnemonicToWalletKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
import Long from 'long';
dotenv.config();
const node_env = (process.env.NODE_ENV as Network) || 'testnet';

export async function waitSeqno(
    walletContract: OpenedContract<WalletContractV3R2> | OpenedContract<WalletContractV4>,
    seqno: number,
) {
    let currentSeqno = seqno;
    while (currentSeqno == seqno) {
        console.log('waiting for transaction to confirm...');
        await new Promise((resolve) => setTimeout(resolve, 3000));
        currentSeqno = await walletContract.getSeqno();
    }
    console.log('transaction confirmed!');
}
``;
export async function createTonWallet() {
    const endpoint = await getHttpEndpoint({ network: node_env });
    const client = new TonClient({ endpoint });
    const mnemonic = process.env.WALLET_MNEMONIC?.split(' ');
    if (!mnemonic) {
        throw new Error('Mnemonic is not set');
    }
    const key = await mnemonicToWalletKey(mnemonic);
    // NOTE: Testnet using WalletContractV3R2 and Mainnet using WalletContractV4
    let wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    if (node_env === 'testnet') {
        wallet = WalletContractV3R2.create({ publicKey: key.publicKey, workchain: 0 });
    }

    let walletContract = client.open(wallet);
    // Deployed by sending a simple transaction to another subwallet. Since the subwallet have not been deployed,
    // the fund will return.
    if (!(await client.isContractDeployed(wallet.address))) {
        console.log(wallet);
        const subWallet2 = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0, walletId: 110300 });
        const seqno = await walletContract.getSeqno();
        await walletContract.sendTransfer({
            secretKey: key.secretKey,
            seqno,
            messages: [
                internal({
                    to: subWallet2.address,
                    value: '0.05',
                }),
            ],
        });
        // wait until confirmed
        await waitSeqno(walletContract, seqno);
    }
    return { client, walletContract, key };
}

export const calculateIbcTimeoutTimestamp = (timeout: number, dateNow?: number) => {
    return Long.fromNumber(Math.floor((dateNow ?? Date.now()) / 1000) + timeout)
        .multiply(1000000000)
        .toString();
};
