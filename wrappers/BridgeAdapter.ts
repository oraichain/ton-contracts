import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
} from '@ton/core';
import {
    TxBodyWasm,
    txBodyWasmToRef,
} from './TestClient';
import { crc32 } from '../crc32';
import { buffer } from 'stream/consumers';

export type BridgeAdapterConfig = {
   bridge_wasm_smart_contract:string;
   light_client: Address;
};

export function jsonToSliceRef(value:Object, isLast: boolean):Cell{
    if (typeof value === 'string') {
        let returnValue = isLast ? '"' + value + '"}':'"' + value + '"';
        return beginCell().storeBuffer(Buffer.from(returnValue)).endCell();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        let returnValue =  isLast ? String(value)+'}' : String(value);
        return beginCell().storeBuffer(Buffer.from(returnValue)).endCell();
    }

    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
        // JSON.stringify ignores undefined, functions, and symbols when they are values in an object or array.
        return beginCell().endCell();
    }

    // TODO: Handle array
    // if (Array.isArray(value)) {
    //     const arrValues = value.map((item) => {
    //         const strValue = jsonToSliceRef(item);
    //         return strValue !== undefined ? strValue : 'null';
    //     });
    //     return '[' + arrValues.join(',') + ']';
    // }

    // Handle objects
    if (typeof value === 'object') {
        let cell:Cell | undefined;
        const reverseEntries = Object.entries(value).reverse();
        const len = reverseEntries.length;
        for (let [i, [key, value]] of reverseEntries.entries()) {
            let keyValue;
            if (value) {
                 keyValue = jsonToSliceRef(value, i === len - 1);
            }
            let finalKey = i === len - 1 ? '{"' + key + '":' : '"' + key + '":'
            if(!cell){
                cell = beginCell()
                        .storeRef(beginCell().endCell())
                        .storeRef(beginCell().storeBuffer(Buffer.from(finalKey)).endCell())
                        .storeRef(keyValue ?? beginCell().endCell())
                        .endCell();
            } else {
                cell = beginCell()
                            .storeRef(cell)
                            .storeRef(beginCell().storeBuffer(Buffer.from(finalKey)).endCell())
                            .storeRef(keyValue ?? beginCell().endCell())
                        .endCell();
            }
        }
        return cell ?? beginCell().endCell();
    }
    throw new Error('Invalid JSON');
}

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