import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';
import { TupleItemSlice } from '@ton/core';
import { ValueOps } from './@types';

export abstract class Op {
    static transfer = 0xf8a7ea5;
    static transfer_notification = 0x7362d09c;
    static internal_transfer = 0x178d4519;
    static excesses = 0xd53276db;
    static burn = 0x595f07bc;
    static burn_notification = 0x7bdd97de;

    static provide_wallet_address = 0x2c76b973;
    static take_wallet_address = 0xd1735400;
    static mint = 0x642b7d07;
    static change_admin = 3;
    static change_content = 4;
    static top_up = 0xd372158c;
}

export type TetherMinterConfig = {
    adminAddress: Address;
    jettonWalletCode: Cell;
    content: Cell;
};

export function tetherMinterConfigToCell(config: TetherMinterConfig): Cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(config.adminAddress)
        .storeAddress(null)
        .storeRef(config.jettonWalletCode)
        .storeRef(config.content)
        .endCell();
}

export interface MintJettonInterface {
    toAddress: Address;
    jettonAmount: bigint;
    amount: bigint;
}

export class TetherMinter implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new TetherMinter(address);
    }

    static createFromConfig(config: TetherMinterConfig, code: Cell, workchain = 0) {
        const data = tetherMinterConfigToCell(config);
        const init = { code, data };
        return new TetherMinter(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, ops: ValueOps) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            ...ops,
            body: beginCell()
                .storeUint(Op.top_up, 32)
                .storeUint(ops.queryId || 0, 64)
                .endCell(),
        });
    }

    async sendMint(
        provider: ContractProvider,
        via: Sender,
        data: MintJettonInterface,
        opts: ValueOps,
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value: opts.value,
            body: beginCell()
                .storeUint(Op.mint, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeAddress(data.toAddress)
                .storeCoins(data.amount)
                .storeRef(
                    beginCell()
                        .storeUint(Op.internal_transfer, 32)
                        .storeUint(opts.queryId || 0, 64)
                        .storeCoins(data.jettonAmount)
                        .storeAddress(this.address)
                        .storeAddress(this.address)
                        .storeCoins(0)
                        .storeUint(0, 1)
                        .endCell(),
                )
                .endCell(),
        });
    }

    async getWalletAddress(provider: ContractProvider, address: Address): Promise<Address> {
        const result = await provider.get('get_wallet_address', [
            {
                type: 'slice',
                cell: beginCell().storeAddress(address).endCell(),
            } as TupleItemSlice,
        ]);

        return result.stack.readAddress();
    }

    async getTotalsupply(provider: ContractProvider): Promise<bigint> {
        const result = await provider.get('get_jetton_data', []);
        return result.stack.readBigNumber();
    }
}
