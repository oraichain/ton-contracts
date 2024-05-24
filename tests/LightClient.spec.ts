import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient, Opcodes } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import blockData from './fixtures/data.json';
import { setTimeout } from 'timers/promises';

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

    xit('test light client verify block hash', async () => {
        const { header, block_id } = blockData;
        const user = await blockchain.treasury('user');
        const result = await lightClient.sendVerifyBlockHash(
            user.getSender(),
            {
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
                blockId: block_id,
            },
            { value: toNano('0.5') },
        );
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_block_hash,
        });
        expect(await lightClient.getHeight()).toBe(parseInt(header.height));
        expect(await lightClient.getChainId()).toBe(header.chain_id);
        expect((await lightClient.getDataHash()).toString('hex')).toBe(header.data_hash.toLowerCase());
        expect((await lightClient.getValidatorHash()).toString('hex')).toBe(header.validators_hash.toLowerCase());
    });

    xit('test light client store untrusted validators', async () => {
        const { validators } = blockData;
        const user = await blockchain.treasury('user');
        const result = await lightClient.sendStoreUntrustedValidators(user.getSender(), validators, {
            value: toNano('0.5'),
        });
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.store_untrusted_validators,
        });
    });

    it('test light client verify receipt', async () => {
        const { header, commit, validators, block_id } = blockData;
        const user = await blockchain.treasury('user');
        let result = await lightClient.sendVerifyBlockHash(
            user.getSender(),
            {
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
                blockId: block_id,
            },
            { value: toNano('0.5') },
        );
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_block_hash,
        });
        result = await lightClient.sendStoreUntrustedValidators(user.getSender(), validators, {
            value: toNano('0.5'),
        });
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.store_untrusted_validators,
        });
        result = await lightClient.sendVerifyUntrustedValidators(user.getSender(), {
            value: toNano('1'),
        });
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_untrusted_validators,
        });

        result = await lightClient.sendVerifySigs(user.getSender(), commit, {
            value: toNano('0.5'),
        });
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_sigs,
        });

        result = await lightClient.sendVerifySigs(user.getSender(), commit, {
            value: toNano('0.5'),
        });
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_sigs,
        });
    });
});
