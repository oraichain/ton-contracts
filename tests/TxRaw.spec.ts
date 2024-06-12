import { defaultRegistryTypes } from '@cosmjs/stargate';
import { compile } from '@ton/blueprint';
import { Cell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { Tx } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { TestClient } from '../wrappers/TestClient';
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
                "CpQDCuABCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QStwEKK29yYWkxbXozYWVtcjA0ZHRleG0yaGx5NjRhMjhhYzQwYXp4YzcyNzR4MzUSK29yYWkxbHVzMGYwcmh4OHMwM2dkbGx4Mm42dmhrbWYwNTM2ZHY1N3dmZ2UaW3sidHJhbnNmZXIiOnsicmVjaXBpZW50Ijoib3JhaTFqYzdzbHVjazV6aGVtemZudmVucjBneWdxZzJ2cHJ4Z2hydWZ5MiIsImFtb3VudCI6Ijk4NzI2OTIifX0SrgE4MDAwMjI1NUQ3M0UzQTVDMUE5NTg5RjBBRUNFMzFFOTdCNTRCMjYxQUMzRDdEMTZENEYxMDY4RkRGOUQ0QjRFMTgzMDAwNDE0NENBMzgyQTRERTI4NUFENTFDM0EzMUQ4ODY2RUZCNEZDMzgxQTkzMEFGMjI2QzhFM0ZDOUNCNTdEREJCNDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwOTUwMkY5MDAwMTM5NTE3RDISZQpQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAzIF2JSumxOGmAyvhjCdnXkGhFAdbmguGq7CiPw+74twEgQKAgh/GGQSEQoLCgRvcmFpEgM0NTAQ8JMJGkANeGO/eo7axC1aGg7prz5d3si5lsXTlW6bW83jKsBWslUMi+Mz4jN3hr0iDeefeO2w4/9HsBbyH6ZTjPpaSi27",
                'base64',
            ),
        );
        console.log(decodedTx.body.messages[0].value);
        
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

   it('test decode', async () => {
        const decodedTx = decodeTxRaw(
            Buffer.from(
                "CrYECrMECiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSigQKK29yYWkxMnBjZXhmbmR1NDJuaGx1aGt0MmQyMzZ5Y3ZycHY1cWw5NjhnaDkSK29yYWkxMmh6anhmaDc3d2w1NzJnZHpjdDJmeHYyYXJ4Y3doNmd5a2M3cWgarQN7InNlbmQiOnsiY29udHJhY3QiOiJvcmFpMTk1MjY5YXd3bnQ1bTZjODQzcTZ3N2hwOHJ0MGs3c3lmdTlkZTRoMHd6Mzg0c2xzaHV6cHM4eTdjY20iLCJhbW91bnQiOiIxNTIwMDAwMDAiLCJtc2ciOiJleUpzYjJOaGJGOWphR0Z1Ym1Wc1gybGtJam9pWTJoaGJtNWxiQzB5T1NJc0luSmxiVzkwWlY5aFpHUnlaWE56SWpvaWIzSmhhV0l4TW5CalpYaG1ibVIxTkRKdWFHeDFhR3QwTW1ReU16WjVZM1p5Y0hZMWNXeHFiWEo1ZUhnaUxDSnlaVzF2ZEdWZlpHVnViMjBpT2lKdmNtRnBZakI0TlRWa016azRNekkyWmprNU1EVTVaa1kzTnpVME9EVXlORFk1T1Rrd01qZENNekU1TnprMU5TSXNJblJwYldWdmRYUWlPak0yTURBc0ltMWxiVzhpT2lKdmNtRnBZakI0WldJMVlUQmhORE16TWpRMlpHRXlaR1JsWmpkak1tSXpOalV3T1RJd1ptSTJNelJoTWpVMVlTSjkifX0SZgpQCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohA9WYaaxtkm8XVXQwDUFfCmHK2G2pjN3zZ8u43KPBcD14EgQKAggBGAYSEgoMCgRvcmFpEgQ1MDg5ELSOPhpAzUfU7cvbIBHpttfEwHzvZyj98BpajqAiGvi5Iod8d5tgn+xuMEdjyRySXs5CKIJvMohyWt7iUyUHOlpb9zaxdg==",
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
        console.log(Buffer.from([115,101,110,100]).toString('utf-8'));
        console.log(rawMsg[0].value.msg);
        console.log(new Uint8Array(Buffer.from('{}":,')));
    }); 
});
