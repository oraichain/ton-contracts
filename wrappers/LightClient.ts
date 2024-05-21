import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { BlockId, getBlockSlice, getTimeSlice, getVersionSlice, Version } from './TestClient';
import { crc32 } from '../crc32';

export type BlockHeader = {
    version: Version;
    chainId: string;
    height: bigint;
    time: string;
    lastBlockId: BlockId;
    proposerAddress: string;
    lastCommitHash: string;
    dataHash: string;
    validatorHash: string;
    nextValidatorHash: string;
    consensusHash: string;
    appHash: string;
    lastResultsHash: string;
    evidenceHash: string;
};

export type VerifyReceiptParams = {
    blockProof: { header: BlockHeader; blockId: BlockId };
};

export type LightClientConfig = {
    height: number;
    chainId: string;
    nextValidatorHashSet: string;
};

export function lightClientConfigToCell(config: LightClientConfig): Cell {
    return beginCell()
        .storeUint(config.height, 32)
        .storeRef(beginCell().storeBuffer(Buffer.from(config.chainId)).endCell())
        .storeRef(beginCell().storeBuffer(Buffer.from(config.nextValidatorHashSet)).endCell())
        .storeRef(beginCell().storeRef(beginCell().endCell()).storeRef(beginCell().endCell()).endCell())
        .endCell();
}

export const Opcodes = {
    verify_receipt: crc32('op::verify_receipt'),
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

    async sendVerifyReceipt(provider: ContractProvider, via: Sender, data: VerifyReceiptParams, opts?: any) {
        const blockProof = beginCell()
            .storeUint(BigInt('0x' + data.blockProof.blockId.hash), 256)
            .storeRef(getBlockHashCell(data.blockProof.header))
            .storeRef(beginCell().endCell())
            .storeRef(beginCell().endCell())
            .endCell();
        const cell = beginCell().storeRef(blockProof).endCell();
        await provider.internal(via, {
            value: opts?.value || 0,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                // .storeUint(Opcodes.verify_receipt, 32)
                // .storeUint(opts?.queryID || 0, 64)
                // .storeRef(cell)
                .endCell(),
        });
    }

    async getVerifyReceipt(provider: ContractProvider, data: VerifyReceiptParams) {
        const blockProof = beginCell()
            .storeUint(BigInt('0x' + data.blockProof.blockId.hash), 256)
            .storeRef(getBlockHashCell(data.blockProof.header))
            .storeRef(beginCell().endCell())
            .storeRef(beginCell().endCell())
            .endCell();
        const cell = beginCell().storeRef(blockProof).endCell();
        const result = await provider.get('verify_receipt', [
            {
                type: 'slice',
                cell: cell,
            },
        ]);
        return result.stack.readNumber();
    }
}

const getBlockHashCell = (header: BlockHeader) => {
    let cell = beginCell()
        .storeRef(getVersionSlice(header.version))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.chainId)).endCell())
        .storeUint(header.height, 32)
        .storeRef(getTimeSlice(header.time))
        .storeRef(getBlockSlice(header.lastBlockId))
        .storeBuffer(Buffer.from(header.proposerAddress, 'hex'));

    let hashCell1 = beginCell()
        .storeRef(beginCell().storeBuffer(Buffer.from(header.lastCommitHash, 'hex')))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.dataHash, 'hex')))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.validatorHash, 'hex')))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.nextValidatorHash, 'hex')));

    let hashCell2 = beginCell()
        .storeRef(beginCell().storeBuffer(Buffer.from(header.consensusHash, 'hex')))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.appHash, 'hex')))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.lastResultsHash, 'hex')))
        .storeRef(beginCell().storeBuffer(Buffer.from(header.evidenceHash, 'hex')));

    let dsCell = beginCell().storeRef(cell).storeRef(hashCell1).storeRef(hashCell2).endCell();
    return dsCell;
};
