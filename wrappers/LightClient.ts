import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';
import { getAuthInfoInput, getMerkleProofs, txBodyWasmToRef, TxWasm } from './TestClient';
import { crc32 } from '../crc32';
import { getBlockHashCell, getCommitCell, getValidatorsCell } from './utils';
import { Commit, Header, Validator } from '@cosmjs/tendermint-rpc';
import { ValueOps } from './@types';

export type LightClientConfig = {
    height: number;
    chainId: string;
    dataHash: string;
    validatorHashSet: string;
    nextValidatorHashSet: string;
};

export interface SendVerifyBlockHashInterface {
    header: Header;
    validators: Validator[];
    commit: Commit;
}

export function lightClientConfigToCell(config: LightClientConfig): Cell {
    return beginCell()
        .storeUint(0, 1)
        .storeUint(0, 8)
        .storeRef(
            beginCell()
                .storeUint(config.height, 32)
                .storeRef(beginCell().storeBuffer(Buffer.from(config.chainId)).endCell())
                .storeRef(beginCell().storeBuffer(Buffer.from(config.dataHash)).endCell())
                .storeRef(beginCell().storeBuffer(Buffer.from(config.validatorHashSet)).endCell())
                .endCell(),
        )
        .storeRef(
            beginCell()
                .storeRef(
                    beginCell()
                        .storeUint(0, 256)
                        .storeRef(beginCell().endCell())
                        .storeRef(beginCell().storeDict(Dictionary.empty()).endCell())
                        .endCell(),
                )
                .storeRef(
                    beginCell()
                        .storeUint(0, 256)
                        .storeRef(beginCell().endCell())
                        .storeRef(beginCell().storeDict(Dictionary.empty()).endCell())
                        .endCell(),
                )
                .endCell(),
        )
        .endCell();
}

export const LightClientOpcodes = {
    verify_block_hash: crc32('op::verify_block_hash'),
    verify_sigs: crc32('op::verify_sigs'),
    verify_receipt: crc32('op::verify_receipt'),
    verify_untrusted_validators: crc32('op::verify_untrusted_validators'),
};

export class LightClient implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new LightClient(address);
    }

    static createFromConfig(config: LightClientConfig, code: Cell, workchain = 0) {
        const data = lightClientConfigToCell(config);
        const init = { code, data };
        return new LightClient(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendVerifySigs(provider: ContractProvider, via: Sender, commit: Commit, opts?: any) {
        const commitCell = getCommitCell(commit);
        const cell = beginCell().storeRef(commitCell).endCell();
        await provider.internal(via, {
            value: opts?.value || 0,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(LightClientOpcodes.verify_sigs, 32)
                .storeUint(opts?.queryID || 0, 64)
                .storeRef(cell)
                .endCell(),
        });
    }

    async sendVerifyBlockHash(
        provider: ContractProvider,
        via: Sender,
        data: SendVerifyBlockHashInterface,
        opts: ValueOps,
    ) {
        const dataCell = beginCell()
            .storeRef(getBlockHashCell(data.header))
            .storeRef(getValidatorsCell(data.validators)!)
            .storeRef(getCommitCell(data.commit))
            .endCell();

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(LightClientOpcodes.verify_block_hash, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeRef(dataCell)
                .endCell(),
        });
    }

    async sendVerifyReceipt(
        provider: ContractProvider,
        via: Sender,
        data: {
            height: string;
            tx: TxWasm;
            leaves: Buffer[];
            leafData: Buffer;
        },
        opts: ValueOps,
    ) {
        const { height, tx, leaves, leafData } = data;
        const { signInfos, fee, tip } = getAuthInfoInput(tx.authInfo);
        const authInfo = beginCell()
            .storeRef(signInfos || beginCell().endCell())
            .storeRef(fee)
            .storeRef(tip)
            .endCell();

        const txBody = txBodyWasmToRef(tx.body);
        let signatureCell: Cell | undefined;

        for (let i = tx.signatures.length - 1; i >= 0; i--) {
            let signature = tx.signatures[i];
            let cell = beginCell()
                .storeRef(beginCell().storeBuffer(Buffer.from(signature)).endCell())
                .endCell();
            if (!signatureCell) {
                signatureCell = beginCell().storeRef(beginCell().endCell()).storeRef(cell).endCell();
            } else {
                signatureCell = beginCell().storeRef(signatureCell).storeRef(cell).endCell();
            }
        }
        const txRaw = beginCell()
            .storeRef(authInfo)
            .storeRef(txBody)
            .storeRef(signatureCell || beginCell().endCell())
            .endCell();

        const { branch: proofs, positions } = getMerkleProofs(leaves, leafData);

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(LightClientOpcodes.verify_receipt, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeRef(
                    beginCell()
                        .storeUint(BigInt(height), 64)
                        .storeRef(txRaw)
                        .storeRef(proofs || beginCell().endCell())
                        .storeRef(positions)
                        .endCell(),
                )
                .endCell(),
        });
    }

    async sendVerifyUntrustedValidators(provider: ContractProvider, via: Sender, opts?: any) {
        await provider.internal(via, {
            value: opts?.value || 0,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(LightClientOpcodes.verify_untrusted_validators, 32)
                .storeUint(opts?.queryID || 0, 64)
                .storeRef(beginCell().endCell())
                .endCell(),
        });
    }

    async getHeight(provider: ContractProvider) {
        const result = await provider.get('get_height', []);
        return result.stack.readNumber();
    }

    async getChainId(provider: ContractProvider) {
        const result = await provider.get('get_chain_id', []);
        return result.stack.readBuffer().toString('utf-8');
    }

    async getDataHash(provider: ContractProvider) {
        const result = await provider.get('get_data_hash', []);
        return result.stack.readBuffer();
    }

    async getValidatorHash(provider: ContractProvider) {
        const result = await provider.get('get_validator_hash_set', []);
        return result.stack.readBuffer();
    }
}
