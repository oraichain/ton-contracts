import { compile } from '@ton/blueprint';
import { LightClient } from '../wrappers/LightClient';
import { createTonWallet, waitSeqno } from './utils';
import { Address, beginCell, toNano } from '@ton/core';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { BridgeAdapter } from '../wrappers/BridgeAdapter';
import { JettonMinter } from '../wrappers/JettonMinter';

async function deploy() {
    // =================== Setup TON Wallet ===================
    const { client, walletContract, key } = await createTonWallet();
    // =================== End Setup TON Wallet ===================

    // =================== Deploy Contract ===================
    // LIGHT CLIENT
    const lightClient = client.open(
        LightClient.createFromConfig(
            {
                chainId: 'Oraichain',
                dataHash: '',
                height: 11111,
                nextValidatorHashSet: '',
                validatorHashSet: '',
            },
            await compile('LightClient'),
        ),
    );
    await lightClient.sendDeploy(walletContract.sender(key.secretKey), toNano('0.5'));
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy light client at address: ', lightClient.address);

    // USDT
    const usdtMinterContract = client.open(
        JettonMinter.createFromConfig(
            {
                adminAddress: walletContract.address,
                content: beginCell()
                    .storeBuffer(Buffer.from('USDT Token'))
                    .storeBuffer(Buffer.from('USDT'))
                    .storeBuffer(Buffer.from('USDT token from Telegram OpenNetwork'))
                    .endCell(),
                jettonWalletCode: await compile('JettonWallet'),
            },
            await compile('JettonMinter'),
        ),
    );
    await usdtMinterContract.sendDeploy(walletContract.sender(key.secretKey), { value: toNano('3') });
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy usdtContract at address: ', usdtMinterContract.address);

    await usdtMinterContract.sendMint(
        walletContract.sender(key.secretKey),
        {
            toAddress: walletContract.address,
            jettonAmount: toNano(1_000_000),
            amount: toNano(0.5),
        },
        { value: toNano(1), queryId: 0 },
    );

    const whitelistContract = client.open(
        WhitelistDenom.createFromConfig(
            {
                admin: walletContract.address,
            },
            await compile('WhitelistDenom'),
        ),
    );

    await whitelistContract.sendDeploy(walletContract.sender(key.secretKey), toNano('0.5'));
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy whitelistContract at address: ', whitelistContract.address);

    await whitelistContract.sendSetDenom(
        walletContract.sender(key.secretKey),
        {
            denom: usdtMinterContract.address,
            isRootFromTon: true,
            permission: true,
        },
        {
            value: toNano('1'),
        },
    );
    await waitSeqno(walletContract, await walletContract.getSeqno());

    // BRIDGE ADAPTER
    const tonBridge = BridgeAdapter.createFromConfig(
        {
            light_client: lightClient.address,
            jetton_wallet_code: await compile('JettonWallet'),
            bridge_wasm_smart_contract: 'orai1pq2nfsylg344z6fwxkyzu0twmvr4mdrwc2zm4frynlcteypjt82sm2k2fu',
            whitelist_denom: whitelistContract.address,
        },
        await compile('BridgeAdapter'),
    );

    const tonBridgeContract = client.open(tonBridge);
    await tonBridgeContract.sendDeploy(walletContract.sender(key.secretKey), { value: toNano('0.5') });
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy tonBridgeContract at address: ', tonBridgeContract.address);

    // This one we consider it as orai token
    const jettonMinterSrcCosmos = client.open(
        JettonMinter.createFromConfig(
            {
                adminAddress: tonBridge.address,
                content: beginCell()
                    .storeBuffer(Buffer.from('ORAI Token'))
                    .storeBuffer(Buffer.from('ORAI'))
                    .storeBuffer(Buffer.from('ORAI token from Oraichain'))
                    .endCell(),
                jettonWalletCode: await compile('JettonWallet'),
            },
            await compile('JettonMinter'),
        ),
    );
    await jettonMinterSrcCosmos.sendDeploy(walletContract.sender(key.secretKey), { value: toNano('3') });
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy jettonMinterSrcCosmos at address: ', jettonMinterSrcCosmos.address);

    await whitelistContract.sendSetDenom(
        walletContract.sender(key.secretKey),
        {
            denom: jettonMinterSrcCosmos.address,
            isRootFromTon: false,
            permission: true,
        },
        {
            value: toNano('1'),
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
