import { toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { LightClient } from '../wrappers/LightClient';

export async function run(provider: NetworkProvider) {
    const lightClient = provider.open(
        LightClient.createFromConfig(
            {
                chainId: 'Oraichain',
                dataHash: '',
                height: 0,
                nextValidatorHashSet: '',
                validatorHashSet: '',
            },
            await compile('LightClient'),
        ),
    );

    await lightClient.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(lightClient.address);
    console.log(lightClient);
}
