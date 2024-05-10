import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Int64LE as libInt64LE } from 'varstruct';

const Int64LEFixtures = [
    0,
    1,
    0xffffffff - 2,
    0xffffffff - 1,
    0xffffffff,
    0xffffffff + 1,
    0xffffffff + 2,
    0xfffffffffffff,
    0x1fffffffffffff,
];

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
        for (const ele of Int64LEFixtures) {
            expect(Int64LE.get__UInt64LE__encode(ele)).resolves.toEqual(libInt64LE.encode(ele));
        }
    });
});
