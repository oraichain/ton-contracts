import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import * as data from './fixtures/data.json';
import { toHex } from '@cosmjs/encoding';
import { sha256 } from '@cosmjs/crypto';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';

describe('VerifyCommitSigs', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let VerifyCommitSigs: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        VerifyCommitSigs = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await VerifyCommitSigs.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: VerifyCommitSigs.address,
            deploy: true,
            success: true,
        });
    });

    it('test verify', async () => {
        expect(await VerifyCommitSigs.getVerifyCommitSigs(data?.header, data?.commit, data?.validators)).toBe(-1);
    });
});
