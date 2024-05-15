import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Tip } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import fixtures from './fixtures/tip.json';

describe('Tip', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let tip: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        tip = blockchain.openContract(
            LightClient.createFromConfig(
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

    it('test encode length', async () => {
        for (const fixture of fixtures) {
            if (fixture?.amount !== undefined) {
                expect(await tip.get__Tip__encodeLength(fixture as any)).toBe(Tip.encode(fixture as any).len);
            }
        }
    });

    it('test encode', async () => {
        for (const fixture of fixtures) {
            if (fixture?.amount !== undefined) {
                expect((await tip.get__Tip__encode(fixture as any)).toString('hex')).toBe(
                    Buffer.from(Tip.encode(fixture as any).finish()).toString('hex'),
                );
            }
        }
    });
});
