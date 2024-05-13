import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as data from './data.json';

describe('VerifyCommitSigs', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let VerifyCommitSigs: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        VerifyCommitSigs = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await VerifyCommitSigs.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: VerifyCommitSigs.address,
            deploy: true,
            success: true,
        });
    });

    it('test verify', async () => {
        expect( await VerifyCommitSigs.getVerifyCommitSigs(
            data?.header as any,
            data?.commit as any,
            data?.validators as any,
        )).toBe(-1);
    });
});
