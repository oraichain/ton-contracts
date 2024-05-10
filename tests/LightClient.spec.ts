import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { BlockId, LightClient } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

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

    it('get root hash', async () => {
        const txs = [
            'CpACCo0CCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QS5AEKK29yYWkxaGYyeDdxdTI0cXA1ZWZoNzZuZGN1YzY2ZTJxbXMyZ2s5NnNzcXUSP29yYWkxOWE1eTI5emo4cWh2Z2V3OWU3dnJnYW16ZmpmNjN0cGRyd3I2NTQ1bDU2OGRkNDBxOWM5czc4ZmszNhp0eyJwcm9wb3NlIjp7ImRhdGEiOnsiT1JBSSI6IjExMjU5NTM3IiwiSU5KIjoiMjM3MzQzNzUiLCJCVEMiOiI2MjM1MDU5NTA0OSIsIkVUSCI6IjMwMDEyMDczMjkiLCJXRVRIIjoiMzAwMTIwNzMyOSJ9fX0SZwpSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAq//Gx6/7uovA4xkUDuAlB58vWrJEKrzOjEUjc6lfvleEgQKAggBGNDOARIRCgsKBG9yYWkSAzIwMRDrnwwaQGinf+ha09XngHNhaH69EGnqoeTKNEOh2SxkXF1lsLJZAsOEOrAO2vGvvMhlmLHn43y8B+ZZGezpDkNnCy5OHk8=',
            'CpACCo0CCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QS5AEKK29yYWkxemEwN2pzeGw5aGh3bXUza3RoM3U5M3NxOGpzdHpkNW12cnB2cWsSP29yYWkxOWE1eTI5emo4cWh2Z2V3OWU3dnJnYW16ZmpmNjN0cGRyd3I2NTQ1bDU2OGRkNDBxOWM5czc4ZmszNhp0eyJwcm9wb3NlIjp7ImRhdGEiOnsiT1JBSSI6IjExMjU5NjU4IiwiSU5KIjoiMjM3MzQzNzUiLCJCVEMiOiI2MjM1NTA0OTcwNCIsIkVUSCI6IjMwMDEwMjI1NTMiLCJXRVRIIjoiMzAwMTAyMjU1MyJ9fX0SZwpSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAjfEWpMdTxdv9FkygNkDy0vQ6AIlheQ7mQKfaBervvwrEgQKAggBGNm9AhIRCgsKBG9yYWkSAzIwMRDrnwwaQMIs1fnlspUrZeoaaBf1yqQqq/MQjRU/+PsT4tNUDUy3SaEwDf0niJzvSRmRVam1fRVEiKASkEd/Sh00hsZEtJQ=',
        ].map((tx) => Buffer.from(tx, 'base64'));

        const rootHash = await lightClient.getHashTreeRoot(txs);
        const expectedHash = BigInt('0x8EB7CA2F1E0CC60F6F937B5344B67276730B174A5BA88E1FD18C2F5EA72E04BF');
        console.log('Data Hash: ', rootHash.toString(16));
        expect(rootHash).toEqual(expectedHash);
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

    it('block_hash', async () => {
        const header = {
            version: { block: 11 },
            chain_id: 'Oraichain',
            height: 20082942,
            time: '2024-05-06T07:34:41.886200108Z',
            last_block_id: {
                hash: '6954B64B90D0A8B177DA1A9B14648D3DE6F706114EB9C9E1AF3BA52B6F8E3C4B',
                parts: {
                    total: 1,
                    hash: 'E07E8511743101AA131DE4E24C9C8D412ABD69F6AEE583C8E80DBF23689B6019',
                },
            },
            last_commit_hash: '4F2EDA71673E14712E23066F124CF06DE91CF166BF65AE327A94824DF4A58F0F',
            data_hash: 'B44AC9F1CF13D3EC7B3D7B03C28BEBFE31BBF952D9C0C46E8C28107E16084279',
            validators_hash: '7049E17D5A9EBDC4C165466F7C432D013BAF899A6EA2AF38240589CF881C2996',
            next_validators_hash: '7049E17D5A9EBDC4C165466F7C432D013BAF899A6EA2AF38240589CF881C2996',
            consensus_hash: '048091BC7DDC283F77BFBF91D73C44DA58C3DF8A9CBC867405D8B7F3DAADA22F',
            app_hash: '23BB5C21FB1843DB9D7494137734648BDC7067E4117D0622F0D7D7B8FD24EAAE',
            last_results_hash: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
            evidence_hash: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
            proposer_address: 'EDE8D483E839C40BF52CC14E8C3E494BFB5B0B8B',
        };

        const buf = await lightClient.getBlockHash(header);
        expect(buf.toString(16)).toEqual('1cccf41bab3dd153852b4c59a2194eb90a210e2ff585cc60ed07eba71b4d5d27');
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
});
