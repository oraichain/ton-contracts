import { compile } from '@ton/blueprint';
import { LightClient } from '../wrappers/LightClient';
import { createTonWallet, waitSeqno } from './utils';
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
    await lightClient.sendDeploy(walletContract.sender(key.secretKey), toNano('1'));
    await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy light client at address: ', lightClient.address);
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
