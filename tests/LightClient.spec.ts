import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { LightClient, Opcodes } from '../wrappers/LightClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
// import blockData from './fixtures/data.json';
import blockData from './fixtures/new_data.json';
import { setTimeout } from 'timers/promises';
import { createHash } from 'crypto';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';

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
        blockchain.verbosity = {
            ...blockchain.verbosity,
            vmLogs: 'vm_logs_gas',
        };
        lightClient = blockchain.openContract(
            LightClient.createFromConfig(
                {
                    chainId: 'Oraichain',
                    height: 1,
                    validatorHashSet: '',
                    dataHash: '',
                    nextValidatorHashSet: '',
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

    xit('test light client verify block hash', async () => {
        const { header, block_id } = blockData;
        const user = await blockchain.treasury('user');
        const result = await lightClient.sendVerifyBlockHash(
            user.getSender(),
            {
                header: {
                    appHash: header.app_hash,
                    chainId: header.chain_id,
                    consensusHash: header.consensus_hash,
                    dataHash: header.data_hash,
                    evidenceHash: header.evidence_hash,
                    height: BigInt(header.height),
                    lastBlockId: header.last_block_id,
                    lastCommitHash: header.last_commit_hash,
                    lastResultsHash: header.last_results_hash,
                    validatorHash: header.validators_hash,
                    nextValidatorHash: header.next_validators_hash,
                    proposerAddress: header.proposer_address,
                    time: header.time,
                    version: header.version,
                },
                blockId: block_id,
            },
            { value: toNano('0.5') },
        );
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_block_hash,
        });
        expect(await lightClient.getHeight()).toBe(parseInt(header.height));
        expect(await lightClient.getChainId()).toBe(header.chain_id);
        expect((await lightClient.getDataHash()).toString('hex')).toBe(header.data_hash.toLowerCase());
        expect((await lightClient.getValidatorHash()).toString('hex')).toBe(header.validators_hash.toLowerCase());
    });

    xit('test light client store untrusted validators', async () => {
        const { validators } = blockData;
        const user = await blockchain.treasury('user');
        const result = await lightClient.sendStoreUntrustedValidators(user.getSender(), validators, {
            value: toNano('0.5'),
        });
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.store_untrusted_validators,
        });
    });

    it('test light client verify receipt', async () => {
        const { header, commit, validators, block_id } = blockData;
        const user = await blockchain.treasury('user');
        let result = await lightClient.sendVerifyBlockHash(
            user.getSender(),
            {
                header: {
                    appHash: header.app_hash,
                    chainId: header.chain_id,
                    consensusHash: header.consensus_hash,
                    dataHash: header.data_hash,
                    evidenceHash: header.evidence_hash,
                    height: BigInt(header.height),
                    lastBlockId: header.last_block_id,
                    lastCommitHash: header.last_commit_hash,
                    lastResultsHash: header.last_results_hash,
                    validatorHash: header.validators_hash,
                    nextValidatorHash: header.next_validators_hash,
                    proposerAddress: header.proposer_address,
                    time: header.time,
                    version: header.version,
                },
                blockId: block_id,
            },
            { value: toNano('0.5') },
        );
        console.log(`blockhash:`, Opcodes.verify_block_hash);
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_block_hash,
        });
        result = await lightClient.sendStoreUntrustedValidators(user.getSender(), validators, {
            value: toNano('0.5'),
        });
        console.log('store_untrusted_validators', Opcodes.store_untrusted_validators);
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.store_untrusted_validators,
        });
        result = await lightClient.sendVerifyUntrustedValidators(user.getSender(), {
            value: toNano('1'),
        });

        console.log(Opcodes.verify_untrusted_validators);
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_untrusted_validators,
        });

        result = await lightClient.sendVerifySigs(user.getSender(), commit, {
            value: toNano('1'),
        });

        console.log('verify_sigs', Opcodes.verify_sigs);
        expect(result.transactions[1]).toHaveTransaction({
            success: true,
            op: Opcodes.verify_sigs,
        });

        // result = await lightClient.sendVerifySigs(user.getSender(), commit, {
        //     value: toNano('0.5'),
        // });
        // console.log('verify_sigs', Opcodes.verify_sigs);
        // expect(result.transactions[1]).toHaveTransaction({
        //     success: true,
        //     op: Opcodes.verify_sigs,
        // });

        // // verify tx now:
        // // 53748123942928445796153625209665602923363100986949452406157600748643368908519
        // const txs = [
        //     'Cs8RCswRCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSoxEKK29yYWkxbTczNm56aHZkMzd2bDYwZGc0MHlwN3EzMnB2Y3E3eHN1djY2bncSP29yYWkxcjdxd3RmcDd1YzBqc2VtYzhmcm5qZ3djNGdwc3B4bnVoZzdnamN2M3NsenVsMDhnZ2xkczY1dG5ycBqyEHsic2hhcmVfZGVhbGVyIjp7InNoYXJlIjp7InJvd3MiOlsiTFd0ZXh6aDJ3d0ZLWnhMN1krdERQdmRQNnMzVUY3Sk1RTTJFTTlrd3M5NmMxR3N1NmFIekNwbU9RaVhtSjFyZi9uWWt4aFROS0ZjWXlxK2NIUG9ETkExOUdxelFRWDZPaXZKeG1WaFZGa0lyWWM4UVpkU2huNU5ZbzNqR0RVcjFKMzBoUHplUTBia0JrMlN5aFZ5a0I3S1hpbGpIb2cvVWVkaU91SFJlYWM4PSIsInRKbzh5L3h0NGdHYXBTMFNzZlpFSnFLV1M3SjlWaTVjTU5CUkFPN1FUU2dYSGQ5V2VtWkdjRmo0enh0MHpBNDRhdnhtb2lNNzBmcXdLeWVmV1BBcjAvbVhXcjFLUGwrVis0UTFGenRrajlKc1ZrTXMzemlyUTBYTUt2bDErS2s5QVY4L3hpZktBeGVPdTBFZTFITXlHOWZ2NndRanMwUlpMQW85ekdvbUpKdz0iLCJ0VzdVNlBwaEVKbXZ6U25ESkc3RXJXZTFBM2phSE91b3lpaEJ2N0hHSG0yODhsSmsvWjhpU05DTFFXVmVnWFZpZnNkWm9aenQ5NTF1M1R1OFRtY2tvOGxiUjJVYVMxalphM0Z3NEM4WlhKTnZKaUh1dUk3MjhDVUJwVEhNbmxMU00raXlyc1kwZkZaWkN4bUZ2UVhEZkJMUzZIQkhtSjlSamVZSERSUDRnZjA9IiwiK0lMdlN5b3EwSTVyQ245QmQ4N05aOUE0R0lPWGV1LzlPbWpPQlZjdVdvQVBPRmpKMEdvbklKTzZWOWpISnh3Tmtjdjd4a21rLzJuZG9qUG9FYXN4MU1kSmp4bjVyWnRHeWVjeHhGalZpU2tIT0RndDBSTTl6QTg0ZkNSUlhwOXhaQWJiNkxENGJ6cW1HNnZoWUh1RnM0K0JhQUpMUUsvNWVqSWlSTXp3U2FvPSIsIlJ4aVhzM3F0YklVa3V1MEo1ZllkSWNtTVBoa3Nld0dJVHZvR3FRT2NHanhSc1JpMkwwWVp0YjRwby9xL2hobTlzdEdETDJYL1BndVhObHJGTER3UElVY3lUVURCS3JLWVNvRnY4ckFzeXdPdEg5anhxL1ZlMzQ1cE9CWU04U0Z0L1lNazlFZVhrMFZyZUwyU3RGUWo0bXhLOXEwWUloYUllV3pZMmFLMmtPUT0iXSwiY29tbWl0bWVudHMiOlsic002MmkyQng0ejR2K3grRjMzY3ZPVWlvMk5ZNm9xY29XaEhBejR6bzJxSE5yZ1Bhb0t4T1BZSGpDZFFQblVCUWljL2I4S1ZXRFZvMWYyRGxiVURsVC9DazFQb1dKZ3RpNXhGVVBnS2YvSlh3Y3NEKzVQdWJzbEVRZzFkNjdZRGVsVzRWVlVWSUtvcWd2VUN2QU5pSFF6djhuc0k3Y2N1THhDK0IxdVlsUVh5ejFrMTYrQkxCQ3hXSlpkcndDMG9jIiwicjJXdkdyNEtnbFRISVRvK0ZGdFRSUDFzN0ZSL29RdjNib1dUemJDbVhyQ3pybXlhL1lxOHA0ZVR3SXEyQXVwNnNMbTI5cDdxRWJBRml4alRER0NPNWF1QkxzL09kZHNmYmN4Sm0yMjROcnMwYmtsSmdMQkZidU1mYlNWUU5oQnhxNkxIV285TC9JTWM0cmZVbTZoZ3VhMlZ1ellHdGRTdSt1U2V6Y3o0ZGxQTzhNR2srSzB3NWpITUdpM3RuYlJOIiwiandJZ1RnWCtCSnlvd2hrUkpGNzdLZmNUTlphTjNCbElBZ09lWkVBTVBha1NtbkIxSGhENkdxSVpERHNtSUdkbm8rS0swRWVmajZUQldYamJGa01LTnhFdlY4MWFOS0U2eXlsSnhmZy9wR0ZTOCtPNTJ5UU5rYUhBQkh5QnovOWRzWEJkUXk2ZXhOVWd1Nm9wYkgzcm9RNXhtbTVNOVlKMlg0cnN1R3RhWDZHd3R1alVzN3J0YzBMcGhrSTJBVjhzIiwickZ5aHVTbWNqa1d4c0ZYRi9sOHZGQ1RnS0VUTmpIQW8xelMya3JOS2g4VWVxNFBqUWszWFRqUnc1VFI0bkYxMWo5dC94VndhQU1SeVg3RGdNKzdta2dCRWU3a29VdHlhRGRtaUtTd1liNDlmdFpIdE5SVWNFUDFEMDNyMitIYjJnVHZUeVhMN2lmdW5pVnlYektHdUdvSTYvREtXM0FheitJR2lOcnowb3FKQzR4WkRBYnNLSCszeFVjWGwraXU5IiwicXpDbC9GRWlDd01rU2wzbWlTaHRQNWx0WXRuYm1vUjBGYldqSEdiMG9XVk1LQ1o2YlZReTI2WmtQeXREMWN6VHQ2ZWV1K01id3pHNzZxQWxiMG52VDZJTXZIeDVpSDdnZFdGM0JtczZOdmZEcjkzajE1YlpsWHZqU2RaSXFUNVloUTFJWXk1TVY4YjRkS3BzWlE2Sm4zc3IwejVlK3lHc0Y2N2E1eFpwUk42R25jVUpZTVZDNkQ2TklzSVRDZ29EIiwicVcyWWZlN1I1cTBJQUFMdW1ScmRSNzVLSjNyTFkwT0EyeGoxRFRxaEl6eGk2Z2tvc1dQOHpFUmR3MEgxTm9mbmo5dEluSThMdTJNUTkrMjJEa1dPc1k1Z2QySjZ3V09NVGsxTE5QQkJQK1NRTm5QUW5oemkxQkJwVlpyZ1RrMkRna0huMFdoM0pyZnJEQ0xOYWtyazRUQXFwUUl4NS84WVNkdWw3U0ptb2xZNEErZDc5YmpYZzZ3dVdlV3RkWEVjIl19fX0SZwpSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohA86yP7PB+lQfPTovni16WF0Not8CNnv/jDSfI1pDey7vEgQKAggBGL2zAhIRCgsKBG9yYWkSAzYyNhCRmSYaQKZb8wDOXVf0HPJgtjaGePRQ8hive9oGHNxDcpzAQR9vFhI84Ex8yw0Lk5kOMZ6tL876xENZ7gzRSBMRtYsrvmY=',
        //     'Cs8RCswRCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSoxEKK29yYWkxdG53aHh2NWVobWgzem50eWZmdmcyMDZ3cHFzaHhwY3c2ODZzOWcSP29yYWkxcjdxd3RmcDd1YzBqc2VtYzhmcm5qZ3djNGdwc3B4bnVoZzdnamN2M3NsenVsMDhnZ2xkczY1dG5ycBqyEHsic2hhcmVfZGVhbGVyIjp7InNoYXJlIjp7InJvd3MiOlsiZjUzSHpSVXdlQTd2Y2RDbnM2ZnNiMFJMSDZnSG1VT2tnekNqbElKMmlRZ3JiK0VOakIwUmVMblhYMDdIbnhsdGUyWVNWZld3UDBteFhNSHFUbVFjbXpyUGlmeTBsRC9mZHUvZlFhR2VmK3I3VE9kZ2s0T1hjeC96c3RxNExkZE14ZEJtYitTUmcxM3Vnc1Z6bmxVQURVK29weS9EcVg0MkNVcldhejdIS25NPSIsIkNKeStOOTgxcGxhNHIvV2FRaDBnc1o3cjdJNXU1UFcvOXUyWEpyMzU1V2d4STVyZFVpTmwzWmZzYzF0QUVMYzRxbCtDN0htOTZBNTJSYWNwS04ydlNiQ1pJSEJYL1p5VXU1aEJOalpuMTBqQmJtU2c2Z0lkN0tNZ0ZQSVJBMVo5bUhLaWtjTDNGSE8vOUE0aUZhUVNsRWpxK3JyQjUrRE1mWkswck9DYzB5RT0iLCJtYVZWV2pmQmF6ZTUvbGxZQi90bXpWNHJqMnZ0NkFQd1JSK1VXeGhDeEk2czVwMmtRK0RtbzFydTZoenlDeHkzOHNLand3eTFEMDBLSEdrUmhJTlNFdVl3VjVheS9JVFA0YXRUb1lqRVUrVGVxNUM4TWQ5OHJLZSs1T2dlc215U0Uwcm9QQkhTTmREQitPQklVd0FIajArcjhmUEVORU9lZ3Y1OGM2SEJXNG89IiwiRVFEaS9mdFpSMXhRUmtKckVKaUhHU21ZcU1IYk1VZWllMEo4eEdteEMyUkwySlFST1A1VjMxVjVJS3JGYjlaNTJaRDFzTUMwcDhIUmQxanE5WWsrRDdVa3A5dnBPNURlajlSTnU2bmFUY2tUNGQyR1ZSbWV0dDlFbGpKZUFFd2IzTStCb0VTRTFwNGphN281OFVEc0xiSVErWUpzV3BBYU94cFBLSW4ySkZjPSIsIi9VV011eHIzb0UvTHR3NytIZVI1L1cwWTFDUHRGZ0RWUW5paGRjOC8yK0txK0FJcXI1WjJpdzhPWFc0ZlpaU1E5aW8zM0NHa2N0OHk1K3N6eEg0MnMzclV6S0RLM1c4L3VOVjVoZXRrTmF2KzA0d2FWbitJWG9vWmplSmlWYXlPTGIxSDRJUjhpakh6YVJQM2hrN2tDTnFqeEFFYVJCbzFzbi94YWtiOElGaz0iXSwiY29tbWl0bWVudHMiOlsick9MUEQwZE5iTVltenRJTTJtUisxWUtHa0U3cm9xTjJsR2N1WklVN0MrekIvWGJLOWVCb1N6VVd0SUhRa0JYSHJYQWhHak9IZGcwRURtZk1McmNNS2RoODFJL0tDOVg4THUxWlVLanpWWlJrU1IrVTJsVU1TQkxOb1BUU1ZLSW9wd3cwbVViQkUvUzZKR01NSXlpdnMxTnpmcjhYMFJsQ0Q0cGJtYVhsOGhHVTk0SkIzVGQwZkVSOCtoeS8wbEI5IiwialBWQTZ0b1NQYzEzTWNCWUhOQnA2Mm1uZG15UG16SENocHh5N0pkbFR4WWQzRUZzSEhBMXpwZERYODdrTEQ5V2xybjBpL3dUWjhMVVdWN1BrWHhTK2ZWZUVsankzZ1N3ejVCd0lSaXVyY2dwbitjbkI1Um5odHRwTGlwYi9pMjRsWWFheEdXZXlNNndYbStyTmpuZU1EL3BBdmg4V2FzbkVrYklyUUc3K3QxVGxPckN6a24vME4xZzNRcXB1SWVxIiwiZ3Z6ZDVUYUVta2tXblZ3dVYyWnl0QURNMndSUE4yYWpiOEhEdFJheFl0M0lWRm9iTFJzZ2p2ZnBYM3lFTjdURmtpSGY3TkRzdEwyamZ4YmNDbnlKMnlXRGNUd0h1TDdtOHJkTkU1blZ0R2tSdnJuUy9ldlJTd0dQZGVHUnBSUFlzRGxzcVlZZ2JGUUl6RDV2QVZHbkN3QjZhUklYa1hrYS84U21qT2pIVVh6U1VJamhYSHJUOGtkY3JVb1NQSDUrIiwicUxLM01wY0cwTWdtVjVVdVBKZXRNa1VYaXZBaTEzbkhRa2lNV1RHekJKMlBnblhkc2I2TVROMUxrSTRMYXd4MXBkbFhYd3U1SHd4Y2dLMEltNnJMa0V1UG8ybDRaa0NhbmY2YXhIK1dlM25RSkdKdFI4OUxLbVlvRnRLcnRiM3BoWkh1QmVvZm5qUStXWGRkbC9hZ0FHSUU1RTg1REl3ZmdGdklnS0l1SHozcG5vcWFMbXRKLzhFblhOeXJiWjhwIiwicldBYkRMa2l3VjdveHFWUW1COVE5OW4rQ3NsZnFERFl3N0Y1ZUdyMitKMlN6eG5UOTJCSWlwUnRBUlluMnhlMXI5K2Nha2dleUpDS2FhalNUcWorOG90QStCOFI4eU5tVjJlZmQ3aW5RRmt4QkZFWWd2c0pjN0lWZGtlZmFad2hoRjRuT3NWaGwxdCt1Szl6U200SkdoM1l6SVBtQjlEeUYyd1dWNWdpWDBIa0Rmd3QzZllSdjVOVXVuR2M3eE1DIiwibGc0a2l2VDF5NDRkR2ZEaE9jek4xd0FGNW1MTG5GaXpoMmV2blZUeDlKWmdid1gwMEpHMU02dW0rVFcxRTdSamg4NllsQ00rd2IyVXA5V00xSzhDczdEM3VhbVNLaDArV2pPcThnUDYrNTQyR3k5OE1PZzhpQUtMZEE1b2lVS3RzNExCUlVhZUpYK01GN243U01NZ1JyMC9qSDA1d25JS25CSjJWV0NqbEk1N1pEYk1FenZSQXFtTnJhM1RxQkdnIl19fX0SZwpSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohAlD+aKWKLSd+YI17swAY4mkTB9BcifS5frJtcLV6cL9FEgQKAggBGMivAhIRCgsKBG9yYWkSAzYyNhCRmSYaQIpND4y2n+t7bTS0TWEmQRfKijf0Dk5mFDxNFdWm4SeYF8z/BCbVQBql+gr+PTcwpPFXyY7Ony1MbCL2bNFobxM=',
        //     'Cr4CCpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMWF6dTBwZ2U0eXg2ajZzZDB0bjhuejR4OXZqN2w5a2dhd3cyNWd3CpwBCjcvY29zbW9zLmRpc3RyaWJ1dGlvbi52MWJldGExLk1zZ1dpdGhkcmF3RGVsZWdhdG9yUmV3YXJkEmEKK29yYWkxZnAzN3l4NTRyZ3RwZnlzbnNkNXZ4bGdxZ3k0N3N0Mjk3Y2owaGwSMm9yYWl2YWxvcGVyMTRydWR0ajBleWRwNzRqMGxscDB2MzljZDB0dG11dDlqZWcyZ2d1EmcKUQpGCh8vY29zbW9zLmNyeXB0by5zZWNwMjU2azEuUHViS2V5EiMKIQLiscas/M5U5+5QUCnnmvQ/oRxYg6nHEup0qCecpefUUhIECgIIfxjACBISCgwKBG9yYWkSBDEyODAQ9YQaGkD4je+W82MFsxqSMOOmF8PH7z2hNjdmxcy8B4ZGpITvnQi/cKDv/f1EridnKCbEw6084UzAucRSelBqQxSR5yrP',
        //     'Cs8RCswRCiQvY29zbXdhc20ud2FzbS52MS5Nc2dFeGVjdXRlQ29udHJhY3QSoxEKK29yYWkxdzl2eHF2OXVwcW5ucHYzN20yM2xnNTM2NTh3cHZrM3Q1MDNxbngSP29yYWkxcjdxd3RmcDd1YzBqc2VtYzhmcm5qZ3djNGdwc3B4bnVoZzdnamN2M3NsenVsMDhnZ2xkczY1dG5ycBqyEHsic2hhcmVfZGVhbGVyIjp7InNoYXJlIjp7InJvd3MiOlsiLzlRVndQZ01PSVhvQlpHd1F0RVZvZzFDL1V5cnc3N041SVVJTGVYRmwxQ0U0cnZwQlBHckNjamQ0QzdWMGd3anhxdWdEZUEzZE0xK0ZoQU81cG05WlNmdEQ2bGZTNGErZ0JHQms0aXFmMW9rTU94SytwaDhncENqWTJiOTFweWc3MC9xRDBlaFFHNUpSRFVPb1lBMGpBdlA1UkMvY2lsWWNOd203VWpwV05ZPSIsIkdsU0RWdGZMY1J2SnN3bVpPN083RTlIYnAwUFd4ejdrQjFrbjJYRmZpdUtlNlc5UXEvM0hJZTNWV3ZFQkY0N2NjV0l2OXBYZ29Vd2VsVnErd3E4MllpMGcwYVBoSlNFYlNvVWlxaVZkaFFEdjJtZnArOGdnSWZxQ3k2VFFpVkxnWStDYi9yTWhwN0pEdHh6dzJYalBoajVGZUw3TXY4U3dDaWVUYzNReG5Mbz0iLCJ0N3BReWpFdklNOUl4aGVQUGxoaFBySW5TVFU2bEZEYXhlY2RzbmFiQU9vbW8wQ1JWRC95aHVKS2x5MGJKZHhOYVg4dW81VmVtaktqRUdwSkxDTzhEWjFVZzNyNFVJd2ZDUnNGQitCdi9qMUJOSHd2MTFsWG5yUDlnNWE2T0U3eElBVFNyemV0UktNS21EcmxKRWI5TGhLMXc3VS9YdzZEUWdTT0ZGblA2OEk9IiwiMUJKdVVqMnlrcGhuYTRBWHdlRGxYZnlieVhIbGRoZXFpUGtRemJPNlRZZlpyaDNaQWdBT2Y3R2ZQK2J5d1cxWjNVR0xDdjNqa3diS0VxblVNZlFmcU5qeVdBS0VzWUVoRUVSOEloZEM1dXB5ZU5OQnQ4VWoyOENYYlM5MllEck5UbHR1dWtuaHRGU1F2WEU5VFppRkY2R2k0b1NibkdvcFlVZG5RUkJpQVV3PSIsIk9wU0dPN2J2Vks2UDRjYUIxdDV1SC8rM28xTnVWMTVDVGJOVGZid3lhcWZIR2d0UkFveUNOTlYwcFFqZDJZOHZMcEYvTURNV1dtTGZ6UzRWZWh5R1cvSytUdUx4NGgvMkJYTklVTnpsV3AzaFBJNDVlamJOZ2hxdXVxY3lKRmdPMGlpRlFSc0xUSVVZdnMrblk4SjJIbUQvNUQ5N2twZnJrU1ZITTR2bTBPMD0iXSwiY29tbWl0bWVudHMiOlsicGV1aEtDd2tFdkI5c2Nza3NLc0VCbk93L0IrMldZdFAzUytwV3lGbGswa3YzNXBIaXN4cmw5MHlnalVjTm4zeHJXZk1YL0FIb0ljSnBRcDlEampBRldoTFpla29mUFNQdGdTdnpnNGhmem5lVENHalI2aU5kdXZ2dXRlcGlXelJpTGZxWnlTM0hXaVVhaGcwMmt0azdNMHBmV09zT0tYNlZlcDJYUm9ObW1zWkNDcHlmdXM0bmM2M2c0Zk9jL3dTIiwickRIdCs2bUE2Y2p2cHhLL2Qrcm8rcnN1aWZRRUdWQ2VvYlAydGdzUnNJc1F2ejRuVUZmSTk0Y1grV1hpbjQ1OG9mTnhMTDJKZnYzSTVyZlFHWThLdDN4ZVRjMHlqWkRFSjJJZG52V0JsdjdreEExK2lPb1AxVDF0UlFBd1hBaU9vZkovY3JQTEhkYUFqRkpjQXY5K2VaQ3dqbndOcE1mRkEwc3QyT1U1aUxJamtZa0JoRHJTTGRFRVlhNjlRWFNYIiwicFAzUGhhdkdPUEVDZUpzeXRLYTgrM2dTTmRMbDZOMDdLYWkrYXNUMnpGaWhLSWZRRkU1SVhVMVc4VDNhby91ZGx2MUtmcWFZUUZhOGp6dElqZWhmVTgxSVlhZDljN1RrY2grbXp5cEd4NWRGd2ZteFVRYVRHZkQvb0dvSXhVaWxneWRoaGZtWGsydHZrRzlDNzF0R3lNbXlZK0VtWFEwUmVCekN2Yk93Qm54VkJQR1lUSWpTZnkza1czMnJla01iIiwib29BM1Z6YStRZ3BVQ3RJZXk1WU9Nc2t3enZuSkxqUzdBd096aUphREtjYTJHdm1Ici9ISUhaY1hsT0Y5U3kra2cvTGNMWkVWM2Z4ZHpDdUVXWFdMVzdhZXB5MlFGVW9Eb3hRUFRFanFGMXBqc0ZRR21WN1R0VEtHdEViSXFrdWp1UXVqSDNpYWp5dHV0YmNjdmNjdkZiNkY2alQ5MjBObnh6bnkyc3pJMzBzbklwbk45Qlo4WW81VkVaSUVKT2d5Iiwib0ZWRGxaaFlFSGwwUE5iT1pIWVhPZ2RKR01ibVNua1ljL0JMbWdXMGxncDhRT1lOSUlTUGlIWG9ucHZqNXcwWWhhWVFCMFcwYTRscEN1ZklLNk4zZGFpeWZ6am1aZDk2TXRZek9Ldit4NXpYaVM2L2dkaElwSDJSelFwTm9RTy9qekV1V3B2ejdha1JkMEcyQU1uMHNQdm9NTC9JeEpmT3FNQU5kbFJ5TE9hQ1d1c1dienhONnFZUmFmTGtEUWZtIiwicmJGQnVuSUtZNlp3Q0NUMWZ6ZWtBbS9PM000QXYrTEFPWVJraGZqSEYveTVNQmJtT0hhandSSkZRbTZIK1EyUGhtWlB5TmM4cWRsNXhBWlZrOWRpSDNwbXdHeEVLTWR5TGd3SFZSUVd6b2UvZ0hJYXUvSlNrUzJBUzlwS3hvL2VycWM2eWc0UUJiYzNGMG9hOE5GTGxvVUlNbnJHb0RSNDU4WFlodlp4VkJZK3NlazlzTUJZdnlZWnl4ZU1qcWV6Il19fX0SZwpSCkYKHy9jb3Ntb3MuY3J5cHRvLnNlY3AyNTZrMS5QdWJLZXkSIwohA/1WY1tP6UNAbldg7WfXxHXRzCz8xHa50sv7u1TkV2Q5EgQKAggBGIi0AhIRCgsKBG9yYWkSAzYyNhCRmSYaQKoldEqz9zFP/3b/GJqU7F+qp3C8qG8Vy3sYq2uRCQp7IUNUMWyR2LeTVkqQg/GeJq3Fjip76t409+aywvEipd8=',
        // ];
        // const leaves = txs.map((tx) => createHash('sha256').update(Buffer.from(tx, 'base64')).digest());

        // const choosenIndex = 1;
        // const decodedTx = decodeTxRaw(Buffer.from(txs[choosenIndex], 'base64'));
        // const registry = new Registry(defaultRegistryTypes);
        // registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);
        // const rawMsg = decodedTx.body.messages.map((msg) => {
        //     return {
        //         typeUrl: msg.typeUrl,
        //         value: registry.decode(msg),
        //     };
        // });

        // const decodedTxWithRawMsg: any = {
        //     ...decodedTx,
        //     body: {
        //         messages: rawMsg,
        //         memo: decodedTx.body.memo,
        //         timeoutHeight: decodedTx.body.timeoutHeight,
        //         extensionOptions: decodedTx.body.extensionOptions,
        //         nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
        //     },
        // };

        // result = await lightClient.sendVerifyReceipt(
        //     user.getSender(),
        //     decodedTxWithRawMsg,
        //     leaves,
        //     leaves[choosenIndex],
        //     {
        //         value: toNano('0.5'),
        //     },
        // );
        // expect(result.transactions[1]).toHaveTransaction({
        //     success: true,
        //     op: Opcodes.verify_receipt,
        // });
    });
});
