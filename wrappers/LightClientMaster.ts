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

export type LightClientMasterConfig = {
    trustingPeriod: number;
    trustedHeight: number;
    chainId: string;
    lightClientCode: Cell;
    specs: Cell;
};

export interface SendVerifyBlockHashInterface {
    header: Header;
    validators: Validator[];
    commit: Commit;
}

export function lightClientMasterConfigToCell(config: LightClientMasterConfig): Cell {
    return beginCell()
        .storeUint(config.trustingPeriod, 32)
        .storeUint(config.trustedHeight, 64)
        .storeBuffer(Buffer.from(config.chainId))
        .storeRef(config.lightClientCode)
        .storeRef(config.specs)
        .endCell();
}

export const LightClientMasterOpcodes = {
    verify_block_hash: crc32('op::verify_block_hash'),
    verify_untrusted_validators: crc32('op::verify_untrusted_validators'),
    verify_on_untrusted_sigs: crc32('op::verify_on_untrusted_sigs'),
    create_new_light_client: crc32('op::create_new_light_client'),
    finalize_verify_light_client: crc32('op::finalize_verify_light_client'),
};

export class LightClientMaster implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new LightClientMaster(address);
    }

    static createFromConfig(config: LightClientMasterConfig, code: Cell, workchain = 0) {
        const data = lightClientMasterConfigToCell(config);
        const init = { code, data };
        return new LightClientMaster(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
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
                .storeUint(LightClientMasterOpcodes.verify_block_hash, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeRef(dataCell)
                .endCell(),
        });
    }

    async getTrustedHeight(provider: ContractProvider) {
        const result = await provider.get('get_trusted_height', []);
        return result.stack.readNumber();
    }

    async getChainId(provider: ContractProvider) {
        const result = await provider.get('get_chain_id', []);
        return result.stack.readBuffer().toString('utf-8');
    }
}
