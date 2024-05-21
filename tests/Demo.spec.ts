import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { Demo } from '../wrappers/Demo';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Demo', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Demo');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let demo: SandboxContract<Demo>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        demo = blockchain.openContract(
            Demo.createFromConfig(
                {
                    amount: 1000,
                    receiver: 'orai1knzg7jdc49ghnc2pkqg6vks8ccsk6efzfgv6gv',
                    tokenDenom: 'orai',
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await demo.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: demo.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and counter are ready to use
    });

    it('should return data', async () => {
        const amount = await demo.getAmount();
        console.log("amount: ", amount)
    });
});
