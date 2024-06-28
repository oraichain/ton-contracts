import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { LightClientMaster, LightClientMasterOpcodes } from '../wrappers/LightClientMaster';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { createUpdateClientData, deserializeCommit, deserializeHeader, deserializeValidator } from '../wrappers/utils';

describe('LightClientMaster', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('LightClientMaster');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let lightClientMaster: SandboxContract<LightClientMaster>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            ...blockchain.verbosity,
            // vmLogs: 'vm_logs_gas',
        };
        lightClientMaster = blockchain.openContract(
            LightClientMaster.createFromConfig(
                {
                    chainId: 'Oraichain',
                    lightClientCode: await compile('LightClient'),
                    trustedHeight: 0,
                    trustingPeriod: 14 * 86400,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await lightClientMaster.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClientMaster.address,
            deploy: true,
            success: true,
        });
    });

    it('test light client master verify block hash', async () => {
        const testcase = async (blockNumber: any) => {
            const { header, lastCommit, validators } = await createUpdateClientData('https://rpc.orai.io', blockNumber);
            const user = await blockchain.treasury('user');
            let result = await lightClientMaster.sendVerifyBlockHash(
                user.getSender(),
                {
                    header: deserializeHeader(header),
                    validators: validators.map(deserializeValidator),
                    commit: deserializeCommit(lastCommit),
                },
                {
                    value: toNano('10'),
                },
            );

            printTransactionFees(result.transactions);

            // expect(result.transactions).toHaveTransaction({
            //     op: LightClientMasterOpcodes.verify_block_hash,
            //     success: true,
            // });

            // expect(result.transactions).toHaveTransaction({
            //     op: LightClientMasterOpcodes.verify_sigs,
            //     success: true,
            // });

            console.log(`blockhash:`, LightClientMasterOpcodes.verify_block_hash);
            // console.log('Finished: ', {
            //     height: await lightClientMaster.getTrustedHeight(),
            // });
        };
        await testcase(24552927);
        await testcase(24555600);
    });
});
