import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { BlockId, Commit, getBlockSlice, getTimeSlice, getVersionSlice, Validators, Version } from './TestClient';
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
    blockProof: { header: BlockHeader; commit: Commit; validators: Validators[]; blockId: BlockId };
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
            .storeRef(getCommitCell(data.blockProof.commit))
            .storeRef(getValidatorsCell(data.blockProof.validators)!)
            .endCell();
        // #DEBUG#: s0 = CS{Cell{0408013270fe} bits: 0..32; refs: 0..4}
        // #DEBUG#: s0 = CS{Cell{0210013270fd00000000} bits: 0..64; refs: 0..2}
        // #DEBUG#: s0 = CS{Cell{0200} bits: 0..0; refs: 0..2}
        const cell = beginCell().storeRef(blockProof).endCell();
        await provider.internal(via, {
            value: opts?.value || 0,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.verify_receipt, 32)
                .storeUint(opts?.queryID || 0, 64)
                .storeRef(cell)
                .endCell(),
        });
    }
}

const getCommitCell = (commit: Commit) => {
    let signatureCell;
    for (let i = commit.signatures.length - 1; i >= 0; i--) {
        let signature = commit.signatures[i];
        let cell = beginCell()
            .storeUint(signature.block_id_flag, 8)
            .storeBuffer(Buffer.from(signature.validator_address, 'hex'))
            .storeRef(getTimeSlice(signature.timestamp))
            .storeBuffer(signature.signature ? Buffer.from(signature.signature, 'base64') : Buffer.from(''))
            .endCell();
        if (!signatureCell) {
            signatureCell = beginCell().storeRef(beginCell().endCell()).storeRef(cell).endCell();
        } else {
            signatureCell = beginCell().storeRef(signatureCell).storeRef(cell).endCell();
        }
    }

    let commitCell = beginCell()
        .storeUint(BigInt(commit.height), 32)
        .storeUint(BigInt(commit.round), 32)
        .storeRef(getBlockSlice(commit.block_id))
        .storeRef(signatureCell!)
        .endCell();
    return commitCell;
};

const getValidatorsCell = (validators: Validators[]) => {
    let validatorCell;
    for (let i = validators.length - 1; i >= 0; i--) {
        let builder = beginCell().storeBuffer(Buffer.from(validators[i].address, 'hex'));
        if (validators[i]?.pub_key?.value) {
            builder = builder.storeRef(
                beginCell()
                    .storeBuffer(Buffer.from(validators[i].pub_key.value as string, 'base64'))
                    .endCell(),
            );
        } else {
            builder = builder.storeRef(
                beginCell()
                    .storeBuffer(
                        Buffer.from(
                            Array.from({ length: 32 })
                                .map(() => 0)
                                .join(''),
                            'hex',
                        ),
                    )
                    .endCell(),
            );
        }
        builder = builder.storeUint(parseInt(validators[i].voting_power), 32);
        let innerCell = builder.endCell();
        if (!validatorCell) {
            validatorCell = beginCell().storeRef(beginCell().endCell()).storeRef(innerCell).endCell();
        } else {
            validatorCell = beginCell().storeRef(validatorCell).storeRef(innerCell).endCell();
        }
        return validatorCell;
    }
};

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
    return dsCell!;
};
