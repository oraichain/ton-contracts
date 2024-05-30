import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Helper', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let helper: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        helper = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await helper.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: helper.address,
            deploy: true,
            success: true,
        });
    });

    it('Test converter', async () => {
        const hexString = '80002255';
        const data = await helper.getHexToStr(hexString);
        expect(data).toBe(Buffer.from(hexString).toString('hex'));
    });
});
