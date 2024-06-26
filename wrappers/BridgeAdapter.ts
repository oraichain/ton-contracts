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
import { getAuthInfoInput, txBodyWasmToRef } from './utils';
import { TxWasm } from './@types';
import { crc32 } from '../crc32';
import { ValueOps } from './@types';

export type BridgeAdapterConfig = {
    bridge_wasm_smart_contract: string;
    light_client: Address;
    whitelist_denom: Address;
    jetton_wallet_code: Cell;
};

export function jsonToSliceRef(value: Object): Cell {
    switch (typeof value) {
        case 'undefined':
        case 'function':
        case 'symbol':
            return beginCell().endCell();
        case 'string':
        case 'number':
        case 'boolean':
            return beginCell().storeBuffer(Buffer.from(value.toString())).endCell();
        case 'object': {
            let cell = beginCell().endCell();
            const reverseEntries = Object.entries(value).reverse();
            for (const [key, value] of reverseEntries) {
                cell = beginCell()
                    .storeRef(cell)
                    .storeRef(beginCell().storeBuffer(Buffer.from(key)).endCell())
                    .storeRef(jsonToSliceRef(value))
                    .endCell();
            }
            return cell;
        }
        default:
            throw new Error('Invalid JSON');
    }
}

export function sliceRefToJson(cell: Cell): Object {
    let innerCell = cell.beginParse();
    if (innerCell.remainingRefs !== 3) {
        return innerCell.loadStringTail();
    }
    let json: { [key: string]: Object } = {};

    while (innerCell.remainingRefs) {
        const nextProps = innerCell.loadRef();
        const key = innerCell.loadRef();
        const value = innerCell.loadRef();
        // return value;
        json[key.asSlice().loadStringTail()] = sliceRefToJson(value);
        innerCell = nextProps.beginParse();
    }

    return json;
}

export function bridgeAdapterConfigToCell(config: BridgeAdapterConfig): Cell {
    return beginCell()
        .storeAddress(config.light_client)
        .storeAddress(config.whitelist_denom)
        .storeRef(beginCell().storeBuffer(Buffer.from(config.bridge_wasm_smart_contract)).endCell())
        .storeRef(config.jetton_wallet_code)
        .storeRef(beginCell().storeDict(Dictionary.empty()).endCell()) // empty dict
        .endCell();
}

export const BridgeAdapterOpcodes = {
    sendTx: crc32('op::send_tx'),
    confirmTx: crc32('op::confirm_tx'),
    callbackDenom: crc32('op::callback_denom'),
};

export const Src = {
    COSMOS: crc32('src::cosmos'),
    TON: crc32('src::ton'),
};

export interface SendTxInterface {
    height: bigint;
    tx: TxWasm;
    proofs: Cell | undefined;
    positions: Cell;
    data: Cell;
}

export class BridgeAdapter implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static buildBridgeAdapterSendTxBody(sendTxData: SendTxInterface, queryId: number = 0) {
        const { height, tx, proofs, positions, data } = sendTxData;
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

        return beginCell()
            .storeUint(BridgeAdapterOpcodes.sendTx, 32)
            .storeUint(queryId, 64)
            .storeUint(height, 64)
            .storeRef(txRaw)
            .storeRef(proofs ?? beginCell().endCell())
            .storeRef(positions)
            .storeRef(data)
            .endCell();
    }

    static createFromAddress(address: Address) {
        return new BridgeAdapter(address);
    }

    static createFromConfig(config: BridgeAdapterConfig, code: Cell, workchain = 0) {
        const data = bridgeAdapterConfigToCell(config);
        const init = { code, data };
        return new BridgeAdapter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, ops: ValueOps) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell().endCell(),
        });
    }

    async sendTx(provider: ContractProvider, via: Sender, data: SendTxInterface, ops: ValueOps) {
        const sendTxBody = BridgeAdapter.buildBridgeAdapterSendTxBody(data, ops.queryId);

        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: sendTxBody,
        });
    }

    async getBridgeData(provider: ContractProvider) {
        const result = await provider.get('get_bridge_data', []);
        return result.stack;
    }
}
