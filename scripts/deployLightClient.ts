import { toNano } from '@ton/core';
import { TestClient } from '../wrappers/TestClient';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const lightClient = provider.open(
        TestClient.createFromConfig(
            {
                id: Math.floor(Math.random() * 10000),
                counter: 0,
            },
            await compile('TestClient'),
        ),
    );

    await lightClient.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(lightClient.address);

    console.log('ID', await lightClient.getID());
}
