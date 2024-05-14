import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { BlockId, LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { result as blockData } from './fixtures/block.json';
import { result as validators } from './fixtures/validators.json';
import { createHash } from 'crypto';

const validatorMap = Object.fromEntries(validators.validators.map((v) => [v.address, v]));

describe('LightClient', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('LightClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let lightClient: SandboxContract<LightClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        lightClient = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await lightClient.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClient.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and counter are ready to use
    });

    it('should increase counter', async () => {
        const increaseTimes = 3;
        for (let i = 0; i < increaseTimes; i++) {
            console.log(`increase ${i + 1}/${increaseTimes}`);

            const increaser = await blockchain.treasury('increaser' + i);

            const counterBefore = await lightClient.getCounter();

            console.log('counter before increasing', counterBefore);

            const increaseBy = Math.floor(Math.random() * 100);

            console.log('increasing by', increaseBy);

            const increaseResult = await lightClient.sendIncrease(increaser.getSender(), {
                increaseBy,
                value: toNano('0.05'),
            });

            expect(increaseResult.transactions).toHaveTransaction({
                from: increaser.address,
                to: lightClient.address,
                success: true,
            });

            const counterAfter = await lightClient.getCounter();

            console.log('counter after increasing', counterAfter);

            expect(counterAfter).toBe(counterBefore + increaseBy);
        }
    });

    it('encode_uint', async () => {
        let len = await lightClient.getEncodeLength(100_000n);
        expect(len).toEqual(3);
        console.log('length', len);
        const buf = await lightClient.getEncode(100_000n);
        console.log('buf', buf);
    });

    it('get_buffer_encode', async () => {
        const buf = await lightClient.getBufferEncode(Buffer.from('Oraichain'));
        console.log('buf', buf.toString('hex'));
    });

    it('check signature', async () => {
        const data = Buffer.from(
            '6e080211fd7032010000000022480a206954b64b90d0a8b177da1a9b14648d3de6f706114eb9c9e1af3ba52b6f8e3c4b122408011220e07e8511743101aa131de4e24c9c8d412abd69f6aee583c8e80dbf23689b60192a0c089190e2b10610e2d6999f0332094f726169636861696e',
            'hex',
        );
        const signature = Buffer.from(
            '2f042189d233b9113b91177184c699dcb140439f73cf0c7fb0c640d5edc46d76f95470bb54d0322bb0cdabeb7c848226a2d7e318a2d5d741961f8eeccefa3304',
            'hex',
        );
        const publicKey = Buffer.from('10b8dfde73aeda38f81c5ce9c181ccaf2e25d0c66b8d4bfb41732f0ae61ee566', 'hex');
        const verified = await lightClient.getCheckSignature(data, signature, publicKey);
        console.log('verified', verified);
    });

    it('encode_time', async () => {
        const buf = await lightClient.getTimeEncode('2024-05-06T07:34:41.886488234Z');
        console.log(buf.toString('hex'));
    });

    it('block_id_encode', async () => {
        const blockId: BlockId = {
            hash: '6954B64B90D0A8B177DA1A9B14648D3DE6F706114EB9C9E1AF3BA52B6F8E3C4B',
            parts: {
                total: 1,
                hash: 'E07E8511743101AA131DE4E24C9C8D412ABD69F6AEE583C8E80DBF23689B6019',
            },
        };
        const buf = await lightClient.get__blockid__encode(blockId);
        console.log('buf', buf.toString('hex'));
    });

    it('vote_sign_bytes', async () => {
        const vote = {
            type: 2,
            timestamp: '2024-05-06T07:34:41.886488234Z',
            block_id: {
                hash: '6954B64B90D0A8B177DA1A9B14648D3DE6F706114EB9C9E1AF3BA52B6F8E3C4B',
                parts: {
                    total: 1,
                    hash: 'E07E8511743101AA131DE4E24C9C8D412ABD69F6AEE583C8E80DBF23689B6019',
                },
            },
            height: 20082941,
            round: 0,
            chain_id: 'Oraichain',
        };
        const signBytes = await lightClient.getVoteSignBytes(vote);
        expect(signBytes.toString('hex')).toEqual(
            '6e080211fd7032010000000022480a206954b64b90d0a8b177da1a9b14648d3de6f706114eb9c9e1af3ba52b6f8e3c4b122408011220e07e8511743101aa131de4e24c9c8d412abd69f6aee583c8e80dbf23689b60192a0c089190e2b10610aaf9daa60332094f726169636861696e',
        );
    });

    it('verify tx', async () => {
        const { header, data, last_commit } = blockData.block;

        // verify block header
        const buf = await lightClient.getBlockHash(header);
        expect(buf).toEqual(BigInt('0x' + blockData.block_id.hash));
        let verifiedPower = 0;
        let isVerified = false;
        // verify signatures
        const totalPowers = validators.validators.reduce((total, v) => total + Number(v.voting_power), 0);
        for (const sig of last_commit.signatures) {
            if (!sig.validator_address || !sig.signature) continue;
            const validator = validatorMap[sig.validator_address];
            const pubkey = Buffer.from(validator.pub_key.value, 'base64');

            const vote = {
                type: sig.block_id_flag,
                timestamp: sig.timestamp,
                block_id: last_commit.block_id,
                height: Number(last_commit.height),
                round: Number(last_commit.round),
                chain_id: header.chain_id,
            };

            // get sign bytes
            const verified = await lightClient.getVerifyVote(vote, Buffer.from(sig.signature, 'base64'), pubkey);

            if (verified) {
                verifiedPower += Number(validator.voting_power);
            }
            const verifiedPercent = (verifiedPower / totalPowers) * 100;
            console.log('current voting power', verifiedPercent.toFixed(2), '%');
            if (verifiedPercent > 66) {
                isVerified = true;
                break;
            }
        }
        expect(isVerified).toBeTruthy();

        // verify tx proof
        const rootTxsHash = await lightClient.getHashTreeRoot(data.txs);
        expect(rootTxsHash).toEqual(BigInt('0x' + header.data_hash));
    });

    it('digest_hash', async () => {
        const tx = Buffer.from(blockData.block.data.txs[0], 'base64');
        const ret = await lightClient.getDigestHash(tx);
        console.log(createHash('sha256').update(tx).digest('hex'), ret.toString(16));
    });
});
