import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient, Opcodes } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { result as blockData } from './fixtures/block.json';

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
            blockchainLogs: true,
            debugLogs: true,
            print: true,
            vmLogs: 'vm_logs_full',
        };

        lightClient = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    chainId: 'Oraichain',
                    height: 1,
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

    it('test light client verify receipt', async () => {
        const { header, data, last_commit } = blockData.block;
        const user = await blockchain.treasury('user');
        expect(
            await lightClient.getVerifyReceipt({
                blockProof: {
                    header: {
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
                    blockId: blockData.block_id,
                },
            }),
        ).toBe(-1);
        const result = await lightClient.sendVerifyReceipt(user.getSender(), {
            blockProof: {
                header: {
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
                blockId: blockData.block_id,
            },
        });
        expect(result.transactions).toHaveTransaction({
            success: true,
            op: Opcodes.verify_receipt,
        });
        // result.transactions.forEach((item) => {
        //     console.log(item.events);
        // });
    });
});
