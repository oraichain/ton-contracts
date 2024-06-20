import { compile } from '@ton/blueprint';
import { LightClient } from '../wrappers/LightClient';
import { createTonWallet, waitSeqno } from './utils';
import { toNano } from '@ton/core';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { BridgeAdapter } from '../wrappers/BridgeAdapter';

async function deploy() {
    // =================== Setup TON Wallet ===================
    const { client, walletContract, key } = await createTonWallet();
    // =================== End Setup TON Wallet ===================

    // =================== Deploy Contract ===================
    const lightClient = client.open(
        LightClient.createFromConfig(
            {
                chainId: 'Oraichain',
                dataHash: '',
                height: 1103,
                nextValidatorHashSet: '',
                validatorHashSet: '',
            },
            await compile('LightClient'),
        ),
    );
    await lightClient.sendDeploy(walletContract.sender(key.secretKey), toNano('0.5'));
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy light client at address: ', lightClient.address);

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
    const tonBridge = BridgeAdapter.createFromConfig(
        {
            light_client: lightClient.address,
            jetton_wallet_code: await compile('JettonWallet'),
            bridge_wasm_smart_contract: 'orai16ka659l0t90dua6du8yq02ytgdh222ga3qcxaqxp86r78p6tl0usze57ve',
            whitelist_denom: whitelistContract.address,
        },
        await compile('BridgeAdapter'),
    );

    const tonBridgeContract = client.open(tonBridge);
    await tonBridgeContract.sendDeploy(walletContract.sender(key.secretKey), toNano('0.5'));
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy tonBridgeContract at address: ', whitelistContract.address);
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
