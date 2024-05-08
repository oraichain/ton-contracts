import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { Counter } from '../wrappers/Counter';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Counter', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Counter');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let counter: SandboxContract<Counter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        counter = blockchain.openContract(
            Counter.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await counter.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: counter.address,
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

            const counterBefore = await counter.getCounter();

            console.log('counter before increasing', counterBefore);

            const increaseBy = Math.floor(Math.random() * 100);

            console.log('increasing by', increaseBy);

            const increaseResult = await counter.sendIncrease(increaser.getSender(), {
                increaseBy,
                value: toNano('0.05'),
            });

            expect(increaseResult.transactions).toHaveTransaction({
                from: increaser.address,
                to: counter.address,
                success: true,
            });

            const counterAfter = await counter.getCounter();

            console.log('counter after increasing', counterAfter);

            expect(counterAfter).toBe(counterBefore + increaseBy);
        }
    });

    it('do encode_length', async () => {
        let len = await counter.getEncodeLength(100_000n);
        expect(len).toEqual(3);
        console.log('length', len);

        // len = await counter.getBufferEncodeLength(Buffer.from('hello world'));
        // console.log('length', len);
    });

    it('do encode_int', async () => {
        const buf = await counter.getEncode(100_000n);
        console.log('buf', buf);
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
        const verified = await counter.getCheckSignature(data, signature, publicKey);
        console.log('verified', verified);
    });

    it('get root hash', async () => {
        const txs = [
            'CpACCo0CCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QS5AEKK29yYWkxaGYyeDdxdTI0cXA1ZWZoNzZuZGN1YzY2ZTJxbXMyZ2s5NnNzcXUSP29yYWkxOWE1eTI5emo4cWh2Z2V3OWU3dnJnYW16ZmpmNjN0cGRyd3I2NTQ1bDU2OGRkNDBxOWM5czc4ZmszNhp0eyJwcm9wb3NlIjp7ImRhdGEiOnsiT1JBSSI6IjExMzY2NTcwIiwiSU5KIjoiMjQ1MTUxODMiLCJCVEMiOiI2Mjc3MTkxNDY0OSIsIkVUSCI6IjMwMzAxNzYzNjQiLCJXRVRIIjoiMzAzMDE3NjM2NCJ9fX0SZwpSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAq//Gx6/7uovA4xkUDuAlB58vWrJEKrzOjEUjc6lfvleEgQKAggBGLrNARIRCgsKBG9yYWkSAzIwMRDanwwaQE4vdLMrK3YCDWvsKZDH80C9mVT43TPNjqVj10BrvRcvODWpNpcq+ujaU3nTxq8zKogyU5CV0P/+cPBzNN6uDSU=',
        ].map((tx) => Buffer.from(tx, 'base64'));

        const rootHash = await counter.getHashTreeRoot(txs);
        const expectedHash = BigInt('0x6eedbe6e969e36ccce947a58b90be3a666a238c349378efe1ac5d5b1da22c3e1');
        console.log('Data Hash: ', rootHash.toString(16));
        expect(rootHash).toEqual(expectedHash);
    });
});
