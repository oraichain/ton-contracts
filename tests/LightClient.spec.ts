import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient, Opcodes } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
// import blockData from './fixtures/data.json';
import blockData from './fixtures/new_data.json';
import newBlockData from './fixtures/sample.json';
import { setTimeout } from 'timers/promises';
import { createHash } from 'crypto';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';

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
        const testcase = async (blockData: any) => {
            const { header, commit, validators, txs } = blockData;
            const user = await blockchain.treasury('user');
            let result = await lightClient.sendVerifyBlockHash(
                user.getSender(),
                {
                    appHash: header.app_hash,
                    chainId: header.chain_id,
                    consensusHash: header.consensus_hash,
                    dataHash: header.data_hash,
                    evidenceHash: header.evidence_hash,
                    height: BigInt(header.height),
                    lastBlockId: header.last_block_id,
                    lastCommitHash: header.last_commit_hash,
                    lastResultsHash: header.last_results_hash,
                    validatorHash: header.validators_hash,
                    nextValidatorHash: header.next_validators_hash,
                    proposerAddress: header.proposer_address,
                    time: header.time,
                    version: header.version,
                },
                validators,
                commit,
                { value: toNano('5') },
            );

            console.log(`blockhash:`, Opcodes.verify_block_hash);
            console.log('Finished: ', {
                height: await lightClient.getHeight(),
                chainId: await lightClient.getChainId(),
                dataHash: (await lightClient.getDataHash()).toString('hex'),
                validatorHash: (await lightClient.getValidatorHash()).toString('hex'),
            });

            const leaves = txs.map((tx: string) => createHash('sha256').update(Buffer.from(tx, 'base64')).digest());
            const choosenIndex = 0;
            const decodedTx = decodeTxRaw(Buffer.from(txs[choosenIndex], 'base64'));
            const registry = new Registry(defaultRegistryTypes);
            registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);
            const rawMsg = decodedTx.body.messages.map((msg) => {
                return {
                    typeUrl: msg.typeUrl,
                    value: registry.decode(msg),
                };
            });
            const decodedTxWithRawMsg: any = {
                ...decodedTx,
                body: {
                    messages: rawMsg,
                    memo: decodedTx.body.memo,
                    timeoutHeight: decodedTx.body.timeoutHeight,
                    extensionOptions: decodedTx.body.extensionOptions,
                    nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
                },
            };
            result = await lightClient.sendVerifyReceipt(
                user.getSender(),
                header.height,
                decodedTxWithRawMsg,
                leaves,
                leaves[choosenIndex],
                {
                    value: toNano('1'),
                },
            );
            expect(result.transactions[1]).toHaveTransaction({
                success: true,
                op: Opcodes.verify_receipt,
            });
        };

        // await testcase(blockData);
        await testcase(newBlockData);
    });
});
