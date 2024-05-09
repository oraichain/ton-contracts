import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as versionFixtures from './fixtures/version.json';

describe('Block Id', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let version: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        version = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await version.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: version.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        for (const fixture of Object.values(versionFixtures)) {
            if (fixture?.value?.block !== undefined && fixture?.value?.app !== undefined) {
                expect(
                    (await version.get__version__encode(fixture.value.block, fixture.value.app)).toString('hex'),
                ).toBe(fixture.encoding);
            }
        }
    });

    it('test encode', async () => {
        expect((await version.get__version__encode(11, 15)).toString('hex')).toBe(
            Buffer.from([8, 11, 16, 15]).toString('hex'),
        );
        expect((await version.get__version__encode(3)).toString('hex')).toBe(Buffer.from([8, 3]).toString('hex'));
    });
});
