import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as versionFixtures from '../fixtures/version.json';

describe('Version', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let version: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        version = blockchain.openContract(
            TestClient.createFromConfig(
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
                expect((await version.getVersionEncode(fixture.value)).toString('hex')).toBe(fixture.encoding);
            }
        }
    });

    it('test encode length', async () => {
        expect((await version.getVersionEncode({ block: 11, app: 15 })).toString('hex')).toBe(
            Buffer.from([8, 11, 16, 15]).toString('hex'),
        );
        expect((await version.getVersionEncode({ block: 3 })).toString('hex')).toBe(
            Buffer.from([8, 3]).toString('hex'),
        );
    });
});
