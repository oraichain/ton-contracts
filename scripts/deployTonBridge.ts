import { compile } from '@ton/blueprint';
import { LightClient } from '../wrappers/LightClient';
import { createTonWallet, waitSeqno } from './utils';
import { BridgeAdapter } from '../wrappers/BridgeAdapter';
import { toNano } from '@ton/core';

async function deploy() {
    // =================== Setup TON Wallet ===================
    var { client, walletContract, key } = await createTonWallet();
    // =================== End Setup TON Wallet ===================

    // =================== Deploy Contract ===================
    const lightClient = client.open(
        LightClient.createFromConfig(
            {
                chainId: 'Oraichain',
                dataHash: '',
                height: 10000,
                nextValidatorHashSet: '',
                validatorHashSet: '',
            },
            await compile('LightClient'),
        ),
    );
    console.log({ lightClient: lightClient.address.toString() });
    const tonBridge = BridgeAdapter.createFromConfig(
        {
            light_client: lightClient.address,
            jetton_wallet_code: await compile('JettonWallet'),
            bridge_wasm_smart_contract: 'orai16ka659l0t90dua6du8yq02ytgdh222ga3qcxaqxp86r78p6tl0usze57ve',
        },
        await compile('BridgeAdapter'),
    );
    const tonBridgeContract = client.open(tonBridge);
    // await tonBridgeContract.sendDeploy(walletContract.sender(key.secretKey), toNano('0.5'));
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log(tonBridge.address.toString());
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
