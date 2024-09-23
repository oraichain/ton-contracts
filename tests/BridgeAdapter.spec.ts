import {
    Blockchain,
    printTransactionFees,
    SandboxContract,
    TreasuryContract,
    internal,
    prettyLogTransactions,
} from '@ton/sandbox';
import {
    Address,
    beginCell,
    Cell,
    Dictionary,
    internal as internal_relaxed,
    loadTransaction,
    SendMode,
    toNano,
} from '@ton/core';
import {
    MultisigConfig,
    Multisig,
    TransferRequest,
} from '@oraichain/ton-multiowner/dist/wrappers/Multisig';
import { Order } from '@oraichain/ton-multiowner/dist/wrappers/Order';
import { Op } from '@oraichain/ton-multiowner/dist/wrappers/Constants';
import * as MultisigBuild from '@oraichain/ton-multiowner/dist/build/Multisig.compiled.json';
import * as OrderRawBuild from '@oraichain/ton-multiowner/dist/build/Order.compiled.json';

import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import {
    Ack,
    BridgeAdapter,
    BridgeAdapterError,
    BridgeAdapterOpcodes,
    Paused,
    TokenOrigin,
} from '../wrappers/BridgeAdapter';
import { JettonMinter } from '../wrappers/JettonMinter';
import { WhitelistDenom, WhitelistDenomOpcodes } from '../wrappers/WhitelistDenom';
import { JettonWallet } from '../wrappers/JettonWallet';
import {
    createUpdateClientData,
    deserializeCommit,
    deserializeHeader,
    deserializeValidator,
    getAckPacketProofs,
    getExistenceProofSnakeCell,
    getPacketProofs,
    getSpecCell,
} from '../wrappers/utils';
import { LightClientMaster, LightClientMasterOpcodes } from '../wrappers/LightClientMaster';
import { iavlSpec, tendermintSpec } from '../wrappers/specs';
import { ExistenceProof, ProofSpec } from 'cosmjs-types/cosmos/ics23/v1/proofs';
import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
// Cosmos to TON import
import * as lightClientToTonSrcCosmos from './fixtures/lightClientToTonSrcCosmos.json';
import * as lightClientToTonSrcTon from './fixtures/lightClientToTonSrcTon.json';
import * as lightClientToTonTether from './fixtures/lightClientToTonTether.json';
import * as lightClientBridgeToTonTonNative from './fixtures/lightClientBridgeToTonTonNative.json';
import * as bridgeToTonProofsSrcCosmos from './fixtures/bridgeToTonSrcCosmosProofs.json';
import * as bridgeToTonProofsSrcTon from './fixtures/bridgeToTonSrcTonProofs.json';
import * as bridgeToTonProofsTether from './fixtures/bridgeToTonTether.json';
import * as bridgeToTonProofsTon from './fixtures/bridgeToTonTonNative.json';
import * as multiplePacketProofs from './fixtures/multiplePacketProofs.json';

import * as lightClient_28353959 from './fixtures/light_client_28353959.json';
import * as lightClientAckTonJettonTimeout from './fixtures/lightClientAckTonJettonTimeout.json';
import * as lightClient_28359916 from './fixtures/light_client_28359916.json';
import * as sendToCosmosTimeoutProof from './fixtures/sendToCosmosTimeoutProof.json';
import * as sendToCosmosTimeoutOtherProof from './fixtures/sendToCosmosTimeoutOtherProof.json';

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fromBech32, toAscii, toBech32 } from '@cosmjs/encoding';
import { QueryClient } from '@cosmjs/stargate';
import { SerializedCommit, SerializedHeader, SerializedValidator } from '../wrappers/@types';
import { calculateIbcTimeoutTimestamp } from '../scripts/utils';
import { TetherMinter } from '../wrappers/TetherMinter';
import { DEFAULT_BRIDGE_ADAPTER_BOC, DEFAULT_LIGHT_CLIENT_MASTER_BOC } from './constant';

