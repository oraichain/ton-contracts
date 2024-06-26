import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as blockIdFixtures from '../fixtures/block_id.json';

describe('Block Id', () => {
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

    it('test encode length', async () => {
        expect(
            await version.getBlockIdEncodingLength({
                hash: '3031323334353637383930313233343536373839303132333435363738393031',
                parts: {
                    total: 1,
                    hash: '3031323334353637383930313233343536373839303132333435363738393031',
                },
            }),
        ).toBe(72);
    });

    it('test encode', async () => {
        for (const fixture of Object.values(blockIdFixtures)) {
            if (fixture?.encoding !== undefined && fixture?.value !== undefined) {
                expect((await version.getBlockIdEncode(fixture.value)).toString('hex')).toBe(fixture.encoding);
            }
        }
    });

    it('test canonical encode', async () => {
        for (const fixture of Object.values(blockIdFixtures)) {
            if (fixture?.encoding !== undefined && fixture?.value !== undefined) {
                console.log((await version.getBlockIdEncode(fixture.value)).toString('hex'));
            }
        }
    });
});
