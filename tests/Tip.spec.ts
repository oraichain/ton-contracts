import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Tip } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import fixtures from './fixtures/tip.json';

describe('Tip', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let tip: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        tip = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await tip.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: tip.address,
            deploy: true,
            success: true,
        });
    });

    xit('test encode length', async () => {
        for (const fixture of fixtures) {
            if (fixture?.amount !== undefined) {
                expect(await tip.getTipEncodeLength(fixture as any)).toBe(Tip.encode(fixture as any).len);
            }
        }
    });

    it('test encode', async () => {
        for (const fixture of fixtures) {
            if (fixture?.amount !== undefined) {
                expect((await tip.getTipEncode(fixture as any)).toString('hex')).toBe(
                    Buffer.from(Tip.encode(fixture as any).finish()).toString('hex'),
                );
            }
        }
    });
});
