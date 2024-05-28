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
} from '@ton/core';
import {
    BlockId,
    Commit,
    getAuthInfoInput,
    getBlockSlice,
    getMerkleProofs,
    getTimeSlice,
    getVersionSlice,
    Header,
    TxBodyWasm,
    txBodyWasmToRef,
    TxWasm,
    Validators,
    Version,
} from './TestClient';
import { crc32 } from '../crc32';

export type BridgeAdapterConfig = {
   bridge_wasm_smart_contract:string;
   light_client: Address;
};

export function bridgeAdapterConfigToCell(config: BridgeAdapterConfig): Cell {
    return beginCell()
            .storeAddress(config.light_client)
            .storeRef(beginCell().storeBuffer(Buffer.from(config.bridge_wasm_smart_contract)).endCell())
            .endCell()
}

export const Opcodes = {
    sendTx: crc32("op::send_tx"),
    confirmTx: crc32("op::confirm_tx"),
};

export class BridgeAdapter implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new BridgeAdapter(address);
    }

    static createFromConfig(config: BridgeAdapterConfig, code: Cell, workchain = 0) {
        const data = bridgeAdapterConfigToCell(config);
        const init = { code, data };
        return new BridgeAdapter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendTx(provider: ContractProvider, via: Sender, txWasm: TxBodyWasm, value: bigint){
        const txBody = txBodyWasmToRef(txWasm);
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.sendTx, 32)
                .storeUint(0, 64)
                .storeRef(txBody)
                .endCell()
        })
    }

}