describe('Cosmos->Ton BridgeAdapter', () => {
    let lightClientMasterCode: Cell;
    let bridgeAdapterCode: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    let whitelistDenomCode: Cell;
    let tetherMinterCode: Cell;
    let tetherWalletCode: Cell;

    const bridgeWasmAddress = 'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7';
    const localSenderBech32Address = fromBech32('orai1w0emvx75v79x2rm0afcw7sn8hqt5f4fhtd3pw7').data;
    const updateBlock = async (
        {
            header,
            validators,
            lastCommit,
        }: {
            header: SerializedHeader;
            validators: SerializedValidator[];
            lastCommit: SerializedCommit;
        },
        relayer: SandboxContract<TreasuryContract>,
    ) => {
        let result = await lightClientMaster.sendVerifyBlockHash(
            relayer.getSender(),
            {
                header: deserializeHeader(header),
                validators: validators.map(deserializeValidator),
                commit: deserializeCommit(lastCommit),
            },
            {
                value: toNano('10'),
            },
        );
        printTransactionFees(result.transactions);
        expect(result.transactions).toHaveTransaction({
            op: LightClientMasterOpcodes.verify_block_hash,
            success: true,
        });
        expect(await lightClientMaster.getTrustedHeight()).toBe(header.height);
    };

    beforeAll(async () => {
        lightClientMasterCode = Cell.fromBoc(
            Buffer.from(DEFAULT_LIGHT_CLIENT_MASTER_BOC, 'base64'),
        )[0];
        bridgeAdapterCode = Cell.fromBoc(Buffer.from(DEFAULT_BRIDGE_ADAPTER_BOC, 'base64'))[0];
        jettonWalletCode = await compile('JettonWallet');
        jettonMinterCode = await compile('JettonMinter');
        whitelistDenomCode = await compile('WhitelistDenom');
        tetherMinterCode = await compile('TetherMinter');
        tetherWalletCode = await compile('TetherWallet');
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
    let tetherMinterContract: SandboxContract<TetherMinter>;
    let bridgeTetherWallet: SandboxContract<JettonWallet>;
    let tetherDeployer: SandboxContract<TreasuryContract>;
    let whitelistDenom: SandboxContract<WhitelistDenom>;

    // packet info
    const transferAmount = 10000000n;
    const timeout = 2039929529;
    beforeEach(async () => {
        blockchain = await Blockchain.create({});
        blockchain.verbosity = {
            ...blockchain.verbosity,
            // vmLogs: 'vm_logs_gas',
        };
        blockchain.now = 1724673151;
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

        let result = await usdtMinterContract.sendMint(
            usdtDeployer.getSender(),
            {
                toAddress: usdtDeployer.address,
                jettonAmount: toNano(123456),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        printTransactionFees(result.transactions);

        const usdtWalletAddress = await usdtMinterContract.getWalletAddress(usdtDeployer.address);
        const usdtJettonWallet = JettonWallet.createFromAddress(usdtWalletAddress);
        usdtDeployerJettonWallet = blockchain.openContract(usdtJettonWallet);
        expect((await usdtDeployerJettonWallet.getBalance()).amount).toBe(123456000000000n);

        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('user', { balance: toNano(0) });
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
                    adminAddress: deployer.address,
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
                    paused: Paused.UNPAUSED,
                    admin: deployer.address,
                },
                bridgeAdapterCode,
            ),
        );

        const deployBridgeResult = await bridgeAdapter.sendDeploy(deployer.getSender(), {
            value: toNano('1'),
        });
        expect(deployBridgeResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            deploy: true,
            success: true,
        });
        printTransactionFees(deployBridgeResult.transactions);

        jettonMinterSrcCosmos = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: deployer.address,
                    content: beginCell().storeUint(1, 8).endCell(),
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
        await jettonMinterSrcCosmos.sendChangeAdmin(deployer.getSender(), bridgeAdapter.address);

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
                    content: beginCell().storeUint(2, 8).endCell(),
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

        // SET UP TETHER CONTRACT

        tetherDeployer = await blockchain.treasury('tether_deployer');
        tetherMinterContract = blockchain.openContract(
            TetherMinter.createFromConfig(
                {
                    adminAddress: tetherDeployer.address,
                    content: beginCell().storeBuffer(Buffer.from('TETHER USDT TOKEN')).endCell(),
                    jettonWalletCode: tetherWalletCode,
                },
                tetherMinterCode,
            ),
        );
        const deployTetherMinterResult = await tetherMinterContract.sendDeploy(
            tetherDeployer.getSender(),
            {
                value: toNano('1000'),
            },
        );

        expect(deployTetherMinterResult.transactions).toHaveTransaction({
            from: tetherDeployer.address,
            to: tetherMinterContract.address,
            deploy: true,
            success: true,
        });
        result = await tetherMinterContract.sendMint(
            tetherDeployer.getSender(),
            {
                toAddress: bridgeAdapter.address,
                jettonAmount: toNano(333333),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        printTransactionFees(result.transactions);

        const tetherWalletAddress = await tetherMinterContract.getWalletAddress(
            bridgeAdapter.address,
        );
        const tetherJettonWallet = JettonWallet.createFromAddress(tetherWalletAddress);
        bridgeTetherWallet = blockchain.openContract(tetherJettonWallet);
        expect((await bridgeTetherWallet.getBalance()).amount).toBe(333333000000000n);

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

        // Upgrade bridge adapter and light client master
        const newBridgeAdapterCode = await compile('BridgeAdapter');
        const upgradeBridgeAdapterTx = await bridgeAdapter.sendUpgradeContract(
            deployer.getSender(),
            newBridgeAdapterCode,
            {
                value: toNano('0.1'),
            },
        );
        expect(upgradeBridgeAdapterTx.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            success: true,
            op: BridgeAdapterOpcodes.upgradeContract,
        });

        const newLightClientMasterCode = await compile('LightClientMaster');
        const upgradeLightClientMasterTx = await lightClientMaster.sendUpgradeContract(
            deployer.getSender(),
            newLightClientMasterCode,
            {
                value: toNano('0.1'),
            },
        );
        expect(upgradeLightClientMasterTx.transactions).toHaveTransaction({
            from: deployer.address,
            to: lightClientMaster.address,
            success: true,
            op: LightClientMasterOpcodes.upgrade_contract,
        });
    });

    xit('successfully deploy BridgeAdapter contract', async () => {
        const stack = await bridgeAdapter.getBridgeData();
        const cell = stack.readCell();
        const {
            lightClientMasterAddress,
            adminAddress,
            whitelistDenomAddress,
            next_packet_seq,
            paused,
            bridgeWasmBech32,
        } = BridgeAdapter.parseBridgeDataResponse(cell);
        expect(lightClientMasterAddress.equals(lightClientMaster.address)).toBeTruthy();
        expect(adminAddress.equals(deployer.address)).toBeTruthy();
        expect(whitelistDenomAddress.equals(whitelistDenom.address)).toBeTruthy();
        expect(next_packet_seq).toBe(1);
        expect(paused).toBe(Paused.UNPAUSED);
        expect(bridgeWasmBech32).toEqual(bridgeWasmAddress);
    });

    xit('should log data persist data to test', async () => {
        const bridgeJettonWalletSrcCosmos = await jettonMinterSrcCosmos.getWalletAddress(
            bridgeAdapter.address,
        );
        console.log({
            jettonMinterSrcCosmos: jettonMinterSrcCosmos.address,
            jettonMinterSrcTon: jettonMinterSrcTon.address,
            bridgeJettonWalletSrcTon: bridgeJettonWalletSrcTon.address,
            bridgeJettonWalletSrcCosmos: bridgeJettonWalletSrcCosmos.toString(),
            bridgeTetherWallet: bridgeTetherWallet.address,
            user: user.address,
            srcCosmos: TokenOrigin.COSMOS,
            srcTon: TokenOrigin.TON,
        });
    });

    it('should send jetton token_origin::cosmos to TON', async () => {
        const proveHeight = 31113432;
        const provenHeight = proveHeight + 1;
        const seq = 17;
        console.log({
            remoteDenom: jettonMinterSrcCosmos.address,
            remoteReceiver: user.address,
            localSender: Buffer.from(
                fromBech32('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c').data,
            ).toString('base64'),
        });

        const packet = beginCell()
            .storeUint(0xae89be5b, 32) // op
            .storeUint(seq, 64) // seq
            .storeUint(TokenOrigin.COSMOS, 32) // token_origin
            .storeUint(transferAmount, 128) // remote_amount
            .storeUint(timeout, 64) // timeout_timestamp
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcCosmos.address) // remote_denom
            .storeRef(
                //  local_sender_ref
                beginCell()
                    .storeUint(localSenderBech32Address.length, 8)
                    .storeBuffer(Buffer.from(localSenderBech32Address))
                    .endCell(),
            )
            .endCell();
        console.log(BigInt('0x' + packet.hash().toString('hex')));

        // #region script fetch data
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getPacketProofs(
        //     queryClient,
        //     'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //     proveHeight,
        //     BigInt(seq),
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonSrcCosmosProofs.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     provenHeight,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/lightClientToTonSrcCosmos.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        // #endregion;
        await updateBlock(lightClientToTonSrcCosmos as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsSrcCosmos)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight,
            },
            { value: toNano('0.7') },
        );

        printTransactionFees(sendRecvResult.transactions);
        const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(user.address);
        const wallet = blockchain.openContract(JettonWallet.createFromAddress(userJettonWallet));
        const balance = await wallet.getBalance();
        expect(balance.amount).toBe(transferAmount);
    });

    it('should send jetton token_origin::ton to TON', async () => {
        console.log({
            jettonMinterSrcTon: jettonMinterSrcTon.address,
            bridgeJettonWalletSrcTon: bridgeJettonWalletSrcTon.address,
        });
        const proveHeight = 31113433;
        const provenHeight = proveHeight + 1;
        const seq = 18;
        const packet = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(seq, 64)
            .storeUint(TokenOrigin.TON, 32)
            .storeUint(transferAmount, 128)
            .storeUint(timeout, 64)
            .storeAddress(user.address)
            .storeAddress(bridgeJettonWalletSrcTon.address)
            .storeRef(
                beginCell()
                    .storeUint(localSenderBech32Address.length, 8)
                    .storeBuffer(Buffer.from(localSenderBech32Address))
                    .endCell(),
            )
            .endCell();
        const packet_cell = packet.hash();
        console.log(packet.hash().toString('base64'));
        console.log(BigInt('0x' + packet_cell.toString('hex')));

        //#region script fetch data
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getPacketProofs(
        //     queryClient,
        //     'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //     proveHeight,
        //     BigInt(seq),
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonSrcTonProofs.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     provenHeight,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/lightClientToTonSrcTon.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion

        await updateBlock(lightClientToTonSrcTon as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsSrcTon)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight,
            },
            { value: toNano('0.7') },
        );

        printTransactionFees(sendRecvResult.transactions);
        const userJettonWallet = await jettonMinterSrcTon.getWalletAddress(user.address);
        const wallet = blockchain.openContract(JettonWallet.createFromAddress(userJettonWallet));
        const balance = await wallet.getBalance();
        expect(balance.amount).toBe(transferAmount);
    });

    it('should send tether to TON', async () => {
        const proveHeight = 31113440;
        const provenHeight = proveHeight + 1;
        console.log(bridgeTetherWallet.address);
        const seq = 19;
        const packet = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(seq, 64)
            .storeUint(TokenOrigin.TON, 32)
            .storeUint(transferAmount, 128)
            .storeUint(timeout, 64)
            .storeAddress(user.address)
            .storeAddress(bridgeTetherWallet.address)
            .storeRef(
                beginCell()
                    .storeUint(localSenderBech32Address.length, 8)
                    .storeBuffer(Buffer.from(localSenderBech32Address))
                    .endCell(),
            )
            .endCell();
        const packet_cell = packet.hash();
        console.log(BigInt('0x' + packet_cell.toString('hex')));

        //#region script fetch data
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getPacketProofs(
        //     queryClient,
        //     'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //     proveHeight,
        //     BigInt(seq),
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonTether.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     provenHeight,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/lightClientToTonTether.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion

        await updateBlock(lightClientToTonTether as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsTether)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight,
            },
            { value: toNano('0.7') },
        );

        printTransactionFees(sendRecvResult.transactions);
        const userJettonWallet = await tetherMinterContract.getWalletAddress(user.address);
        const wallet = blockchain.openContract(JettonWallet.createFromAddress(userJettonWallet));
        const balance = await wallet.getBalance();
        expect(balance.amount).toBe(transferAmount);
    });

    it('should send ton to TON', async () => {
        const proveHeight = 31113447;
        const provenHeight = proveHeight + 1;
        const seq = 20;
        const packet = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(seq, 64)
            .storeUint(TokenOrigin.TON, 32) // crcSrc
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeAddress(user.address) // remote_receiver
            .storeAddress(null) // remote_denom
            .storeRef(
                beginCell()
                    .storeUint(localSenderBech32Address.length, 8)
                    .storeBuffer(Buffer.from(localSenderBech32Address))
                    .endCell(),
            )
            .endCell();
        const packet_cell = packet.hash();
        console.log(BigInt('0x' + packet_cell.toString('hex')));

        //#region script fetch data
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getPacketProofs(
        //     queryClient,
        //     'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //     proveHeight,
        //     BigInt(seq),
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonTonNative.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     provenHeight,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/lightClientBridgeToTonTonNative.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion

        await updateBlock(lightClientBridgeToTonTonNative as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsTon)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        console.log({ deployer: deployer.address });
        let deployerBeforeBalance = (await deployer.getBalance()) - toNano('1');
        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight,
            },
            { value: toNano('1') },
        );
        console.log('=====================================');
        printTransactionFees(sendRecvResult.transactions);
        let deployerAfterBalance = await deployer.getBalance();
        const userTonBalance = await user.getBalance();
        expect(userTonBalance).toBeGreaterThan(9000000n);
        let updatedBalance = deployerAfterBalance - deployerBeforeBalance;
        expect(updatedBalance).toBeGreaterThan(500000000);
        expect(updatedBalance).toBeLessThan(622664000);
        expect(userTonBalance).toBeLessThan(transferAmount);
        console.log(transferAmount - userTonBalance);
    });

    it('should send multiple packet to TON', async () => {
        const proveHeight = 31113447;
        const provenHeight = proveHeight + 1;
        const sendJettonSrcCosmosPacket = beginCell()
            .storeUint(0xae89be5b, 32) // op
            .storeUint(17, 64) // seq
            .storeUint(TokenOrigin.COSMOS, 32) // token_origin
            .storeUint(transferAmount, 128) // remote_amount
            .storeUint(timeout, 64) // timeout_timestamp
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcCosmos.address) // remote_denom
            .storeRef(
                //  local_sender_ref
                beginCell()
                    .storeUint(localSenderBech32Address.length, 8)
                    .storeBuffer(Buffer.from(localSenderBech32Address))
                    .endCell(),
            )
            .endCell();

        const sendJettonSrcTonPacket = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(18, 64)
            .storeUint(TokenOrigin.TON, 32)
            .storeUint(transferAmount, 128)
            .storeUint(timeout, 64)
            .storeAddress(user.address)
            .storeAddress(bridgeJettonWalletSrcTon.address)
            .storeRef(
                beginCell()
                    .storeUint(localSenderBech32Address.length, 8)
                    .storeBuffer(Buffer.from(localSenderBech32Address))
                    .endCell(),
            )
            .endCell();

        const sendTonPacket = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(20, 64)
            .storeUint(TokenOrigin.TON, 32) // crcSrc
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeAddress(user.address) // remote_receiver
            .storeAddress(null) // remote_denom
            .storeRef(
                beginCell()
                    .storeUint(localSenderBech32Address.length, 8)
                    .storeBuffer(Buffer.from(localSenderBech32Address))
                    .endCell(),
            )
            .endCell();

        //#region script getProofs
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await Promise.all([
        //     getPacketProofs(
        //         queryClient,
        //         'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //         proveHeight,
        //         17n,
        //     ),
        //     getPacketProofs(
        //         queryClient,
        //         'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //         proveHeight,
        //         18n,
        //     ),
        //     getPacketProofs(
        //         queryClient,
        //         'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //         proveHeight,
        //         20n,
        //     ),
        // ]);
        // writeFileSync(
        //     resolve(__dirname, './fixtures/multiplePacketProofs.json'),
        //     JSON.stringify(data),
        // );
        //#endregion

        await updateBlock(lightClientBridgeToTonTonNative as any, deployer);
        const existenceProofs = Object.values(multiplePacketProofs)
            .slice(0, 3) // cut the default property
            .flat()
            .map(ExistenceProof.fromJSON);
        const proofSendJettonSrcCosmos = existenceProofs.slice(0, 2);
        const proofSendJettonSrcTon = existenceProofs.slice(2, 4);
        const proofSendTon = existenceProofs.slice(4, 6);

        let result = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendJettonSrcCosmos)!,
                packet: sendJettonSrcCosmosPacket,
                provenHeight,
            },
            { value: toNano('1') },
        );
        printTransactionFees(result.transactions);

        result = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendJettonSrcTon)!,
                packet: sendJettonSrcTonPacket,
                provenHeight,
            },
            { value: toNano('1') },
        );
        printTransactionFees(result.transactions);

        result = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendTon)!,
                packet: sendTonPacket,
                provenHeight,
            },
            { value: toNano('1') },
        );
        printTransactionFees(result.transactions);

        const userJettonWalletSrcCosmos = await jettonMinterSrcTon.getWalletAddress(user.address);
        const walletJettonSrcCosmos = blockchain.openContract(
            JettonWallet.createFromAddress(userJettonWalletSrcCosmos),
        );
        const balanceSrcCosmos = await walletJettonSrcCosmos.getBalance();
        expect(balanceSrcCosmos.amount).toBe(transferAmount);

        const userJettonWalletSrcTon = await jettonMinterSrcTon.getWalletAddress(user.address);
        const walletJettonSrcTon = blockchain.openContract(
            JettonWallet.createFromAddress(userJettonWalletSrcTon),
        );
        const balanceSrcTon = await walletJettonSrcTon.getBalance();
        expect(balanceSrcTon.amount).toBe(transferAmount);

        const userTonBalance = await user.getBalance();
        expect(userTonBalance).toBeGreaterThan(9000000n);
        expect(userTonBalance).toBeLessThan(transferAmount);
    });

    describe('admin operator', () => {
        it('should paused bridge adapter contract successfully', async () => {
            // action
            await bridgeAdapter.sendSetPaused(deployer.getSender(), Paused.PAUSED, {
                value: toNano('0.01'),
            });
            const cell = (await bridgeAdapter.getBridgeData()).readCell();
            const { paused } = BridgeAdapter.parseBridgeDataResponse(cell);
            // assert
            expect(paused).toBe(Paused.PAUSED);
        });

        it('should update jetton code', async () => {
            await bridgeAdapter.sendChangeJettonWalletCode(
                deployer.getSender(),
                beginCell().endCell(),
                {
                    value: toNano('0.01'),
                },
            );
            const cell = (await bridgeAdapter.getBridgeData()).readCell();
            const { jettonCode } = BridgeAdapter.parseBridgeDataResponse(cell);
            expect(jettonCode.bits.length == 0).toBe(true);
        });

        it('should call all function failed after paused', async () => {
            // arrange
            await bridgeAdapter.sendSetPaused(deployer.getSender(), Paused.PAUSED, {
                value: toNano('0.01'),
            });
            // action
            const result = await bridgeAdapter.sendBridgeRecvPacket(
                deployer.getSender(),
                {
                    proofs: beginCell().endCell(),
                    packet: beginCell().endCell(),
                    provenHeight: 0,
                },
                { value: toNano('0.7') },
            );

            const usdtResultTransfer = await usdtDeployerJettonWallet.sendTransfer(
                usdtDeployer.getSender(),
                {
                    fwdAmount: toNano(1),
                    jettonAmount: toNano(333),
                    jettonMaster: tetherMinterContract.address,
                    toAddress: bridgeAdapter.address,
                    timeout: BigInt(calculateIbcTimeoutTimestamp(3600)),
                    remoteReceiver: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
                    memo: beginCell()
                        .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                        .storeRef(beginCell().storeBuffer(Buffer.from('channel-1')).endCell())
                        .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                        .storeRef(
                            beginCell()
                                .storeBuffer(
                                    Buffer.from('orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx'),
                                )
                                .endCell(),
                        )
                        .endCell(),
                },
                {
                    value: toNano(2),
                    queryId: 0,
                },
            );
            // assert
            expect(result.transactions).toHaveTransaction({
                op: BridgeAdapterOpcodes.bridgeRecvPacket,
                success: false,
                exitCode: BridgeAdapterError.PAUSED,
            });

            expect(usdtResultTransfer.transactions).toHaveTransaction({
                op: 0x7362d09c,
                success: false,
                exitCode: BridgeAdapterError.PAUSED,
            });
        });

        it('should emit error when call after contract upgraded', async () => {
            // arrange
            const newCode = jettonWalletCode;
            await bridgeAdapter.sendUpgradeContract(deployer.getSender(), newCode, {
                value: toNano('0.5'),
            });
            // action

            const result = await bridgeAdapter.sendUpgradeContract(deployer.getSender(), newCode, {
                value: toNano('0.5'),
            });

            // since new_code do not have upgradeContract function
            expect(result.transactions).toHaveTransaction({
                op: BridgeAdapterOpcodes.upgradeContract,
                success: false,
                exitCode: 65535,
            });
        });

        it('should transfer ownership of contract', async () => {
            const newOwner = await blockchain.treasury('new_owner');
            await bridgeAdapter.sendChangeAdmin(deployer.getSender(), newOwner.address, {
                value: toNano('0.01'),
            });
            const cell = await bridgeAdapter.getBridgeData();
            const { adminAddress } = BridgeAdapter.parseBridgeDataResponse(cell.readCell());
            expect(adminAddress.equals(newOwner.address)).toBeTruthy();
        });

        it('should change light client master of contract', async () => {
            const newContract = await blockchain.treasury('new_light_client_master');
            await bridgeAdapter.sendChangeLightClientMaster(
                deployer.getSender(),
                newContract.address,
                {
                    value: toNano('0.01'),
                },
            );
            const cell = await bridgeAdapter.getBridgeData();
            const { lightClientMasterAddress } = BridgeAdapter.parseBridgeDataResponse(
                cell.readCell(),
            );
            expect(lightClientMasterAddress.equals(newContract.address)).toBeTruthy();
        });

        it('should change admin to multisig wallet', async () => {
            // arrange
            const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
            let order_code_raw = Cell.fromBoc(Buffer.from(OrderRawBuild.hex, 'hex'))[0];
            _libs.set(BigInt(`0x${order_code_raw.hash().toString('hex')}`), order_code_raw);
            const libs = beginCell().storeDictDirect(_libs).endCell();
            blockchain.libs = libs;
            const multiSigCode = Cell.fromBoc(Buffer.from(MultisigBuild.hex, 'hex'))[0];
            const owner1 = await blockchain.treasury('owner1');
            const owner2 = await blockchain.treasury('owner2');
            const owner3 = await blockchain.treasury('owner3');
            const proposer = await blockchain.treasury('proposer');
            const multisigConfig: MultisigConfig = {
                threshold: 2,
                signers: [owner1.address, owner2.address, owner3.address],
                proposers: [proposer.address],
                allowArbitrarySeqno: false,
            };
            const multiSigWallet = blockchain.openContract(
                Multisig.createFromConfig(multisigConfig, multiSigCode),
            );
            await multiSigWallet.sendDeploy(deployer.getSender(), toNano('0.05'));
            // act
            const changeOwnerShipResult = await bridgeAdapter.sendChangeAdmin(
                deployer.getSender(),
                multiSigWallet.address,
                { value: toNano('0.01') },
            );
            expect(changeOwnerShipResult.transactions).toHaveTransaction({
                op: BridgeAdapterOpcodes.changeAdmin,
                success: true,
            });
            blockchain.now = Math.floor(Date.now() / 1000);
            const setPausedMsg: TransferRequest = {
                type: 'transfer',
                sendMode: 1,
                message: internal_relaxed({
                    to: bridgeAdapter.address,
                    value: toNano('0.05'),
                    body: beginCell()
                        .storeUint(BridgeAdapterOpcodes.setPaused, 32)
                        .storeUint(0, 64)
                        .storeBit(Paused.PAUSED)
                        .endCell(),
                }),
            };
            const nextSeq = (await multiSigWallet.getMultisigData()).nextOrderSeqno;
            const orderAddress = await multiSigWallet.getOrderAddress(nextSeq);
            const setPausedOrder = Multisig.newOrderMessage(
                [setPausedMsg],
                blockchain.now + 1000,
                true,
                0,
            );
            const sendSetPausedOrder = await blockchain.sendMessage(
                internal({
                    from: owner1.address,
                    to: multiSigWallet.address,
                    body: setPausedOrder,
                    value: toNano('0.1'),
                }),
            );
            expect(sendSetPausedOrder.transactions).toHaveTransaction({
                from: multiSigWallet.address,
                to: orderAddress,
                deploy: true,
                success: true,
            });
            const orderContract = blockchain.openContract(Order.createFromAddress(orderAddress));
            const approveOrder = await orderContract.sendApprove(owner2.getSender(), 1);
            // assert
            expect(approveOrder.transactions).toHaveTransaction({
                from: owner2.address,
                to: orderAddress,
                deploy: false,
                success: true,
            });
            expect(approveOrder.transactions).toHaveTransaction({
                from: multiSigWallet.address,
                to: bridgeAdapter.address,
                success: true,
            });
            const bridgeData = BridgeAdapter.parseBridgeDataResponse(
                (await bridgeAdapter.getBridgeData()).readCell(),
            );
            expect(bridgeData.paused).toEqual(Paused.PAUSED);
        });

        it('should bridgeAdapter update and revert by multisig wallet', async () => {
            // arrange
            const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
            let order_code_raw = Cell.fromBoc(Buffer.from(OrderRawBuild.hex, 'hex'))[0];
            _libs.set(BigInt(`0x${order_code_raw.hash().toString('hex')}`), order_code_raw);
            const libs = beginCell().storeDictDirect(_libs).endCell();
            blockchain.libs = libs;
            const multiSigCode = Cell.fromBoc(Buffer.from(MultisigBuild.hex, 'hex'))[0];
            const owner1 = await blockchain.treasury('owner1');
            const owner2 = await blockchain.treasury('owner2');
            const owner3 = await blockchain.treasury('owner3');
            const owner4 = await blockchain.treasury('owner4');
            const proposer = await blockchain.treasury('proposer');
            const multisigConfig: MultisigConfig = {
                threshold: 3,
                signers: [owner1.address, owner2.address, owner3.address, owner4.address],
                proposers: [proposer.address],
                allowArbitrarySeqno: false,
            };
            const multiSigWallet = blockchain.openContract(
                Multisig.createFromConfig(multisigConfig, multiSigCode),
            );
            await multiSigWallet.sendDeploy(deployer.getSender(), toNano('1'));
            console.log({
                owner1: owner1.address,
                owner2: owner2.address,
                owner3: owner3.address,
                owner4: owner4.address,
                proposer: proposer.address,
            });
            console.log(await multiSigWallet.getMultisigData());
            // act
            const bridgeAdapterOldCode = Cell.fromBoc(
                Buffer.from(
                    'b5ee9c7201022a0100094d000114ff00f4a413f4bcf2c80b0102016202030202cb0405020120282902012006070201621a1b02012008090201f4181904add76d176fd99916380492f81f0686981f80880b8d8492f81f07d201801698f90c1087be812c2dd718110c1080d727ddddd474818c085dcfc208a780309f97a7809ed9e70410839b1684e29105d718110c108579aee42dd40a170b0c001568c083e910c407e910c6ea04fc3121821029b92700bef2e457810bc1f845c000f2f4d33fd430d0d33fd4d43020d0d31f810bb8228210a64c12a3ba238210ae89be5bbab1f2f4c8028210ae89be5bba8e1f3035f84603c8cb3f5006cf1612cccc13ccc98210b4d4739a58cb1f12cb3fcce30ec970f841588040db3cf8488040f4866fa532f82391028ae85b0d270e0f01fe3101821008f0d180bef2e457810bc1f845c000f2f4d33ffa00fa40d30721aa0266d701d401d0fa40d33f3002d430f828f847523070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d00a810bb90bf0061af2f4c85006cf16c9c85006cf165006fa0215cb3f12100498e302218210f21d3c89bae3023220c0018e9730810bb9f8425003f00612f2f4d33f31d30030f865db3ce020c0028e1430810bb9f8425003f00612f2f4d33f31d430fb04e0208210f941c229ba1112171300de6c12d33fd30130f849128040f40e6fa120c3ff8e2b5f060182100bebc200a18210d53276db708010c8cb055005cf1658fa0213cb6a12cb1fcb3fc973fb00db31e037810bc05007f2f4c85006cf1615cb01c9f84603c8cb3f5006cf1612cccc13ccc98210b4d4739a58cb1f12cb3fcc002ef8488040f47c6fa520c0ff9702f00e5230be309132e2580104db3c170142cb074300cf0113cc12ccc9821048328798c8cb1f12cb3fccc970f843588040db3c2701fc6c21810bb9f8435003f00612f2f4d33fd430d0d207810bbb58f2f4d207fa40fa00d33fd30721aa0266d701d4d430d0c821cf16c9299682101f886e35968210123a01b1e2f8448210a64c12a3c8cb1fcb3fcb1f5280cb7f17cb3f15cb075003cf0125cf1613cc20c9d0f844f8498040f416f86912ccc9f844a4f86404c0001401fe3121820afaf080bef2e457810bc1f845c000f2f4d33fd430d08209312d0001fa00d33fd30721aa0266d701d430810bbd5367a052a0bcf2f45185a15006a1c829cf16c97082101f886e35f8448210a64c12a3c8cb1fcb3fcb1f17cb7f15cb3f13cb074500cf0112cb01cc20c9d0f844f8498040f416f86913ccc9f844a4f8641603b68e9630810bb9f8425003f00612f2f4d33f31d430f867db3ce0208210c6bffa9bba8e9730810bb9f8425003f00612f2f4d33f31fa4030f861db3ce0c0038e96810bb9f8425003f00612f2f4d33f31fa4030f862db3ce05b840ff2f017171702f68ecef828f847414070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d08210595f07bcc8cb1f5250cb3f58fa0258cf16c970598040db3c8e236c218210d53276db708010c8cb055003cf1622fa0212cb6acb1f5220cb3fc98042fb00e2f828f901022715014c830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00db3c170196f828f9015112830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb008210d53276db708010c8cb055005cf165003fa0213cb6acb1fcb3fc973fb00db3c170058f849c8f400c9f848c8f400c9f847f846f845f844c8f841cf16f842cf16f843cf16cb3fcb00ccccccccc9ed54000f201035c8b5c2cfe0003b321b67409eaa43298c1400dbc088b000398ca6005bc880b2c1c85bb98c60006b5ed44d0fa4001f861fa4001f862fa4001f863d33f01f864d30001f865d401f866d401f867d401d0f40430f868d401d0f40430f869d1802e1501d33fd430d0d300fa40d43020d0d31fd33fd31fd37fd33f08c0008e3b7125c8cb1f5250cb3fcb01c9f828f901511a830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00810bbef2f0de248210ae89be5bbae30235038210a64c12a3bae3025f0881c1d04fc07fa40fa4030f8235009be8e3f10375f0732728210ae89be5bc8cb1f13cb3f12cb01c9f828f90102830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00e0f84852408040f40e6fa131e300228210123a01b1bae3000282101f886e35ba955b10266c32e30d03d0f84852408040f4161e1f202104fe05d30701aa02d70131fa40d301d430d0fa403001c0028f58810bbff8235006be15f2f4258210123a01b1ba8eb56d708210178d4519c8cb1f5290cb3f25fa02cb0126cf1670fa02f400c98015c8cb1f5280cb3f25cf1629fa02ccc97052228040db3cde0582101f886e35ba926c61e30d8e8d10245f046c223270018042db3c272426250080718210ae89be5bc8cb1f5250cb3fcb01c9f828f901511a830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00810bbaf2f0016a6d708210178d4519c8cb1f52b0cb3f24fa02cb0128cf1670fa02f400c98015c8cb1f52a0cb3f22cf162bfa02ccc97052928040db3c2702dc26d70b01c0008ee238f828f847417070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d06d6d82100f8a7ea5c8cb1f5290cb3f500afa025007cf165005cf1617f40070fa0214f400c97040338040db3c01e30d50032722006ef8687001c8cb1f13cb3f12cb01c9f828f90102830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00022a36078208989680a1c8c954168873db3c443673db3c2323002c718010c8cb055004cf165004fa0212cb6accc901fb0003f224d70b01c0008f123434048208989680a1503473db3c5973db3c8edc36f828f847415070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d06d6d82100f8a7ea5c8cb1f17cb3f5005fa0258cf1658cf1613f40070fa02f400c970598040db3ce22626270014e2f8498040f45b30f8690028708018c8cb055003cf165003fa02cb6ac901fb00002c718018c8cb055004cf165004fa0212cb6accc901fb00001bbfea7f808fc24c0207a0737d09840041bea5cf808fc23fc237c22fc22647c20e78b7c21678b7c21e78b659fe580666664c',
                    'hex',
                ),
            )[0];
            const bridgeAdapter = blockchain.openContract(
                BridgeAdapter.createFromConfig(
                    {
                        admin: multiSigWallet.address,
                        light_client_master: lightClientMaster.address,
                        whitelist_denom: whitelistDenom.address,
                        bridge_wasm_smart_contract: bridgeWasmAddress,
                        jetton_wallet_code: jettonWalletCode,
                        paused: 0,
                    },
                    bridgeAdapterOldCode,
                ),
            );
            await bridgeAdapter.sendDeploy(deployer.getSender(), { value: toNano(0.1) });
            console.log({
                bridgeAdapter: bridgeAdapter.address,
                multisigWallet: multiSigWallet.address,
            });
            blockchain.now = Math.floor(Date.now() / 1000);
            const expiration = blockchain.now + 1000;

            // Update new code
            const updateMessageBoc: Cell = Cell.fromBoc(
                Buffer.from(
                    'b5ee9c7241022801000883000118000000020000000000000000010114ff00f4a413f4bcf2c80b0202016203250202cc0415020120051204add76d176fd99916380492f81f0686981f80500b8d8492f81f07d201801698f90c1087be812c2dd718110c1080d727ddddd474818c085dcfc208a780309f97a78066d9e70410839b1684e29105d718110c108579aee42dd406110a0b04fc3121821029b92700bef2e457810bc1f845c000f2f4d33fd430d0d33fd4d43020d0d31f810bb8228210a64c12a3ba238210ae89be5bbab1f2f4c8028210ae89be5bba8e1f3035f84603c8cb3f5006cf1612cccc13ccc98210b4d4739a58cb1f12cb3fcce30ec970f841588040db3cf8488040f4866fa532f82391028ae85b0722080900de6c12d33fd30130f849128040f40e6fa120c3ff8e2b5f060182100bebc200a18210d53276db708010c8cb055005cf1658fa0213cb6a12cb1fcb3fc973fb00db31e037810bc05007f2f4c85006cf1615cb01c9f84603c8cb3f5006cf1612cccc13ccc98210b4d4739a58cb1f12cb3fcc002ef8488040f47c6fa520c0ff9702f0075230be309132e2580104db3c1101c83101821008f0d180bef2e457810bc1f845c000f2f4d33ffa00fa40d30721aa0266d701d401d0fa40d33f3002d430c85007cf16c9c8500acf1601cf165006fa0215cb3f12cb074300cf01cc12ccc9821048328798c8cb1f12cb3fccc970f843588040db3c220498e302218210f21d3c89bae3023220c0018e9730810bb9f8425003f00612f2f4d33f31d30030f865db3ce020c0028e1430810bb9f8425003f00612f2f4d33f31d430fb04e0208210f941c229ba0c0e111001fe6c21810bb9f8435003f00612f2f4d33fd430d0d207810bbb58f2f4d207fa40fa40fa00d33fd30721aa0266d701d4d430d0c821cf16c92a9682101f886e35968210123a01b1e2f8448210a64c12a3c8cb1fcb3fcb1f5280cb7f17cb3f15cb075003cf01279235259105e215cf1612cc20c9d0f844f8498040f416f86913ccc90d02eaf844a4f86404c0008e9a8210595f07bcc8cb1f5250cb3f01fa0201cf16c970598040db3c8e2330318210d53276db708010c8cb055003cf1622fa0212cb6acb1f5220cb3fc98042fb00e2f828f90102830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00db3c221101fe3121820afaf080bef2e457810bc1f845c000f2f4d33fd430d0fa00d33fd30721aa0266d701d430810bbd26820afaf080a05290bcf2f45175a1820afaf080a1c829cf16c97082101f886e35f8448210a64c12a3c8cb1fcb3fcb1f18cb7f16cb3f14cb0758cf0113cb01cc20c9d0f844f8498040f416f86913ccc9f844a4f8640f0196f828f9015112830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb008210d53276db708010c8cb055005cf165003fa0213cb6acb1fcb3fc973fb00db3c1103b68e9630810bb9f8425003f00612f2f4d33f31d430f867db3ce0208210c6bffa9bba8e9730810bb9f8425003f00612f2f4d33f31fa4030f861db3ce0c0038e96810bb9f8425003f00612f2f4d33f31fa4030f862db3ce05b840ff2f01111110058f849c8f400c9f848c8f400c9f847f846f845f844c8f841cf16f842cf16f843cf16cb3fcb00ccccccccc9ed54020158131400150c083e910c407e910c6ea0000f201035c8b5c2cfe002012016190201201718003b4c86d9d027aa90ca63050036f0222c000e63298016f2202cb07216ee6318006b4ed44d0fa4001f861fa4001f862fa4001f863d33f01f864d30001f865d401f866d401f867d401d0f40430f868d401d0f40430f869d1802e1d00e99fea186869807d206a181068698fe99fe98fe9bfe99f846000471db892e4658fa928659fe580e4fc147c80a88d4183b8c006646581e580e58409e5ff90b74b381965b0e59fcb1938ac65b0e67164b87d804085df79786f1241085744df2ddd71811a81c10853260951dd71812f8441a2004fc07fa40fa4030f8235009be8e3f10375f0732728210ae89be5bc8cb1f13cb3f12cb01c9f828f90102830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00e0f84852408040f40e6fa131e300228210123a01b1bae3000282101f886e35ba955b10266c32e30d03d0f84852408040f4161b1c1d1f0080718210ae89be5bc8cb1f5250cb3fcb01c9f828f901511a830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00810bbaf2f0016a6d708210178d4519c8cb1f52b0cb3f24fa02cb0128cf1670fa02f400c98015c8cb1f52a0cb3f22cf162bfa02ccc97052928040db3c22039c26d70b01c0008f1536078208989680a1c8c954168873db3c443673db3c8eac386d6d82100f8a7ea5c8cb1f5290cb3f500afa0258cf165005cf1617f40070fa0213f400c97040448040db3ce250031e1e22002c718010c8cb055004cf165004fa0212cb6accc901fb00006ef8687001c8cb1f13cb3f12cb01c9f828f90102830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb0004fe05d30701aa02d70131fa40d301d430d0fa403001c0028f58810bbff8235006be15f2f4258210123a01b1ba8eb56d708210178d4519c8cb1f5290cb3f25fa02cb0126cf1670fa02f400c98015c8cb1f5280cb3f25cf1629fa02ccc97052228040db3cde0582101f886e35ba926c61e30d8e8d10245f046c223270018042db3c22212324038a24d70b01c0008f123434048208989680a1503473db3c5973db3c8ea8366d6d82100f8a7ea5c8cb1f17cb3f58fa0258cf1658cf1613f40070fa0212f400c970598040db3ce2232322002c718018c8cb055004cf165004fa0212cb6accc901fb000028708018c8cb055003cf165003fa02cb6ac901fb000014e2f8498040f45b30f8690201202627001bbfea7f8057c24c0207a0737d09840041bea5cf8057c23fc237c22fc22647c20e78b7c21678b7c21e78b659fe580666664c59823327',
                    'hex',
                ),
            )[0];
            const updateCode: TransferRequest = {
                type: 'transfer',
                sendMode: 1,
                message: internal_relaxed({
                    to: bridgeAdapter.address,
                    value: toNano('0.05'),
                    body: updateMessageBoc,
                }),
            };

            const updateOrderResult = await multiSigWallet.sendNewOrder(
                proposer.getSender(),
                [updateCode],
                expiration,
            );
            expect(updateOrderResult.transactions).toHaveTransaction({
                op: Op.multisig.new_order,
                from: proposer.address,
                to: multiSigWallet.address,
                success: true,
            });
            const orderAddress = await multiSigWallet.getOrderAddress(0n);
            const orderContract = blockchain.openContract(Order.createFromAddress(orderAddress));
            await orderContract.sendApprove(owner1.getSender(), 0);
            await orderContract.sendApprove(owner2.getSender(), 1);
            const lastApproveTx = await orderContract.sendApprove(owner3.getSender(), 2);
            expect(lastApproveTx.transactions).toHaveTransaction({
                from: multiSigWallet.address,
                to: bridgeAdapter.address,
                op: BridgeAdapterOpcodes.upgradeContract,
                success: true,
            });

            // Revert old version
            const revertCodeRequest: TransferRequest = {
                type: 'transfer',
                sendMode: 1,
                message: internal_relaxed({
                    to: bridgeAdapter.address,
                    value: toNano('0.05'),
                    body: beginCell()
                        .storeUint(BridgeAdapterOpcodes.upgradeContract, 32)
                        .storeUint(0, 64)
                        .storeRef(bridgeAdapterOldCode)
                        .endCell(),
                }),
            };
            blockchain.now = Math.floor(Date.now() / 1000);
            const revertOrderResult = await multiSigWallet.sendNewOrder(
                proposer.getSender(),
                [revertCodeRequest],
                expiration,
            );
            expect(revertOrderResult.transactions).toHaveTransaction({
                op: Op.multisig.new_order,
                from: proposer.address,
                to: multiSigWallet.address,
                success: true,
            });
            const revertOrderAddress = await multiSigWallet.getOrderAddress(1n);
            const revertOrderContract = blockchain.openContract(
                Order.createFromAddress(revertOrderAddress),
            );
            await revertOrderContract.sendApprove(owner1.getSender(), 0);
            await revertOrderContract.sendApprove(owner2.getSender(), 1);
            const lastApproveRevertTx = await revertOrderContract.sendApprove(
                owner3.getSender(),
                2,
            );
            expect(lastApproveRevertTx.transactions).toHaveTransaction({
                from: multiSigWallet.address,
                to: bridgeAdapter.address,
                op: BridgeAdapterOpcodes.upgradeContract,
                success: true,
            });
        });
    });
});

