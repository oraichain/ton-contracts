import {
    Blockchain,
    printTransactionFees,
    SandboxContract,
    TreasuryContract,
    prettyLogTransactions,
} from '@ton/sandbox';
import { Address, beginCell, Cell, SendMode, toNano } from '@ton/core';
import { LightClient, LightClientOpcodes } from '../wrappers/LightClient';
import { WhitelistDenomOpcodes } from '../wrappers/WhitelistDenom';
import { BridgeAdapterOpcodes } from '../wrappers/BridgeAdapter';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

import { BridgeAdapter, Src } from '../wrappers/BridgeAdapter';
import { JettonMinter } from '../wrappers/JettonMinter';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { createHash } from 'crypto';
import { decodeTxRaw, Registry } from '@cosmjs/proto-signing';
import { defaultRegistryTypes } from '@cosmjs/stargate';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';
import { getMerkleProofs } from '../wrappers/TestClient';
import { JettonWallet } from '../wrappers/JettonWallet';
import { crc32 } from '../crc32';
import {
    createUpdateClientData,
    deserializeCommit,
    deserializeHeader,
    deserializeValidator,
    getSpecCell,
} from '../wrappers/utils';
import { calculateIbcTimeoutTimestamp } from '../scripts/utils';
import { LightClientMaster, LightClientMasterOpcodes } from '../wrappers/LightClientMaster';
import { iavlSpec, tendermintSpec } from '../wrappers/specs';
import { ProofSpec } from 'cosmjs-types/cosmos/ics23/v1/proofs';

