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
    verify_packet_commitment: crc32('op::verify_packet_commitment'),
    verify_untrusted_validators: crc32('op::verify_untrusted_validators'),
    verify_on_trusted_sigs: crc32('op:verify_on_trusted_sigs'),
    update_light_client_state: crc32('op:update_light_client_state'),
    timeout_send_packet: crc32('op:timeout_send_packet'),
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
