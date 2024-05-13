import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as voteFixtures from './fixtures/getSignBytes.json';

describe('GetSignBytes', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let GetSignBytes: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        GetSignBytes = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await GetSignBytes.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: GetSignBytes.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        for (const fixture of Object.values(voteFixtures)) {
            if (fixture.value !== undefined && fixture.encoding !== undefined) {
             
                expect(
                          (
                        await GetSignBytes.getVoteSignBytes({
                            ...fixture?.value,
                            height: parseInt(fixture.value.height)
                          
                        })
                    ).toString('hex')
                ).toBe(fixture.encoding);
            }
        }
    });
});
