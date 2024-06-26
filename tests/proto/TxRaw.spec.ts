import { defaultRegistryTypes } from '@cosmjs/stargate';
import { compile } from '@ton/blueprint';
import { Cell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { Tx } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { TestClient } from '../../wrappers/TestClient';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';

const NOT_MSG_EXECUTE_ERROR = 3;

describe('TxEncoded', () => {
    let code: Cell;
    beforeAll(async () => {
        code = await compile('TestClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let TxEncoded: SandboxContract<TestClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        TxEncoded = blockchain.openContract(
            TestClient.createFromConfig(
                {
                    id: 0,
                    counter: 0,
                },
                code,
            ),
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await TxEncoded.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: TxEncoded.address,
            deploy: true,
            success: true,
        });
    });

    it('test TxEncoded encode', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'CsAICr0ICiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSlAgKK29yYWkxemZreHlycjdzY3NlOGMzdHl0OTlkbWg5NmM3bXA5ZGo3ZTMzY2oSK29yYWkxNWh1YTJxODNmcDY2Nm53aG55cm45ZzhndDl1ZWVubDMycW51Z2gatwd7ImRpc3RyaWJ1dGUiOnsic3Rha2luZ190b2tlbnMiOlsib3JhaTFoeG00MzNobnd0aHJ4bmV5anlzdmhueTUzOXM5a2g2czJnMm44eSIsIm9yYWkxcW15M3V1eGt0Zmx2cmVhbmFxcGg2eXVhN3N0am42ajY1cnVyNjIiLCJvcmFpMWcycHJxcnkzNDNreDU2NmNwN3V3czl3N3Y3OG41dGVqeWx2YXo2Iiwib3JhaTFtYXY1MmVxaGQwN2MzbHdldmNucWR5a2R6aGg0NzMzemYzMmpjbiIsIm9yYWkxN3JjZmNyd2x0dWpmdng3dzRsMmdneWt1OHFybmN5MGhkdnJ6dmMiLCJvcmFpMTlsdGo5N2ptZHFuejVtcmQyYW1ldGhldHZjd3NwMDIyMGt3dzNlIiwib3JhaTE4eXdsbHcwM2h2eTcyMGwwNnJtZTBhcHd5eXE5cGxrNjRoOWNjZiIsIm9yYWkxYXk2ODlsdHI1N2p0MnNudWphcnZha3hybXR1cThmaHVhdDVybnZxNnJjdDg5dmplcjlncW0ydmRlNiIsIm9yYWkxZTB4ODd3OWV6d3Eyc2RtdnY1ZHE1bmd6eTk4bHQ0N3RxZmFmMm03enBrZzQ5ZzVkajZmcXJlZDVkNyIsIm9yYWkxd2d5d2d2dW10NWR4aG03dmpwd3g1ZXM5ZWNydGw4NXFhcWRzcGpxd3gybHVneTd2bXc1cWx3cm44OCIsIm9yYWkxaGNqbmUwaG1kajZwanJjM3h1a3N1Y3IweXBsc2E5bnk3djA0N2MzNHk4azhoZmZscTZ5cXlqYXBubiIsIm9yYWkxc2xxdzZnZnZzNmwyamd2aDVyeWpheWY0Zzc3ZDdzZ2Z2NmZ1bXR5emNyMDZhNmc5Z25ycTZjNHJnZyIsIm9yYWkxbndwZmQwOW1yNHJmOGQ1YzltaDQzYXh6ZXprd3lyN2RxMmx1czIzanN3NHh3Mmpxa2F4cXh3bWtkMyIsIm9yYWkxcnZyOXdrNm1kbGZ5c3ZncDcybHR0aHF2a2tkNTY3N21wODkyZWZxODZ5eXI5YWx0MHRtczJhNmxjcyIsIm9yYWkxamQ5bGMycXQwbHRqc2F0Z251Mzh4c3o4bmdwODljbHAwZHBlaDhnZXlqajcweXZrbjRrcW1ybWgzbSIsIm9yYWkxeHM1YWo5MGQ1bThrd2ZwOXQ2Z2hrY3BrOGQ3c3k1anN4ZHN5ZWpqZHh1ZGhoZm03d2Vnc2RnOTI5ZCJdfX0SaApSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAqW27ULzxYqN3Mb1+u5ElHEmeGpViohTpGXC4tDusEpnEgQKAggBGOrjEBISCgwKBG9yYWkSBDE1NTAQsM1eGkDFNBeNBwb246XJAXVjCSfEIs09CRwiqgHYpBcOgMCCpXbFAA9DCy4mJbz7/Z0izRmokIluSZgEjOhMIYkZW0tq',
                'base64',
            ),
        );

        const registry = new Registry(defaultRegistryTypes);
        registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);

        const rawMsg = decodedTx.body.messages.map((msg) => {
            return {
                typeUrl: msg.typeUrl,
                value: registry.decode(msg),
            };
        });

        const decodedTxWithRawMsg: any = {
            ...decodedTx,
            body: {
                messages: rawMsg,
                memo: decodedTx.body.memo,
                timeoutHeight: decodedTx.body.timeoutHeight,
                extensionOptions: decodedTx.body.extensionOptions,
                nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
            },
        };

        console.log({ decodedTxWithRawMsg });
        const tuple = await TxEncoded.getDecodedTxRaw(decodedTxWithRawMsg);

        let buffer = Buffer.alloc(0);

        while (tuple.remaining > 0) {
            const item = tuple.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }

        expect(buffer.toString('hex')).toBe(
            Buffer.from(
                Tx.encode({
                    signatures: decodedTx.signatures as any,
                    authInfo: decodedTx.authInfo,
                    body: decodedTx.body,
                }).finish(),
            ).toString('hex'),
        );
    });

    it('expect error not supported typeUrl', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas/M5U5+5QUCnnmvQ/oRxYg6nHEup0qCecpefUUhIECgIIfxjACBISCgwKBG9yYWkSBDEyODAQ9YQaGkD4je+W82MFsxqSMOOmF8PH7z2hNjdmxcy8B4ZGpITvnQi/cKDv/f1EridnKCbEw6084UzAucRSelBqQxSR5yrP',
                'base64',
            ),
        );

        const registry = new Registry(defaultRegistryTypes);
        registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);

        const rawMsg = decodedTx.body.messages.map((msg) => {
            return {
                typeUrl: msg.typeUrl,
                value: registry.decode(msg),
            };
        });

        const decodedTxWithRawMsg: any = {
            ...decodedTx,
            body: {
                messages: rawMsg,
                memo: decodedTx.body.memo,
                timeoutHeight: decodedTx.body.timeoutHeight,
                extensionOptions: decodedTx.body.extensionOptions,
                nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
            },
        };

        const tuple = await TxEncoded.getDecodedTxRaw(decodedTxWithRawMsg).catch((err) => {
            expect(err.exitCode).toBe(NOT_MSG_EXECUTE_ERROR);
        });
    });

    it('test TxEncoded with memo', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'CtoFCskFCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSoAUKK29yYWkxbTczNm56aHZkMzd2bDYwZGc0MHlwN3EzMnB2Y3E3eHN1djY2bncSP29yYWkxcjdxd3RmcDd1YzBqc2VtYzhmcm5qZ3djNGdwc3B4bnVoZzdnamN2M3NsenVsMDhnZ2xkczY1dG5ycBqvBHsiYXNzaWduX2tleSI6eyJ2ZXJpZmllcl9pZCI6IjB4NmFkYjEwYzRjZTViYmFhZGMwYTIxMDUzNGQ3YTZkZmFiMDc0ZDc3YzhlOTI4MDYyODk0OWQyM2ZjYThiMWFkZiIsInZlcmlmaWVyIjoic3NvLWdvb2dsZSIsInB1Yl9rZXlzIjpbIkE0Wjl5RGJteG5lbHJlTnQ4ME9YUHJrYTVFOVROOWhkUGVoem94NzY3S1hvIiwiQTg2eVA3UEIrbFFmUFRvdm5pMTZXRjBOb3Q4Q05udi9qRFNmSTFwRGV5N3YiLCJBLzFXWTF0UDZVTkFibGRnN1dmWHhIWFJ6Q3o4eEhhNTBzdjd1MVRrVjJRNSJdLCJzaWdzIjpbIjhtOFZ0Z0Q0TlcvQnUyLzFUSlFVV1VlQWtUanp2UXdxZFloazU5WlIrMVpKUUdsTG4zbm90Zld1Ty9XK1IvbTRnL3phRlZwMXUzbkFyczRNY0w5Ym5BPT0iLCJQWEtDZFlyZlZYcTRSanFYM0tWUE8vYXdudzBuQU1WTmJ2ZUVQNWp6RUpWVkJkTzFiWE9NZktHWW9OSFdkMlA5S0djbWNIOEJEUHFkWG5USEIyc1pnQT09IiwiU1lkMi9XckNrSHpVbUZIRTllUHd5Z0N6QXFVS3RhRG1QRXZIV29oQ2R2VlA2MkNtWG5mZEp5OHFPWWE1UkVtY2JSVGhyNU51bjFlZUNRaWJLOUtFM1E9PSJdfX0SDGJhdGNoRXhlY3V0ZRJnClIKRgofL2Nvc21vcy5jcnlwdG8uc2VjcDI1NmsxLlB1YktleRIjCiEDzrI/s8H6VB89Oi+eLXpYXQ2i3wI2e/+MNJ8jWkN7Lu8SBAoCCAEYpcoEEhEKCwoEb3JhaRIDODM3EJOKMxpAlzfK9ZQnXKorhaaXR1+3m5Pd1ZZSa5RHcNsDOAvE3iVL5zrYmgtTRLV6Fj8yWYDilRFbL9N7ol4aXCOXB6ho2Q==',
                'base64',
            ),
        );

        const registry = new Registry(defaultRegistryTypes);
        registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);

        const rawMsg = decodedTx.body.messages.map((msg) => {
            return {
                typeUrl: msg.typeUrl,
                value: registry.decode(msg),
            };
        });

        const decodedTxWithRawMsg: any = {
            ...decodedTx,
            body: {
                messages: rawMsg,
                memo: decodedTx.body.memo,
                timeoutHeight: decodedTx.body.timeoutHeight,
                extensionOptions: decodedTx.body.extensionOptions,
                nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
            },
        };

        const tuple = await TxEncoded.getDecodedTxRaw(decodedTxWithRawMsg);

        let buffer = Buffer.alloc(0);

        while (tuple.remaining > 0) {
            const item = tuple.pop();
            if (item.type === 'slice') {
                buffer = Buffer.concat([buffer, Buffer.from(item.cell.bits.toString(), 'hex')]);
            }
        }

        expect(buffer.toString('hex')).toBe(
            Buffer.from(
                Tx.encode({
                    signatures: decodedTx.signatures as any,
                    authInfo: decodedTx.authInfo,
                    body: decodedTx.body,
                }).finish(),
            ).toString('hex'),
        );
    });

    it('test decode', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                'CuECCt4CCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QStQIKK29yYWkxMnAweXdqd2NwYTUwMHI5ZnVmMGhseTc4enlqZWx0YWtyemt2MGMSP29yYWkxNmthNjU5bDB0OTBkdWE2ZHU4eXEwMnl0Z2RoMjIyZ2EzcWN4YXF4cDg2cjc4cDZ0bDB1c3plNTd2ZRrEAXsic3VibWl0Ijp7ImRhdGEiOiI4MDAwMjI1NUQ3M0UzQTVDMUE5NTg5RjBBRUNFMzFFOTdCNTRCMjYxQUMzRDdEMTZENEYxMDY4RkRGOUQ0QjRFMTgzMDAzRkQ5OEQyQzZBNDM5NUJCQUVBRjJDNTI2RjVBODU2M0Y3MzFGNTFFRjI5NzUzQTBGMzNCNjgzNzdEMENCQTEzNDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMEVFNkIyODAwMTM5NTE3RDIifX0SZgpRCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAl6cPsb7Dr2N7hLqcD9Zb8k8jGYKqkiobVKT1IxBQKBlEgQKAggBGKEZEhEKCwoEb3JhaRIDMzE5EMncCRpAyOdmVtLeSz39yTbFKxlHfoT1GripZ/07ivt2hxXdX9xtjgjbT5bOn0NDx04pCjeGA7zxdYWfEX0mSAu9WLP05w==',
                'base64',
            ),
        );

        const registry = new Registry(defaultRegistryTypes);
        registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);

        const rawMsg = decodedTx.body.messages.map((msg) => {
            return {
                typeUrl: msg.typeUrl,
                value: registry.decode(msg),
            };
        });
        console.log(Buffer.from([115, 101, 110, 100]).toString('utf-8'));
        console.log(rawMsg[0].value.msg);
        console.log(new Uint8Array(Buffer.from('{}":,')));
    });
});