describe('BridgeAdapter', () => {
    let lightClientMasterCode: Cell;
    let bridgeAdapterCode: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    let whitelistDenomCode: Cell;

    const bridgeWasmAddress = 'orai1zn9x7rumutjcgv6zy6y59ue3wh8hxjlayllldsg9hj3xscxf0kjsrk9hcp';
    const updateBlock = async (
        blockNumber: number,
        relayer: SandboxContract<TreasuryContract>,
    ): Promise<string[]> => {
        const { header, lastCommit, validators, txs } = await createUpdateClientData(
            'https://rpc.orai.io',
            blockNumber,
        );

        let result = await lightClientMaster.sendVerifyBlockHash(
            relayer.getSender(),
            {
                header: deserializeHeader(header),
                validators: validators.map(deserializeValidator),
                commit: deserializeCommit(lastCommit),
            },
            { value: toNano('10') },
        );
        printTransactionFees(result.transactions);
        console.log(`verify_block_hash:`, LightClientMasterOpcodes.verify_block_hash);
        expect(result.transactions).toHaveTransaction({
            success: true,
            op: LightClientMasterOpcodes.verify_block_hash,
        });

        console.log(
            'finalize_verify_light_client',
            LightClientMasterOpcodes.finalize_verify_light_client,
        );
        expect(result.transactions).toHaveTransaction({
            success: true,
            op: LightClientMasterOpcodes.finalize_verify_light_client,
        });

        console.log('Finished: ', {
            trustedHeight: await lightClientMaster.getTrustedHeight(),
            chainId: await lightClientMaster.getChainId(),
        });

        return txs.map((item) => Buffer.from(item, 'hex').toString('base64'));
    };
    beforeAll(async () => {
        lightClientMasterCode = await compile('LightClientMaster');
        bridgeAdapterCode = await compile('BridgeAdapter');
        jettonWalletCode = await compile('JettonWallet');
        jettonMinterCode = await compile('JettonMinter');
        whitelistDenomCode = await compile('WhitelistDenom');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let lightClientMaster: SandboxContract<LightClientMaster>;
    let bridgeAdapter: SandboxContract<BridgeAdapter>;
    let jettonMinterSrcCosmos: SandboxContract<JettonMinter>;
    let jettonMinterSrcTon: SandboxContract<JettonMinter>;
    let bridgeJettonWalletSrcTon: SandboxContract<JettonWallet>;
    let usdtMinterContract: SandboxContract<JettonMinter>;
    let usdtDeployerJettonWallet: SandboxContract<JettonWallet>;
    let usdtDeployer: SandboxContract<TreasuryContract>;
    let whitelistDenom: SandboxContract<WhitelistDenom>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        blockchain.verbosity = {
            ...blockchain.verbosity,
            // vmLogs: 'vm_logs_gas',
        };
        // SET UP WHITELIST DENOM
        // THIS USDT token will be used for case we want to send USDT to Oraichain from TON
        usdtDeployer = await blockchain.treasury('usdt_deployer');
        usdtMinterContract = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: usdtDeployer.address,
                    content: beginCell().storeBuffer(Buffer.from('USDT TOKEN')).endCell(),
                    jettonWalletCode: jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );
        const deployUsdtMinterResult = await usdtMinterContract.sendDeploy(
            usdtDeployer.getSender(),
            {
                value: toNano('1000'),
            },
        );

        expect(deployUsdtMinterResult.transactions).toHaveTransaction({
            from: usdtDeployer.address,
            to: usdtMinterContract.address,
            deploy: true,
            success: true,
        });
        await usdtMinterContract.sendMint(
            usdtDeployer.getSender(),
            {
                toAddress: usdtDeployer.address,
                jettonAmount: toNano(123456),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        const usdtWalletAddress = await usdtMinterContract.getWalletAddress(usdtDeployer.address);
        const usdtJettonWallet = JettonWallet.createFromAddress(usdtWalletAddress);
        usdtDeployerJettonWallet = blockchain.openContract(usdtJettonWallet);
        expect((await usdtDeployerJettonWallet.getBalance()).amount).toBe(123456000000000n);

        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('user', { balance: 0n });

        // SET UP WHITELIST DENOM CONTRACT
        whitelistDenom = blockchain.openContract(
            WhitelistDenom.createFromConfig(
                {
                    admin: deployer.address,
                },
                whitelistDenomCode,
            ),
        );
        const deployWhitelistResult = await whitelistDenom.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );

        expect(deployWhitelistResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: whitelistDenom.address,
            deploy: true,
            success: true,
        });

        // SET UP LIGHT CLIENT
        const specs = [iavlSpec, tendermintSpec];
        let cellSpecs;
        for (let i = specs.length - 1; i >= 0; i--) {
            const innerCell = getSpecCell(specs[i] as ProofSpec);
            if (!cellSpecs) {
                cellSpecs = beginCell()
                    .storeRef(beginCell().endCell())
                    .storeSlice(innerCell.beginParse())
                    .endCell();
            } else {
                cellSpecs = beginCell()
                    .storeRef(cellSpecs)
                    .storeSlice(innerCell.beginParse())
                    .endCell();
            }
        }
        lightClientMaster = blockchain.openContract(
            LightClientMaster.createFromConfig(
                {
                    chainId: 'Oraichain',
                    lightClientCode: await compile('LightClient'),
                    trustedHeight: 0,
                    trustingPeriod: 14 * 86400,
                    specs: cellSpecs!,
                },
                lightClientMasterCode,
            ),
        );

        const deployLightClientResult = await lightClientMaster.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );

        expect(deployLightClientResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClientMaster.address,
            deploy: true,
            success: true,
        });

        // BRIDGE_WASM_CONTRACT_HARD_CODING_ORAIX_CONTRACT
        // TODO: CHANGE TO BRIDGE WASM CONTRACT
        bridgeAdapter = blockchain.openContract(
            BridgeAdapter.createFromConfig(
                {
                    light_client_master: lightClientMaster.address,
                    bridge_wasm_smart_contract: bridgeWasmAddress,
                    jetton_wallet_code: jettonWalletCode,
                    whitelist_denom: whitelistDenom.address,
                },
                bridgeAdapterCode,
            ),
        );

        const deployBridgeResult = await bridgeAdapter.sendDeploy(deployer.getSender(), {
            value: toNano('0.05'),
        });

        expect(deployBridgeResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            deploy: true,
            success: true,
        });

        jettonMinterSrcCosmos = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: bridgeAdapter.address,
                    content: bridgeAdapterCode,
                    jettonWalletCode: jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );

        const deployJettonMinterResult = await jettonMinterSrcCosmos.sendDeploy(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
        );

        expect(deployJettonMinterResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinterSrcCosmos.address,
            deploy: true,
            success: true,
        });

        jettonMinterSrcTon = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: deployer.address,
                    content: beginCell().endCell(),
                    jettonWalletCode: jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );

        const deployJettonMinterSrcTon = await jettonMinterSrcTon.sendDeploy(deployer.getSender(), {
            value: toNano('0.05'),
        });

        expect(deployJettonMinterSrcTon.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinterSrcTon.address,
            deploy: true,
            success: true,
        });

        await jettonMinterSrcTon.sendMint(
            deployer.getSender(),
            {
                toAddress: bridgeAdapter.address,
                jettonAmount: toNano(1000000000),
                amount: toNano(0.5), // deploy fee
            },
            {
                queryId: 0,
                value: toNano(1),
            },
        );

        const bridgeJettonWallet = await jettonMinterSrcTon.getWalletAddress(bridgeAdapter.address);
        const bridgeJettonWalletBalance = JettonWallet.createFromAddress(bridgeJettonWallet);
        bridgeJettonWalletSrcTon = blockchain.openContract(bridgeJettonWalletBalance);

        expect((await bridgeJettonWalletSrcTon.getBalance()).amount).toBe(toNano(1000000000));

        await deployer.getSender().send({
            to: bridgeAdapter.address,
            value: toNano('1000'),
        });

        await deployer.getSender().send({
            to: jettonMinterSrcCosmos.address,
            value: toNano('10'),
        });

        await deployer.getSender().send({
            to: jettonMinterSrcTon.address,
            value: toNano('10'),
        });

        await deployer.getSender().send({
            to: bridgeJettonWalletSrcTon.address,
            value: toNano('10'),
        });
    });

    it('successfully deploy BridgeAdapter contract', async () => {
        console.log('bridgeAdapterCode', bridgeAdapterCode.toBoc().toString('hex'));
        console.log('successfully deploy');
        console.log(
            'msg_prefix',
            Buffer.from('{"submit_bridge_to_ton_info":{"data":').toString('hex'),
        );
        const stack = await bridgeAdapter.getBridgeData();
        expect(stack.readCell().toBoc()).toEqual(
            beginCell().storeAddress(lightClientMaster.address).endCell().toBoc(),
        );
        expect(stack.readCell().toBoc()).toEqual(
            beginCell().storeBuffer(Buffer.from(bridgeWasmAddress)).endCell().toBoc(),
        );
        expect(stack.readCell().toBoc()).toEqual(jettonWalletCode.toBoc());
    });

    it('should log data persist data to test', async () => {
        console.log({
            jettonMinterSrcCosmos: jettonMinterSrcCosmos.address.toString(),
            jettonMinterSrcTon: jettonMinterSrcTon.address.toString(),
            user: user.address,
        });
    });

    it('try bridge ton to cosmos', async () => {
        const bridger = await blockchain.treasury('bridger');
        let result = await bridgeAdapter.sendBridgeTon(
            bridger.getSender(),
            {
                amount: toNano(5),
                memo: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('channel-1')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(
                        beginCell()
                            .storeBuffer(Buffer.from('orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx'))
                            .endCell(),
                    )
                    .endCell(),
                timeout: BigInt(calculateIbcTimeoutTimestamp(3600)),
            },
            {
                value: toNano(7),
            },
        );
        printTransactionFees(result.transactions);
    });

    // it('Test send jetton token from ton to bridge adapter', async () => {
    //     let result = await whitelistDenom.sendSetDenom(
    //         deployer.getSender(),
    //         { denom: usdtMinterContract.address, permission: true, isRootFromTon: true },
    //         {
    //             value: toNano(0.1),
    //         },
    //     );
    //     expect(result.transactions).toHaveTransaction({
    //         op: WhitelistDenomOpcodes.setDenom,
    //         success: true,
    //     });

    //     const senderBeforeBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
    //         .balance;
    //     result = await usdtDeployerJettonWallet.sendTransfer(
    //         usdtDeployer.getSender(),
    //         {
    //             fwdAmount: toNano(1),
    //             jettonAmount: toNano(333),
    //             jettonMaster: usdtMinterContract.address,
    //             toAddress: bridgeAdapter.address,
    //             timeout: BigInt(calculateIbcTimeoutTimestamp(3600)),
    //             memo: beginCell()
    //                 .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
    //                 .storeRef(beginCell().storeBuffer(Buffer.from('channel-1')).endCell())
    //                 .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
    //                 .storeRef(
    //                     beginCell()
    //                         .storeBuffer(Buffer.from('orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx'))
    //                         .endCell(),
    //                 )
    //                 .endCell(),
    //         },
    //         {
    //             value: toNano(2),
    //             queryId: 0,
    //         },
    //     );
    //     printTransactionFees(result.transactions);

    //     console.log(
    //         'Bridge adapter balance:',
    //         (await blockchain.getContract(bridgeAdapter.address)).balance,
    //     );
    //     expect(result.transactions).toHaveTransaction({
    //         op: BridgeAdapterOpcodes.callbackDenom,
    //         success: true,
    //     });
    //     const senderAfterBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
    //         .balance;
    //     expect(senderBeforeBalance - senderAfterBalance).toBeLessThanOrEqual(toNano(0.1));
    // });

    // it('Test send jetton token from cosmos to bridge adapter', async () => {
    //     const sendTokenOnCosmos = async () => {
    //         const relayer = await blockchain.treasury('relayer');
    //         const height = 25370955;
    //         const txs = await updateBlock(height, relayer);
    //         const chosenIndex = 0; // hardcode the txs with custom memo
    //         const leaves = txs.map((tx: string) =>
    //             createHash('sha256').update(Buffer.from(tx, 'base64')).digest(),
    //         );
    //         const decodedTx = decodeTxRaw(Buffer.from(txs[chosenIndex], 'base64'));

    //         const registry = new Registry(defaultRegistryTypes);
    //         registry.register(decodedTx.body.messages[0].typeUrl, MsgExecuteContract);
    //         const rawMsg = decodedTx.body.messages.map((msg) => {
    //             return {
    //                 typeUrl: msg.typeUrl,
    //                 value: registry.decode(msg),
    //             };
    //         });

    //         const decodedTxWithRawMsg: any = {
    //             ...decodedTx,
    //             body: {
    //                 messages: rawMsg,
    //                 memo: decodedTx.body.memo,
    //                 timeoutHeight: decodedTx.body.timeoutHeight,
    //                 extensionOptions: decodedTx.body.extensionOptions,
    //                 nonCriticalExtensionOptions: decodedTx.body.nonCriticalExtensionOptions,
    //             },
    //         };

    //         const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(
    //             Address.parse('EQABEq658dLg1KxPhXZxj0vapZMNYevotqeINH786lpwwSnT'),
    //         );
    //         const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
    //         const wallet = blockchain.openContract(userJettonWalletBalance);
    //         console.log(
    //             BigInt(
    //                 '0x' +
    //                     beginCell().storeAddress(wallet.address).endCell().hash().toString('hex'),
    //             ),
    //         );

    //         const { branch: proofs, positions } = getMerkleProofs(leaves, leaves[chosenIndex]);

    //         let result = await bridgeAdapter.sendBridgeRecvPacket(
    //             relayer.getSender(),
    //             {
    //                 height: BigInt(height),
    //                 tx: decodedTxWithRawMsg,
    //                 proofs,
    //                 positions,
    //                 data: beginCell()
    //                     .storeBuffer(
    //                         Buffer.from(
    //                             '000000000001000080002255D73E3A5C1A9589F0AECE31E97B54B261AC3D7D16D4F1068FDF9D4B4E1830038017688F522FA246F114C343D021A46D449E0CBBDC4BF05276879D1FD7F3C75C000000000000000000000009502F9000139517D2',
    //                             'hex',
    //                         ),
    //                     )
    //                     .endCell(),
    //             },
    //             {
    //                 value: toNano('6'),
    //             },
    //         );

    //         expect(result.transactions).toHaveTransaction({
    //             op: LightClientOpcodes.verify_receipt,
    //             success: true,
    //         });

    //         expect((await wallet.getBalance()).amount).toBe(toNano(10));
    //     };

    //     await sendTokenOnCosmos();

    //     const userContract = await blockchain.treasury('user', {
    //         balance: 0n,
    //     });

    //     await deployer.send({
    //         to: userContract.address,
    //         value: toNano(3),
    //         sendMode: SendMode.PAY_GAS_SEPARATELY,
    //     });

    //     const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(
    //         userContract.address, // this is "user" treasury
    //     );
    //     const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
    //     const wallet = blockchain.openContract(userJettonWalletBalance);

    //     let result = await whitelistDenom.sendSetDenom(
    //         deployer.getSender(),
    //         {
    //             denom: jettonMinterSrcCosmos.address,
    //             permission: true,
    //             isRootFromTon: false,
    //         },
    //         {
    //             value: toNano(0.1),
    //         },
    //     );
    //     expect(result.transactions).toHaveTransaction({
    //         op: WhitelistDenomOpcodes.setDenom,
    //         success: true,
    //     });

    //     expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(10000000000n);
    //     result = await wallet.sendTransfer(
    //         userContract.getSender(),
    //         {
    //             fwdAmount: toNano(1),
    //             jettonAmount: toNano(5),
    //             jettonMaster: jettonMinterSrcCosmos.address,
    //             toAddress: bridgeAdapter.address,
    //             timeout: BigInt(calculateIbcTimeoutTimestamp(3600)),
    //             memo: beginCell()
    //                 .storeRef(beginCell().storeBuffer(Buffer.from('this is just a test')).endCell())
    //                 .endCell(),
    //         },
    //         {
    //             value: toNano(2),
    //             queryId: 0,
    //         },
    //     );
    //     printTransactionFees(result.transactions);

    //     expect(result.transactions).toHaveTransaction({
    //         op: BridgeAdapterOpcodes.callbackDenom,
    //         success: true,
    //     });
    //     expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(5000000000n);
    // });
});
