import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as voteFixtures from '../fixtures/vote.json';

describe('CanonicalVote', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let CanonicalVote: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        CanonicalVote = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await CanonicalVote.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: CanonicalVote.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        for (const fixture of Object.values(voteFixtures)) {
            if (fixture.value !== undefined && fixture.encoding !== undefined) {
                expect(
                    (
                        await CanonicalVote.getCanonicalVoteEncode({
                            ...fixture.value,
                            chain_id: 'Oraichain',
                        })
                    ).toString('hex'),
                ).toBe(fixture.encoding);
            }
        }
    });
});
