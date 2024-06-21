import { createTonWallet, waitSeqno } from './utils';
import { Address, toNano } from '@ton/core';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { JettonMinter } from '../wrappers/JettonMinter';

async function deploy() {
    // =================== Setup TON Wallet ===================
    const { client, walletContract, key } = await createTonWallet();
    // =================== End Setup TON Wallet ===================

    // USDT
    const usdtMinterContract = client.open(
        JettonMinter.createFromAddress(Address.parse(process.env.USDT_CLIENT as string)),
    );

    const whitelistContract = client.open(
        WhitelistDenom.createFromAddress(Address.parse(process.env.WHITELIST_DENOM_CLIENT as string)),
    );

    await whitelistContract.sendSetDenom(
        walletContract.sender(key.secretKey),
        {
            denom: usdtMinterContract.address,
            isRootFromTon: true,
            permission: true,
        },
        {
            value: toNano('0.1'),
        },
    );
    await waitSeqno(walletContract, await walletContract.getSeqno());
}

deploy()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .then(() => {
        console.log('done');
        process.exit(0);
    });

// Success deploy light client at address:  EQCfMJi2oW9Gr_Gez8nZeW3wAlTZ9eSqJzcu5jTWguq_fiIr
// Success deploy usdtContract at address:  EQCcvbJBC2z5eiG00mtS6hYgijemXjMEnRrdPAenNSAringl
// Success deploy whitelistContract at address:  EQD2xPIqdeggqtP3q852Y_-7yD-RRHi12Zy7M4iUx4-7q0E1
// Success deploy tonBridgeContract at address:  EQAE8anZidQFTKcsKS_98iDEXFkvuoa1YmVPxQC279zAoV7R