describe('Ton->Cosmos BridgeAdapter', () => {
    let lightClientMasterCode: Cell;
    let bridgeAdapterCode: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    let whitelistDenomCode: Cell;
    let tetherMinterCode: Cell;
    let tetherWalletCode: Cell;

    const bridgeWasmAddress = 'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7';
    const updateBlock = async (
        {
            header,
            validators,
            lastCommit,
        }: {
            header: SerializedHeader;
            validators: SerializedValidator[];
            lastCommit: SerializedCommit;
        },
        relayer: SandboxContract<TreasuryContract>,
    ) => {
        let result = await lightClientMaster.sendVerifyBlockHash(
            relayer.getSender(),
            {
                header: deserializeHeader(header),
                validators: validators.map(deserializeValidator),
                commit: deserializeCommit(lastCommit),
            },
            {
                value: toNano('10'),
            },
        );
        printTransactionFees(result.transactions);
        expect(result.transactions).toHaveTransaction({
            op: LightClientMasterOpcodes.verify_block_hash,
            success: true,
        });
        expect(await lightClientMaster.getTrustedHeight()).toBe(header.height);
    };

    beforeAll(async () => {
        lightClientMasterCode = Cell.fromBoc(
            Buffer.from(DEFAULT_LIGHT_CLIENT_MASTER_BOC, 'base64'),
        )[0];
        bridgeAdapterCode = Cell.fromBoc(Buffer.from(DEFAULT_BRIDGE_ADAPTER_BOC, 'base64'))[0];
        jettonWalletCode = await compile('JettonWallet');
        jettonMinterCode = await compile('JettonMinter');
        whitelistDenomCode = await compile('WhitelistDenom');
        tetherMinterCode = await compile('TetherMinter');
        tetherWalletCode = await compile('TetherWallet');
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
    let tetherMinterContract: SandboxContract<TetherMinter>;
    let bridgeTetherWallet: SandboxContract<JettonWallet>;
    let tetherDeployer: SandboxContract<TreasuryContract>;
    let whitelistDenom: SandboxContract<WhitelistDenom>;

    // packet info
    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            ...blockchain.verbosity,
            // vmLogs: 'vm_logs_gas',
        };
        blockchain.now = 1720603836;

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

        let result = await usdtMinterContract.sendMint(
            usdtDeployer.getSender(),
            {
                toAddress: usdtDeployer.address,
                jettonAmount: toNano(123456),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        printTransactionFees(result.transactions);

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
                    adminAddress: deployer.address,
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
                    paused: Paused.UNPAUSED,
                    admin: deployer.address,
                },
                bridgeAdapterCode,
            ),
        );

        const deployBridgeResult = await bridgeAdapter.sendDeploy(deployer.getSender(), {
            value: toNano('1'),
        });
        expect(deployBridgeResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            deploy: true,
            success: true,
        });
        printTransactionFees(deployBridgeResult.transactions);

        jettonMinterSrcCosmos = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: deployer.address,
                    content: beginCell().storeUint(1, 8).endCell(),
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
        await jettonMinterSrcCosmos.sendChangeAdmin(deployer.getSender(), bridgeAdapter.address);

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
                    content: beginCell().storeUint(2, 8).endCell(),
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

        // SET UP TETHER CONTRACT

        tetherDeployer = await blockchain.treasury('tether_deployer');
        tetherMinterContract = blockchain.openContract(
            TetherMinter.createFromConfig(
                {
                    adminAddress: tetherDeployer.address,
                    content: beginCell().storeBuffer(Buffer.from('TETHER USDT TOKEN')).endCell(),
                    jettonWalletCode: tetherWalletCode,
                },
                tetherMinterCode,
            ),
        );
        const deployTetherMinterResult = await tetherMinterContract.sendDeploy(
            tetherDeployer.getSender(),
            {
                value: toNano('1000'),
            },
        );

        expect(deployTetherMinterResult.transactions).toHaveTransaction({
            from: tetherDeployer.address,
            to: tetherMinterContract.address,
            deploy: true,
            success: true,
        });
        result = await tetherMinterContract.sendMint(
            tetherDeployer.getSender(),
            {
                toAddress: bridgeAdapter.address,
                jettonAmount: toNano(333333),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        printTransactionFees(result.transactions);

        const tetherWalletAddress = await tetherMinterContract.getWalletAddress(
            bridgeAdapter.address,
        );
        const tetherJettonWallet = JettonWallet.createFromAddress(tetherWalletAddress);
        bridgeTetherWallet = blockchain.openContract(tetherJettonWallet);
        expect((await bridgeTetherWallet.getBalance()).amount).toBe(333333000000000n);

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

        // const newBridgeAdapterCode = await compile('BridgeAdapter');
        // const upgradeBridgeAdapterTx = await bridgeAdapter.sendUpgradeContract(
        //     deployer.getSender(),
        //     newBridgeAdapterCode,
        //     {
        //         value: toNano('0.1'),
        //     },
        // );
        // expect(upgradeBridgeAdapterTx.transactions).toHaveTransaction({
        //     from: deployer.address,
        //     to: bridgeAdapter.address,
        //     success: true,
        //     op: BridgeAdapterOpcodes.upgradeContract,
        // });

        // const newLightClientMasterCode = await compile('LightClientMaster');
        // const upgradeLightClientMasterTx = await lightClientMaster.sendUpgradeContract(
        //     deployer.getSender(),
        //     newLightClientMasterCode,
        //     {
        //         value: toNano('0.1'),
        //     },
        // );
        // expect(upgradeLightClientMasterTx.transactions).toHaveTransaction({
        //     from: deployer.address,
        //     to: lightClientMaster.address,
        //     success: true,
        //     op: LightClientMasterOpcodes.upgrade_contract,
        // });
    });

    it('Test send jetton token from ton to bridge adapter', async () => {
        const bridgeJettonWallet = await usdtMinterContract.getWalletAddress(bridgeAdapter.address);
        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: bridgeJettonWallet,
                permission: true,
                isRootFromTon: true,
            },
            {
                value: toNano(0.1),
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: WhitelistDenomOpcodes.setDenom,
            success: true,
        });

        const senderBeforeBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
            .balance;
        result = await usdtDeployerJettonWallet.sendTransfer(
            usdtDeployer.getSender(),
            {
                fwdAmount: toNano(1),
                jettonAmount: toNano(333),
                jettonMaster: tetherMinterContract.address,
                toAddress: bridgeAdapter.address,
                timeout: BigInt(calculateIbcTimeoutTimestamp(3600)),
                remoteReceiver: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
                memo: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('channel-0')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(
                        beginCell()
                            .storeBuffer(Buffer.from('orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx'))
                            .endCell(),
                    )
                    .endCell(),
            },
            {
                value: toNano(2),
                queryId: 0,
            },
        );
        printTransactionFees(result.transactions);

        const bodyCell = result.transactions[result.transactions.length - 2].externals[0].body;
        expect(BigInt(bodyCell.asSlice().loadUint(32))).toBe(BigInt('0xa64c12a3'));

        console.log(
            'Bridge adapter balance:',
            (await blockchain.getContract(bridgeAdapter.address)).balance,
        );
        expect(result.transactions).toHaveTransaction({
            op: BridgeAdapterOpcodes.callbackDenom,
            success: true,
        });
        const senderAfterBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
            .balance;
        expect(senderBeforeBalance - senderAfterBalance).toBeLessThanOrEqual(toNano(0.15));
    });

    it('Test send usdt from ton to bridge adapter', async () => {
        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: bridgeTetherWallet.address,
                permission: true,
                isRootFromTon: true,
            },
            {
                value: toNano(0.1),
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: WhitelistDenomOpcodes.setDenom,
            success: true,
        });

        result = await tetherMinterContract.sendMint(
            tetherDeployer.getSender(),
            {
                toAddress: tetherDeployer.address,
                jettonAmount: toNano(1000),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        printTransactionFees(result.transactions);

        const tetherWalletAddress = await tetherMinterContract.getWalletAddress(
            tetherDeployer.address,
        );
        const deployerTetherJettonWalletContract =
            JettonWallet.createFromAddress(tetherWalletAddress);
        const deployerTetherJettonWallet = blockchain.openContract(
            deployerTetherJettonWalletContract,
        );

        const senderBeforeBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
            .balance;
        result = await deployerTetherJettonWallet.sendTransfer(
            tetherDeployer.getSender(),
            {
                fwdAmount: toNano(1),
                jettonAmount: toNano(333),
                jettonMaster: tetherMinterContract.address,
                toAddress: bridgeAdapter.address,
                timeout: BigInt(calculateIbcTimeoutTimestamp(3600)),
                remoteReceiver: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
                memo: beginCell().endCell(),
            },
            {
                value: toNano(2),
                queryId: 0,
            },
        );
        printTransactionFees(result.transactions);

        const bodyCell = result.transactions[result.transactions.length - 2].externals[0].body;
        expect(BigInt(bodyCell.asSlice().loadUint(32))).toBe(BigInt('0xa64c12a3'));

        console.log(
            'Bridge adapter balance:',
            (await blockchain.getContract(bridgeAdapter.address)).balance,
        );
        expect(result.transactions).toHaveTransaction({
            op: BridgeAdapterOpcodes.callbackDenom,
            success: true,
        });
        const senderAfterBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
            .balance;
        expect(senderBeforeBalance - senderAfterBalance).toBeLessThanOrEqual(toNano(0.15));
    });

    it('Test send jetton token from cosmos to bridge adapter', async () => {
        // redeploy jetton minter
        const jettonMinterSrcCosmos = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: deployer.address,
                    content: beginCell().storeUint(10, 8).endCell(),
                    jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );
        await jettonMinterSrcCosmos.sendDeploy(deployer.getSender(), { value: toNano('0.5') });
        // setup for user
        const userContract = await blockchain.treasury('user', {
            balance: 0n,
        });
        await deployer.send({
            to: userContract.address,
            value: toNano(3),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });
        const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(
            userContract.address, // this is "user" treasury
        );
        const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
        const wallet = blockchain.openContract(userJettonWalletBalance);

        await jettonMinterSrcCosmos.sendMint(
            deployer.getSender(),
            {
                toAddress: userContract.address,
                jettonAmount: 10000000000n,
                amount: toNano('0.01'),
            },
            {
                value: toNano(1),
            },
        );
        // change admin to bridge
        await jettonMinterSrcCosmos.sendChangeAdmin(deployer.getSender(), bridgeAdapter.address);
        const bridgeJettonWalletSrcCosmos = await jettonMinterSrcCosmos.getWalletAddress(
            bridgeAdapter.address,
        );
        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: bridgeJettonWalletSrcCosmos,
                permission: true,
                isRootFromTon: false,
            },
            {
                value: toNano(0.1),
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: WhitelistDenomOpcodes.setDenom,
            success: true,
        });

        expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(10000000000n);
        result = await wallet.sendTransfer(
            userContract.getSender(),
            {
                fwdAmount: toNano(0.15),
                jettonAmount: toNano(5),
                jettonMaster: jettonMinterSrcCosmos.address,
                toAddress: bridgeAdapter.address,
                timeout: BigInt(calculateIbcTimeoutTimestamp(3600)),
                remoteReceiver: 'orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd',
                memo: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from('this is just a test')).endCell())
                    .endCell(),
            },
            {
                value: toNano(2),
                queryId: 0,
            },
        );
        printTransactionFees(result.transactions);

        expect(result.transactions).toHaveTransaction({
            op: BridgeAdapterOpcodes.callbackDenom,
            success: true,
        });
        expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(5000000000n);
    });

    it('Test send ton to cosmos', async () => {
        const result = await bridgeAdapter.sendBridgeTon(
            deployer.getSender(),
            {
                amount: 10_000_000n,
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
                remoteReceiver: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
                timeout: 1720603835n,
            },
            {
                value: toNano(0.1),
            },
        );

        printTransactionFees(result.transactions);
    });

    it('Test timeout send jetton token from cosmos to bridge adapter', async () => {
        const height = 28359915;
        const timeout = 1720603835;

        const jettonMinterSrcCosmos = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    adminAddress: deployer.address,
                    content: beginCell().storeUint(10, 8).endCell(),
                    jettonWalletCode,
                },
                jettonMinterCode,
            ),
        );
        await jettonMinterSrcCosmos.sendDeploy(deployer.getSender(), { value: toNano('0.5') });

        const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(
            deployer.address, // this is "user" treasury
        );
        const bridgeJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(
            bridgeAdapter.address,
        );
        const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
        const wallet = blockchain.openContract(userJettonWalletBalance);

        await jettonMinterSrcCosmos.sendMint(
            deployer.getSender(),
            {
                toAddress: deployer.getSender().address,
                jettonAmount: 10_000_000_000n,
                amount: toNano('0.01'),
            },
            {
                value: toNano(1),
            },
        );
        // change admin to bridge
        await jettonMinterSrcCosmos.sendChangeAdmin(deployer.getSender(), bridgeAdapter.address);

        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: bridgeJettonWallet,
                permission: true,
                isRootFromTon: false,
            },
            {
                value: toNano(0.1),
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: WhitelistDenomOpcodes.setDenom,
            success: true,
        });

        expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(10_000_000_000n);
        result = await wallet.sendTransfer(
            deployer.getSender(),
            {
                fwdAmount: toNano(1),
                jettonAmount: 10_000_000n,
                jettonMaster: jettonMinterSrcCosmos.address,
                toAddress: bridgeAdapter.address,
                timeout: BigInt(timeout),
                remoteReceiver: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
                memo: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from('this is just a test')).endCell())
                    .endCell(),
            },
            {
                value: toNano(2),
                queryId: 0,
            },
        );
        printTransactionFees(result.transactions);

        expect(result.transactions).toHaveTransaction({
            op: BridgeAdapterOpcodes.callbackDenom,
            success: true,
        });
        expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(10_000_000_000n - 10_000_000n);

        console.log(deployer.getSender().address, jettonMinterSrcCosmos.address);
        //#region script fetch data
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getAckPacketProofs(
        //     queryClient,
        //     'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //     height,
        //     1n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/sendToCosmosTimeoutOtherProof.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     height + 1,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/light_client_${height + 1}.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        // #endregion;

        await updateBlock(lightClient_28359916 as any, deployer);
        const sendToCosmosPacket = beginCell()
            .storeUint(0xa64c12a3, 32) // op
            .storeUint(1, 64) // seq
            .storeUint(Ack.Timeout, 2)
            .endCell();
        const existenceProofs = Object.values(sendToCosmosTimeoutOtherProof)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);
        const result1 = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet: sendToCosmosPacket,
                provenHeight: height + 1,
            },
            { value: toNano('3') },
        );
        printTransactionFees(result1.transactions);
        expect(await jettonMinterSrcCosmos.getTotalsupply()).toBe(10_000_000_000n);
    });

    it('Test timeout send jetton token from ton to bridge adapter', async () => {
        const height = 31117871;
        const timeout = 1724646494;
        blockchain.now = 1724646500;
        const bridgeJettonWallet = await usdtMinterContract.getWalletAddress(bridgeAdapter.address);
        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: bridgeJettonWallet,
                permission: true,
                isRootFromTon: true,
            },
            {
                value: toNano(0.1),
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: WhitelistDenomOpcodes.setDenom,
            success: true,
        });
        console.log({
            denom: usdtMinterContract.address,
            sender: usdtDeployer.getSender().address,
            bridgeJettonWallet,
        });
        console.log(
            Buffer.from(fromBech32('orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx').data).toString(
                'base64',
            ),
        );

        const senderBeforeBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
            .balance;
        const usdtWalletAddress = await usdtMinterContract.getWalletAddress(
            usdtDeployer.getSender().address,
        );
        const usdtJettonWallet = JettonWallet.createFromAddress(usdtWalletAddress);
        usdtDeployerJettonWallet = blockchain.openContract(usdtJettonWallet);
        const beforeJettonBalance = (await usdtDeployerJettonWallet.getBalance()).amount;

        await usdtDeployerJettonWallet.sendTransfer(
            usdtDeployer.getSender(),
            {
                fwdAmount: toNano(1),
                jettonAmount: 10_000_000n,
                jettonMaster: usdtMinterContract.address,
                toAddress: bridgeAdapter.address,
                timeout: BigInt(timeout),
                remoteReceiver: 'orai1w0emvx75v79x2rm0afcw7sn8hqt5f4fhtd3pw7',
                memo: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('channel-0')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(
                        beginCell()
                            .storeBuffer(Buffer.from('orai1w0emvx75v79x2rm0afcw7sn8hqt5f4fhtd3pw7'))
                            .endCell(),
                    )
                    .endCell(),
            },
            {
                value: toNano(2),
                queryId: 0,
            },
        );
        result = await usdtDeployerJettonWallet.sendTransfer(
            usdtDeployer.getSender(),
            {
                fwdAmount: toNano(1),
                jettonAmount: 10_000_000n,
                jettonMaster: usdtMinterContract.address,
                toAddress: bridgeAdapter.address,
                timeout: BigInt(timeout),
                remoteReceiver: 'orai1w0emvx75v79x2rm0afcw7sn8hqt5f4fhtd3pw7',
                memo: beginCell()
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('channel-0')).endCell())
                    .storeRef(beginCell().storeBuffer(Buffer.from('')).endCell())
                    .storeRef(
                        beginCell()
                            .storeBuffer(Buffer.from('orai1w0emvx75v79x2rm0afcw7sn8hqt5f4fhtd3pw7'))
                            .endCell(),
                    )
                    .endCell(),
            },
            {
                value: toNano(2),
                queryId: 0,
            },
        );
        printTransactionFees(result.transactions);

        const afterJettonBalance = (await usdtDeployerJettonWallet.getBalance()).amount;
        expect(-afterJettonBalance + beforeJettonBalance).toBe(20_000_000n);

        const bodyCell = result.transactions[result.transactions.length - 2].externals[0].body;
        expect(BigInt(bodyCell.asSlice().loadUint(32))).toBe(BigInt('0xa64c12a3'));

        console.log(
            'Bridge adapter balance:',
            (await blockchain.getContract(bridgeAdapter.address)).balance,
        );
        expect(result.transactions).toHaveTransaction({
            op: BridgeAdapterOpcodes.callbackDenom,
            success: true,
        });
        const senderAfterBalance = (await blockchain.getContract(usdtDeployer.getSender().address))
            .balance;
        expect(-senderBeforeBalance + senderAfterBalance).toBeLessThanOrEqual(toNano(0.15));

        //#region script fetch data
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getAckPacketProofs(
        //     queryClient,
        //     'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //     height,
        //     2n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/sendToCosmosTimeoutProof.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     height + 1,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/lightClientAckTonJettonTimeout.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion
        await updateBlock(lightClientAckTonJettonTimeout as any, deployer);
        // console.log(await lightClientMaster.getTrustedHeight());
        const sendToCosmosPacket = beginCell()
            .storeUint(0xa64c12a3, 32) // op
            .storeUint(2, 64) // seq
            .storeUint(Ack.Timeout, 2)
            .endCell();
        const existenceProofs = Object.values(sendToCosmosTimeoutProof)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);
        const result1 = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet: sendToCosmosPacket,
                provenHeight: height + 1,
            },
            { value: toNano('3') },
        );
        printTransactionFees(result1.transactions);

        const afterAfterJettonBalance = (await usdtDeployerJettonWallet.getBalance()).amount;
        expect(beforeJettonBalance - afterAfterJettonBalance).toBe(10_000_000n);
    });
});
