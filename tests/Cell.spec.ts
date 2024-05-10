import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Cell', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let version: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        version = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await version.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: version.address,
            deploy: true,
            success: true,
        });
    });

    it('test append cell by offset', async () => {
        let srcCell = beginCell().storeUint(3, 8).storeUint(4, 8).storeUint(5, 8).endCell();
        let dstCell = beginCell().storeUint(6, 8).storeUint(7, 8).storeUint(8, 8).endCell();
        expect((await version.get__cell__writeCellByOffset(srcCell, dstCell, 2)).toString('hex')).toBe(
            Buffer.from([3, 4, 6, 7, 8, 5]).toString('hex'),
        );
        expect((await version.get__cell__writeCellByOffset(srcCell, dstCell, 0)).toString('hex')).toBe(
            Buffer.from([6, 7, 8, 3, 4, 5]).toString('hex'),
        );
        expect((await version.get__cell__writeCellByOffset(srcCell, dstCell, 3)).toString('hex')).toBe(
            Buffer.from([3, 4, 5, 6, 7, 8]).toString('hex'),
        );
        // expect(await version.get__version__encodingLength(11, 5)).toBe(4);
    });
});
