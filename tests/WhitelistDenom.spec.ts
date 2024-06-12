import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Version', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('WhitelistDenom');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<WhitelistDenom>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');

        contract = blockchain.openContract(
            WhitelistDenom.createFromConfig(
                {
                    admin: deployer.address,
                },
                code,
            ),
        );

        const deployResult = await contract.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: contract.address,
            deploy: true,
            success: true,
        });
    });

    it('check initial address', async () => {
        const addr = await contract.getAdminAddress();
        expect(addr.toString()).toBe(deployer.address.toString());
    });

    it('try set admin address', async () => {
        const newAdmin = await blockchain.treasury('new admin');
        await contract.sendSetAdminAddress(deployer.getSender(), newAdmin.address, {
            value: toNano('0.1'),
        });
        const addr = await contract.getAdminAddress();
        expect(addr.toString()).toBe(newAdmin.address.toString());
    });

    it('try set denom', async () => {
        const denom = await blockchain.treasury('USDT');
        const beforeValue = await contract.getDenom(denom.address);
        expect(beforeValue).toBeNull();
        const result = await contract.sendSetDenom(deployer.getSender(), denom.address, true, {
            value: toNano('8'),
        });
        printTransactionFees(result.transactions);
        console.log((await blockchain.getContract(contract.address)).balance);
        const value = await contract.getDenom(denom.address);
        expect(value).not.toBeNull();
    });
});
