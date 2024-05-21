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
    const receiverAddr = 'orai1knzg7jdc49ghnc2pkqg6vks8ccsk6efzfgv6gv';
    const tokenDenom = 'orai';
    const originalAmount = 1000;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        demo = blockchain.openContract(
            Demo.createFromConfig(
                {
                    amount: originalAmount,
                    receiver: receiverAddr,
                    tokenDenom,
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
        const receiver = await demo.getReceiver();
        const denom = await demo.getTokenDenom();
        expect(amount).toEqual(originalAmount);
        expect(receiver).toEqual(receiverAddr);
        expect(denom).toEqual(tokenDenom);
    });

    it('should update data', async () => {
        const newAmount = 10;
        const newReceiver = 'foobar';
        const newTokenDenom = 'usdt';
        const updateResult = await demo.sendUpdateDemoData(deployer.getSender(), {
            sent_funds: '0.01', // must be greater than 0?
            amount: newAmount,
            receiver: newReceiver,
            tokenDenom: newTokenDenom,
        });
        expect(updateResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: demo.address,
            success: true,
        });
        const amount = await demo.getAmount();
        const receiver = await demo.getReceiver();
        const denom = await demo.getTokenDenom();
        expect(amount).toEqual(newAmount);
        expect(receiver).toEqual(newReceiver);
        expect(denom).toEqual(newTokenDenom);
    });
});
