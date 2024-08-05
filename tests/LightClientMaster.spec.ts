import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { LightClientMaster, LightClientMasterOpcodes } from '../wrappers/LightClientMaster';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import {
    createUpdateClientData,
    deserializeCommit,
    deserializeHeader,
    deserializeValidator,
    getSpecCell,
} from '../wrappers/utils';
import { HashOp, LengthOp, ProofSpec } from 'cosmjs-types/cosmos/ics23/v1/proofs';
import { crc32 } from '../crc32';
import { iavlSpec, tendermintSpec } from '../wrappers/specs';
import { LightClient } from '../wrappers';

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
        const specs = [iavlSpec, tendermintSpec];
        let cellSpecs;
        for (let i = specs.length - 1; i >= 0; i--) {
            const innerCell = getSpecCell(specs[i] as ProofSpec);
            if (!cellSpecs) {
                cellSpecs = beginCell()
                    .storeRef(beginCell().endCell())
                    .storeSlice(innerCell.beginParse())
                    .endCell();
            } else {
                cellSpecs = beginCell()
                    .storeRef(cellSpecs)
                    .storeSlice(innerCell.beginParse())
                    .endCell();
            }
        }
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
                    specs: cellSpecs!,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await lightClientMaster.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClientMaster.address,
            deploy: true,
            success: true,
        });
    });

    // Notice: update to latest (not pruned height if the test failed)
    it('test light client master verify block hash', async () => {
        const testcase = async (blockNumber: any) => {
            const { header, lastCommit, validators } = await createUpdateClientData(
                'https://rpc.orai.io',
                blockNumber,
            );
            const user = await blockchain.treasury('user');
            let result = await lightClientMaster.sendVerifyBlockHash(
                user.getSender(),
                {
                    header: deserializeHeader(header),
                    validators: validators.map(deserializeValidator),
                    commit: deserializeCommit(lastCommit),
                },
                {
                    value: toNano('3.5'),
                },
            );

            printTransactionFees(result.transactions);

            expect(result.transactions).toHaveTransaction({
                op: LightClientMasterOpcodes.verify_block_hash,
                success: true,
            });

            console.log(`blockhash:`, LightClientMasterOpcodes.verify_block_hash);
        };
        await testcase(28859003);
        expect(await lightClientMaster.getTrustedHeight()).toBe(28859003);
        await testcase(28869004);
        let address = await lightClientMaster.getLightClientAddress(28869004n);
        let lightClientContract = LightClient.createFromAddress(address);
        let lightClient = blockchain.openContract(lightClientContract);
        let timestamp = await lightClient.getCreatedAt();
        expect(Math.floor(new Date('2024-07-30T19:01:56.190013602Z').getTime() / 1000)).toBe(
            timestamp,
        );
        expect(await lightClientMaster.getTrustedHeight()).toBe(28869004);

        await testcase(28859004);
        address = await lightClientMaster.getLightClientAddress(28859004n);
        lightClientContract = LightClient.createFromAddress(address);
        lightClient = blockchain.openContract(lightClientContract);
        timestamp = await lightClient.getCreatedAt();
        expect(Math.floor(new Date('2024-07-30T16:34:21.245505389Z').getTime() / 1000)).toBe(
            timestamp,
        );
        expect(await lightClientMaster.getTrustedHeight()).toBe(28869004);
    }, 10000);
});
