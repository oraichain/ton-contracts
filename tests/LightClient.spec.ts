import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient, LightClientOpcodes } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { createUpdateClientData, deserializeCommit, deserializeHeader, deserializeValidator } from '../wrappers/utils';

describe('LightClient', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let lightClient: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            ...blockchain.verbosity,
            // vmLogs: 'vm_logs_gas',
        };
        lightClient = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    chainId: 'Oraichain',
                    height: 1,
                    validatorHashSet: '',
                    dataHash: '',
                    nextValidatorHashSet: '',
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await lightClient.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClient.address,
            deploy: true,
            success: true,
        });
    });

    it('test light client verify block hash', async () => {
        console.log('Usdt Jetton Wallet', (await compile('UsdtJettonWallet')).toBoc().toString('hex'));
        const testcase = async (blockNumber: any) => {
            const { header, lastCommit, validators } = await createUpdateClientData('https://rpc.orai.io', blockNumber);
            const user = await blockchain.treasury('user');
            let result = await lightClient.sendVerifyBlockHash(
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

            expect(result.transactions).toHaveTransaction({
                op: LightClientOpcodes.verify_block_hash,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({
                op: LightClientOpcodes.verify_sigs,
                success: true,
            });

            console.log(`blockhash:`, LightClientOpcodes.verify_block_hash);
            console.log('Finished: ', {
                height: await lightClient.getHeight(),
                chainId: await lightClient.getChainId(),
                dataHash: (await lightClient.getDataHash()).toString('hex'),
                validatorHash: (await lightClient.getValidatorHash()).toString('hex'),
            });
        };
        await testcase(24552927);
        await testcase(24555600);
    });
});
