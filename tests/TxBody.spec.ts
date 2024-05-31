import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestClient } from '../wrappers/TestClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { toHex } from '@cosmjs/encoding';
import { sha256 } from '@cosmjs/crypto';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import * as blockData from './fixtures/bridgeData.json';

describe('TxBodyProtobuf', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let TxBodyProtobufEncode: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        TxBodyProtobufEncode = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await TxBodyProtobufEncode.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: TxBodyProtobufEncode.address,
            deploy: true,
            success: true,
        });
    });

    xit('test TxBodyProtobuf encode', async () => {
        console.log(
            toHex(
                sha256(
                    Buffer.from(
                        'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas',
                        'base64',
                    ),
                ),
            ),
        );
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas/M5U5+5QUCnnmvQ/oRxYg6nHEup0qCecpefUUhIECgIIfxjACBISCgwKBG9yYWkSBDEyODAQ9YQaGkD4je+W82MFsxqSMOOmF8PH7z2hNjdmxcy8B4ZGpITvnQi/cKDv/f1EridnKCbEw6084UzAucRSelBqQxSR5yrP',
                'base64',
            ),
        );
        const result = await TxBodyProtobufEncode.getTxBody(decodedTx.body);

        let buffer = Buffer.alloc(0);

        while (result.remaining > 0) {
            const item = result.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }

        expect(buffer.toString('hex')).toBe(Buffer.from(TxBody.encode(decodedTx.body).finish()).toString('hex'));
    });
    xit('slice to TxBodyEncode', async () => {
        console.log(
            toHex(
                sha256(
                    Buffer.from(
                        'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas',
                        'base64',
                    ),
                ),
            ),
        );
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas/M5U5+5QUCnnmvQ/oRxYg6nHEup0qCecpefUUhIECgIIfxjACBISCgwKBG9yYWkSBDEyODAQ9YQaGkD4je+W82MFsxqSMOOmF8PH7z2hNjdmxcy8B4ZGpITvnQi/cKDv/f1EridnKCbEw6084UzAucRSelBqQxSR5yrP',
                'base64',
            ),
        );
        const result = await TxBodyProtobufEncode.getTxBody(decodedTx.body);

        let buffer = Buffer.alloc(0);

        while (result.remaining > 0) {
            const item = result.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }

        expect(buffer.toString('hex')).toBe(Buffer.from(TxBody.encode(decodedTx.body).finish()).toString('hex'));
    });

    it('test with memo', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'CqcDCvMBCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSygEKK29yYWkxcmNobmtkcHN4emhxdXU2M3k2cjRqNHQ1N3BuYzl3OGVoZGhlZHgSK29yYWkxMmh6anhmaDc3d2w1NzJnZHpjdDJmeHYyYXJ4Y3doNmd5a2M3cWgabnsidHJhbnNmZXIiOnsicmVjaXBpZW50Ijoib3JhaTE5NTI2OWF3d250NW02Yzg0M3E2dzdocDhydDBrN3N5ZnU5ZGU0aDB3ejM4NHNsc2h1enBzOHk3Y2NtIiwiYW1vdW50IjoiMTMwMDQ0In19Eq4BODAwRTMyOUQwQ0Y1REFFMzNDM0E4QTQ4RDgxNzFGNTk2MEY3Qjk3NDM5REU1QUEzMzNGRjU4NDhBNjNDNzVBRTc1MzAwMDM3NjUzQUIxRkJBOUE4ODI3NjQwMUJEOTIyNkMxNEIxNEI2MjU5N0MzQjIyNUY3MUU4OUI1RDJEMUMxOUY3MkMwMDAwMDAwMDAwMDAwMDAwMDA4RTFCQzlCRjA0MDAwMDEzOTUxN0QyEmYKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQOm/DYgrW//DoWUkR9iHBxnavLyY5b9VNcYg7unhlGTchIECgIIfxi7AhIRCgsKBG9yYWkSAzc1MBDwkwkaQCsVfx+XRbTRsWkSlfON5ya5KW3r7xN3sgI2qD2hvN8IHKr4cWXxtyKN9+xoH6eNuNNld8wzyN6gr31ZK6jPQmQ=',
                'base64',
            ),
        );
        const result = await TxBodyProtobufEncode.getTxBody(decodedTx.body);
        console.log(decodedTx.body.memo);
        let buffer = Buffer.alloc(0);

        while (result.remaining > 0) {
            const item = result.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }

        expect(buffer.toString('hex')).toBe(Buffer.from(TxBody.encode(decodedTx.body).finish()).toString('hex'));
    });
});
