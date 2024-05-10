import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { getTimeComponent, LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as pubKeyFixtures from './fixtures/pubkey.json';

describe('Pubkey', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pk: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pk = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await pk.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pk.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        for (const fixture of Object.values(pubKeyFixtures)) {
            if (fixture.value !== undefined && fixture.encoding !== undefined) {
                const rawEncode = await pk.get__Pubkey__encode(fixture.value.value);
                expect(rawEncode.toString('hex')).toBe(fixture.encoding);
            }
        }
    });
});
