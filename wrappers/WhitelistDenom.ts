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
import { crc32 } from '../crc32';
import { ValueOps } from './@types';

export type WhitelistDenomConfig = {
    admin: Address;
};

export function whitelistDenomConfigToCell(config: WhitelistDenomConfig): Cell {
    return beginCell()
        .storeAddress(config.admin)
        .storeRef(beginCell().storeDict(Dictionary.empty()).endCell()) // empty dict
        .endCell();
}

export const WhitelistDenomOpcodes = {
    setAdminAddress: crc32('op::set_admin_address'),
    setDenom: crc32('op::set_denom'),
};

export interface SendSetDenomInterface {
    denom: Address;
    permission: boolean;
    isRootFromTon: boolean;
}

export interface SendSetAdminInterface {
    address: Address;
}

export class WhitelistDenom implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new WhitelistDenom(address);
    }

    static createFromConfig(config: WhitelistDenomConfig, code: Cell, workchain = 0) {
        const data = whitelistDenomConfigToCell(config);
        const init = { code, data };
        return new WhitelistDenom(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendSetAdminAddress(provider: ContractProvider, via: Sender, data: SendSetAdminInterface, opts: ValueOps) {
        let bodyCell = beginCell().storeAddress(data.address).endCell();
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(WhitelistDenomOpcodes.setAdminAddress, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeRef(bodyCell)
                .endCell(),
        });
    }

    async sendSetDenom(provider: ContractProvider, via: Sender, data: SendSetDenomInterface, opts: ValueOps) {
        let bodyCell = beginCell()
            .storeInt(data.permission ? -1 : 0, 8)
            .storeInt(data.isRootFromTon ? -1 : 0, 8)
            .storeAddress(data.denom)
            .endCell();
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(WhitelistDenomOpcodes.setDenom, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeRef(bodyCell)
                .endCell(),
        });
    }

    async getAdminAddress(provider: ContractProvider) {
        const result = await provider.get('get_admin_address', []);
        return result.stack.readAddress();
    }

    async getDenom(provider: ContractProvider, denom: Address) {
        let denomCell = beginCell().storeAddress(denom).endCell();
        const result = await provider.get('get_denom', [{ type: 'slice', cell: denomCell }]);
        return result.stack.readCellOpt();
    }
}
