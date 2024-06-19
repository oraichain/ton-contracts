import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { ModeInfo, ModeInfo_Single } from 'cosmjs-types/cosmos/tx/v1beta1/tx';

describe('Mode Info', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let modeInfo: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        modeInfo = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await modeInfo.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: modeInfo.address,
            deploy: true,
            success: true,
        });
    });

    it('test encode', async () => {
        expect(
            (
                await modeInfo.getModeInfoEncode({
                    mode: 1,
                })
            ).toString('hex'),
        ).toBe(
            Buffer.from(
                ModeInfo.encode({
                    single: { mode: 1 },
                    multi: undefined,
                }).finish(),
            ).toString('hex'),
        );

        expect(
            (
                await modeInfo.getModeInfoEncode({
                    mode: 0,
                })
            ).toString('hex'),
        ).toBe(
            Buffer.from(
                ModeInfo.encode({
                    single: { mode: 0 },
                    multi: undefined,
                }).finish(),
            ).toString('hex'),
        );
    });

    it('test encode length', async () => {
        expect(
            await modeInfo.getModeInfoEncodeLength({
                mode: 1,
            }),
        ).toBe(
            ModeInfo.encode({
                single: { mode: 1 },
                multi: undefined,
            }).len,
        );

        expect(
            await modeInfo.getModeInfoEncodeLength({
                mode: 0,
            }),
        ).toBe(
            ModeInfo.encode({
                single: { mode: 0 },
                multi: undefined,
            }).len,
        );
    });

    // it('test encode length', async () => {
    //     expect((await version.getVersionEncode({ block: 11, app: 15 })).toString('hex')).toBe(
    //         Buffer.from([8, 11, 16, 15]).toString('hex'),
    //     );
    //     expect((await version.getVersionEncode({ block: 3 })).toString('hex')).toBe(
    //         Buffer.from([8, 3]).toString('hex'),
    //     );
    // });
});
