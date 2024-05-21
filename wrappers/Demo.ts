import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type DemoConfig = {
    amount: number;
    receiver: string;
    tokenDenom: string;
};

export function demoConfigToCell(config: DemoConfig): Cell {
    return beginCell()
        .storeUint(config.amount, 32)
        .storeRef(beginCell().storeBuffer(Buffer.from(config.receiver)).endCell())
        .storeRef(beginCell().storeBuffer(Buffer.from(config.tokenDenom)).endCell())
        .endCell();
}

export class Demo implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Demo(address);
    }

    static createFromConfig(config: DemoConfig, code: Cell, workchain = 0) {
        const data = demoConfigToCell(config);
        const init = { code, data };
        return new Demo(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendUpdateDemoData(
        provider: ContractProvider,
        via: Sender,
        opts: {
            sent_funds: string;
            amount: number;
            receiver: string;
            tokenDenom: string;
        },
    ) {
        await provider.internal(via, {
            value: opts.sent_funds,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(opts.amount, 32)
                .storeRef(beginCell().storeBuffer(Buffer.from(opts.receiver)).endCell())
                .storeRef(beginCell().storeBuffer(Buffer.from(opts.tokenDenom)).endCell())
                .endCell(),
        });
    }

    async getAmount(provider: ContractProvider) {
        const result = await provider.get('get_amount', []);
        return result.stack.readNumber();
    }

    async getReceiver(provider: ContractProvider) {
        const result = await provider.get('get_receiver', []);
        return result.stack.readBuffer().toString('utf-8');
    }

    async getTokenDenom(provider: ContractProvider) {
        const result = await provider.get('get_token_denom', []);
        return result.stack.readBuffer().toString('utf-8');
    }
}
