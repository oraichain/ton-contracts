import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { getTimeComponent, LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as timeFixtures from './fixtures/time.json';

describe('Int64LE', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let Int64LE: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        Int64LE = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await Int64LE.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: Int64LE.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        console.log(await Int64LE.get__Int64LE__encode(112351251n));
    });
});
