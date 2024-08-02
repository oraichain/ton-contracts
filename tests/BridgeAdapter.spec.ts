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
import * as lightClient_28349621 from './fixtures/light_client_28349621.json';
import * as lightClient_28352007 from './fixtures/light_client_28352007.json';
import * as lightClient_28353959 from './fixtures/light_client_28353959.json';
import * as lightClient_28358436 from './fixtures/light_client_28358436.json';
import * as lightClient_28359916 from './fixtures/light_client_28359916.json';
import * as lightClient_28388309 from './fixtures/light_client_28388309.json';
import * as lightClient_29129251 from './fixtures/light_client_29129251.json';

import * as bridgeToTonProofsSrcCosmos from './fixtures/bridgeToTonProofs.json';
import * as bridgeToTonProofsSrcTon from './fixtures/bridgeToTonProofs2.json';
import * as bridgeToTonProofsTon from './fixtures/bridgeToTonProofs3.json';
import * as bridgeToTonProofsTether from './fixtures/bridgeToTonProofs4.json';
import * as bridgeToTonProofs5 from './fixtures/bridgeToTonProofs5.json';
import * as multiplePacketProofs from './fixtures/multiplePacketProofs.json';
import * as sendToCosmosTimeoutProof from './fixtures/sendToCosmosTimeoutProof.json';
import * as sendToCosmosTimeoutOtherProof from './fixtures/sendToCosmosTimeoutOtherProof.json';

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fromBech32, toAscii, toBech32 } from '@cosmjs/encoding';
import { QueryClient } from '@cosmjs/stargate';
import { SerializedCommit, SerializedHeader, SerializedValidator } from '../wrappers/@types';
import { calculateIbcTimeoutTimestamp } from '../scripts/utils';
import { TetherMinter } from '../wrappers/TetherMinter';

describe('Cosmos->Ton BridgeAdapter', () => {
    let lightClientMasterCode: Cell;
    let bridgeAdapterCode: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    let whitelistDenomCode: Cell;
    let tetherMinterCode: Cell;
    let tetherWalletCode: Cell;

    const bridgeWasmAddress = 'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7';
    const bech32Address = fromBech32('orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx').data;
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
        lightClientMasterCode = await compile('LightClientMaster');
        bridgeAdapterCode = await compile('BridgeAdapter');
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
    let bridgeTetherAdapter: SandboxContract<BridgeAdapter>;
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
    const timeout = 1721983548;
    beforeEach(async () => {
        blockchain = await Blockchain.create({});
        blockchain.now = timeout - 3600;
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
        bridgeTetherAdapter = blockchain.openContract(
            BridgeAdapter.createFromConfig(
                {
                    light_client_master: lightClientMaster.address,
                    bridge_wasm_smart_contract: bridgeWasmAddress,
                    jetton_wallet_code: tetherWalletCode,
                    whitelist_denom: whitelistDenom.address,
                    paused: Paused.UNPAUSED,
                    admin: deployer.address,
                },
                bridgeAdapterCode,
            ),
        );

        const deployBridgeTetherResult = await bridgeTetherAdapter.sendDeploy(
            deployer.getSender(),
            {
                value: toNano('1'),
            },
        );
        expect(deployBridgeTetherResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeTetherAdapter.address,
            deploy: true,
            success: true,
        });
        printTransactionFees(deployBridgeTetherResult.transactions);

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
                toAddress: bridgeTetherAdapter.address,
                jettonAmount: toNano(333333),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        printTransactionFees(result.transactions);

        const tetherWalletAddress = await tetherMinterContract.getWalletAddress(
            bridgeTetherAdapter.address,
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
    });

    it('successfully deploy BridgeAdapter contract', async () => {
        console.log(
            Uint8Array.from(Buffer.from('Hi87NDAwrg5zUSaHWVV08GeCuPk=', 'base64')).join(','),
        );
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
        console.log({
            jettonMinterSrcCosmos: jettonMinterSrcCosmos.address,
            jettonMinterSrcTon: jettonMinterSrcTon.address,
            user: user.address,
            srcCosmos: TokenOrigin.COSMOS,
            srcTon: TokenOrigin.TON,
        });
    });

    it('should send jetton token_origin::cosmos to TON', async () => {
        console.log({
            remoteDenom: jettonMinterSrcCosmos.address,
            remoteReceiver: user.address,
            localSender: Buffer.from(
                fromBech32('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c').data,
            ).toString('base64'),
        });
        // console.log(Buffer.from(bech32Address).toString('base64'));

        const packet = beginCell()
            .storeUint(0xae89be5b, 32) // op
            .storeUint(1, 64) // seq
            .storeUint(TokenOrigin.COSMOS, 32) // token_origin
            .storeUint(transferAmount, 128) // remote_amount
            .storeUint(timeout, 64) // timeout_timestamp
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcCosmos.address) // remote_denom
            .storeRef(
                //  local_sender_ref
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
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
        //     28349620,
        //     1n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonProofs.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     28349621,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/light_client_${28349621}.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        // #endregion;

        await updateBlock(lightClient_28349621 as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsSrcCosmos)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight: 28349621,
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
        console.log({ jettonMinterSrcTon: jettonMinterSrcTon.address });

        const packet = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(2, 64)
            .storeUint(TokenOrigin.TON, 32)
            .storeUint(transferAmount, 128)
            .storeUint(timeout, 64)
            .storeAddress(user.address)
            .storeAddress(jettonMinterSrcTon.address)
            .storeRef(
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
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
        //     28352006,
        //     2n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonProofs2.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     28352007,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/light_client_${28352007}.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion

        await updateBlock(lightClient_28352007 as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsSrcTon)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight: 28352007,
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
        const timeout = 1751983548;
        const packet = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(5, 64)
            .storeUint(TokenOrigin.TON, 32)
            .storeUint(transferAmount, 128)
            .storeUint(timeout, 64)
            .storeAddress(user.address)
            .storeAddress(tetherMinterContract.address)
            .storeRef(
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
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
        //     28388308,
        //     5n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonProofs4.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     28388309,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/light_client_${28388309}.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion

        await updateBlock(lightClient_28388309 as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsTether)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeTetherAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight: 28388309,
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
        const packet = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(3, 64)
            .storeUint(TokenOrigin.TON, 32) // crcSrc
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeAddress(user.address) // remote_receiver
            .storeAddress(null) // remote_denom
            .storeRef(
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
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
        //     28353958,
        //     3n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonProofs3.json'),
        //     JSON.stringify(data),
        // );
        // const { header, lastCommit, validators } = await createUpdateClientData(
        //     'https://rpc.orai.io',
        //     28353959,
        // );
        // writeFileSync(
        //     resolve(__dirname, `./fixtures/light_client_${28353959}.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion

        // provenBlockHeight = proofHeight + 1;
        await updateBlock(lightClient_28353959 as any, deployer);
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
                provenHeight: 28353959,
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
    });

    it('should send ton to TON on failed case 02/08/2024', async () => {
        const boc = Cell.fromBoc(
            Buffer.from(
                'b5ee9c7241022a0100097800018062005f3429fa564af827014ca049ed9efa695208ae7986274050eb07eb87de74bf872017d7840000000000000000000000000000000000020000000000000000010114ff00f4a413f4bcf2c80b0202016203270202cb04190201200516020120061504add76d176fd99916380492f81f0686981f80880b8d8492f81f07d201801698f90c1087be812c2dd718110c1080d727ddddd474818c085dcfc208a780309f97a7809ed9e70410839b1684e29105d718110c108579aee42dd407140b0d04fc3121821029b92700bef2e457810bc1f845c000f2f4d33fd430d0d33fd4d43020d0d31f810bb8228210a64c12a3ba238210ae89be5bbab1f2f4c8028210ae89be5bba8e1f3035f84603c8cb3f5006cf1612cccc13ccc98210b4d4739a58cb1f12cb3fcce30ec970f841588040db3cf8488040f4866fa532f82391028ae85b0824090a00de6c12d33fd30130f849128040f40e6fa120c3ff8e2b5f060182100bebc200a18210d53276db708010c8cb055005cf1658fa0213cb6a12cb1fcb3fc973fb00db31e037810bc05007f2f4c85006cf1615cb01c9f84603c8cb3f5006cf1612cccc13ccc98210b4d4739a58cb1f12cb3fcc002ef8488040f47c6fa520c0ff9702f00e5230be309132e2580104db3c1401fe3101821008f0d180bef2e457810bc1f845c000f2f4d33ffa00fa40d30721aa0266d701d401d0fa40d33f3002d430f828f847523070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d00a810bb90bf0061af2f4c85006cf16c9c85006cf165006fa0215cb3f120c0142cb074300cf0113cc12ccc9821048328798c8cb1f12cb3fccc970f843588040db3c240498e302218210f21d3c89bae3023220c0018e9730810bb9f8425003f00612f2f4d33f31d30030f865db3ce020c0028e1430810bb9f8425003f00612f2f4d33f31d430fb04e0208210f941c229ba0e11141301fc6c21810bb9f8435003f00612f2f4d33fd430d0d207810bbb58f2f4d207fa40fa00d33fd30721aa0266d701d4d430d0c821cf16c9299682101f886e35968210123a01b1e2f8448210a64c12a3c8cb1fcb3fcb1f5280cb7f17cb3f15cb075003cf0125cf1613cc20c9d0f844f8498040f416f86912ccc9f844a4f86404c0000f02f68ecef828f847414070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d08210595f07bcc8cb1f5250cb3f58fa0258cf16c970598040db3c8e236c218210d53276db708010c8cb055003cf1622fa0212cb6acb1f5220cb3fc98042fb00e2f828f901022410014c830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00db3c1401fe3121820afaf080bef2e457810bc1f845c000f2f4d33fd430d08209312d0001fa00d33fd30721aa0266d701d430810bbd5367a052a0bcf2f45185a15006a1c829cf16c97082101f886e35f8448210a64c12a3c8cb1fcb3fcb1f17cb7f15cb3f13cb074500cf0112cb01cc20c9d0f844f8498040f416f86913ccc9f844a4f864120196f828f9015112830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb008210d53276db708010c8cb055005cf165003fa0213cb6acb1fcb3fc973fb00db3c1403b68e9630810bb9f8425003f00612f2f4d33f31d430f867db3ce0208210c6bffa9bba8e9730810bb9f8425003f00612f2f4d33f31fa4030f861db3ce0c0038e96810bb9f8425003f00612f2f4d33f31fa4030f862db3ce05b840ff2f01414140058f849c8f400c9f848c8f400c9f847f846f845f844c8f841cf16f842cf16f843cf16cb3fcb00ccccccccc9ed54001568c083e910c407e910c6ea0201f41718000f201035c8b5c2cfe0003b321b67409eaa43298c1400dbc088b000398ca6005bc880b2c1c85bb98c600201621a1b006b5ed44d0fa4001f861fa4001f862fa4001f863d33f01f864d30001f865d401f866d401f867d401d0f40430f868d401d0f40430f869d1802e1501d33fd430d0d300fa40d43020d0d31fd33fd31fd37fd33f08c0008e3b7125c8cb1f5250cb3fcb01c9f828f901511a830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00810bbef2f0de248210ae89be5bbae30235038210a64c12a3bae3025f0881c2204fc07fa40fa4030f8235009be8e3f10375f0732728210ae89be5bc8cb1f13cb3f12cb01c9f828f90102830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00e0f84852408040f40e6fa131e300228210123a01b1bae3000282101f886e35ba955b10266c32e30d03d0f84852408040f4161d1e1f210080718210ae89be5bc8cb1f5250cb3fcb01c9f828f901511a830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb00810bbaf2f0016a6d708210178d4519c8cb1f52b0cb3f24fa02cb0128cf1670fa02f400c98015c8cb1f52a0cb3f22cf162bfa02ccc97052928040db3c2404fe26d70b01c0008f1236078208989680a1505773db3c505273db3c8ee338f828f847417070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d06d6d82100f8a7ea5c8cb1f5290cb3f500afa025007cf165005cf1617f40070fa0214f400c97040338040db3c5033252524200004e201006ef8687001c8cb1f13cb3f12cb01c9f828f90102830771800cc8cb03cb01cb0813cbff216e967032cb61cb3f96327158cb61cce2c970fb0004fe05d30701aa02d70131fa40d301d430d0fa403001c0028f58810bbff8235006be15f2f4258210123a01b1ba8eb56d708210178d4519c8cb1f5290cb3f25fa02cb0126cf1670fa02f400c98015c8cb1f5280cb3f25cf1629fa02ccc97052228040db3cde0582101f886e35ba926c61e30d8e8d10245f046c223270018042db3c2423252603f624d70b01c0008f1434345143a18208989680a1503473db3c5973db3c8edc36f828f847415070546004131503c8cb0358fa0201cf1601cf16c921c8cb0113f40012f400cb00c9f9007074c8cb02ca07cbffc9d06d6d82100f8a7ea5c8cb1f17cb3f5005fa0258cf1658cf1613f40070fa02f400c970598040db3ce2252524002c718018c8cb055004cf165004fa0212cb6accc901fb000028708018c8cb055003cf165003fa02cb6ac901fb000014e2f8498040f45b30f8690201202829001bbfea7f808fc24c0207a0737d09840041bea5cf808fc23fc237c22fc22647c20e78b7c21678b7c21e78b659fe580666664c319ae239',
                'hex',
            ),
        )[0];
        const slice = boc.asSlice();
        const code = slice.loadRef();
        const bridgeWasmAddress = 'orai159l8l9c5ckhqpuwdfgs9p4v599nqt3cjlfahalmtrhfuncnec2ms5mz60e';
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
                code,
            ),
        );

        const deployBridgeResult = await bridgeAdapter.sendDeploy(deployer.getSender(), {
            value: toNano('10'),
        });
        expect(deployBridgeResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeAdapter.address,
            deploy: true,
            success: true,
        });

        const bech32Address = fromBech32('orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd').data;
        const packet = beginCell()
            .storeUint(2928262747, 32)
            .storeUint(29, 64)
            .storeUint(TokenOrigin.TON, 32) // crcSrc
            .storeUint(3000000000, 128) // amount
            .storeUint(1722600052, 64) // timeout
            .storeAddress(Address.parse('UQAW5Tsp2mMja-syAH_jw9j7a4dFICcaHHcq8xu0k-_YzpIW')) // remote_receiver
            .storeAddress(null) // remote_denom
            .storeRef(
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
                    .endCell(),
            )
            .endCell();
        const packet_cell = packet.hash();
        console.log(BigInt('0x' + packet_cell.toString('hex')));

        await deployer.getSender().send({
            to: Address.parse('UQAW5Tsp2mMja-syAH_jw9j7a4dFICcaHHcq8xu0k-_YzpIW'),
            value: toNano('0.1'),
        });

        //#region script fetch data
        const height = 29129250;
        const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        const queryClient = new QueryClient(tendermint37 as any);
        const data = await getPacketProofs(queryClient, bridgeWasmAddress, height, 29n);
        writeFileSync(
            resolve(__dirname, './fixtures/bridgeToTonProofs5.json'),
            JSON.stringify(data),
        );
        const { header, lastCommit, validators } = await createUpdateClientData(
            'https://rpc.orai.io',
            height + 1,
        );
        writeFileSync(
            resolve(__dirname, `./fixtures/light_client_${height + 1}.json`),
            JSON.stringify({ header, lastCommit, validators }),
        );
        //#endregion

        let provenBlockHeight = height + 1;
        await updateBlock(lightClient_29129251 as any, deployer);
        const existenceProofs = Object.values(bridgeToTonProofs5)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        let deployerBeforeBalance = (await deployer.getBalance()) - toNano('1');
        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight: provenBlockHeight,
            },
            { value: toNano('1') },
        );
        console.log('=====================================');
        printTransactionFees(sendRecvResult.transactions);
        prettyLogTransactions(sendRecvResult.transactions);
        let deployerAfterBalance = await deployer.getBalance();
        let updatedBalance = deployerAfterBalance - deployerBeforeBalance;
        expect(updatedBalance).toBeGreaterThan(500000000);
        expect(updatedBalance).toBeLessThan(622664000);
    });

    it('should send multiple packet to TON', async () => {
        const sendJettonSrcCosmosPacket = beginCell()
            .storeUint(0xae89be5b, 32) // op
            .storeUint(1, 64) // seq
            .storeUint(TokenOrigin.COSMOS, 32) // token_origin
            .storeUint(transferAmount, 128) // remote_amount
            .storeUint(timeout, 64) // timeout_timestamp
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcCosmos.address) // remote_denom
            .storeRef(
                //  local_sender_ref
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
                    .endCell(),
            )
            .endCell();

        const sendJettonSrcTonPacket = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(2, 64)
            .storeUint(TokenOrigin.TON, 32)
            .storeUint(transferAmount, 128)
            .storeUint(timeout, 64)
            .storeAddress(user.address)
            .storeAddress(jettonMinterSrcTon.address)
            .storeRef(
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
                    .endCell(),
            )
            .endCell();

        const sendTonPacket = beginCell()
            .storeUint(0xae89be5b, 32)
            .storeUint(3, 64)
            .storeUint(TokenOrigin.TON, 32) // crcSrc
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeAddress(user.address) // remote_receiver
            .storeAddress(null) // remote_denom
            .storeRef(
                beginCell()
                    .storeUint(bech32Address.length, 8)
                    .storeBuffer(Buffer.from(bech32Address))
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
        //         28353958,
        //         1n,
        //     ),
        //     getPacketProofs(
        //         queryClient,
        //         'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //         28353958,
        //         2n,
        //     ),
        //     getPacketProofs(
        //         queryClient,
        //         'orai1gzuxckyhl3qs2r4ccgy8nfh9p8200y6ug2kphp888lvlp7wkk23s6crhz7',
        //         28353958,
        //         3n,
        //     ),
        // ]);
        // writeFileSync(
        //     resolve(__dirname, './fixtures/multiplePacketProofs.json'),
        //     JSON.stringify(data),
        // );
        //#endregion

        // provenBlockHeight = proofHeight + 1;
        await updateBlock(lightClient_28353959 as any, deployer);
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
                provenHeight: 28353959,
            },
            { value: toNano('1') },
        );
        printTransactionFees(result.transactions);

        result = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendJettonSrcTon)!,
                packet: sendJettonSrcTonPacket,
                provenHeight: 28353959,
            },
            { value: toNano('1') },
        );
        printTransactionFees(result.transactions);

        result = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendTon)!,
                packet: sendTonPacket,
                provenHeight: 28353959,
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

        xit('should call all function failed after paused', async () => {
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
                { value: toNano('0.05') },
            );

            const usdtResultTransfer = await usdtDeployerJettonWallet.sendTransfer(
                usdtDeployer.getSender(),
                {
                    fwdAmount: toNano(1),
                    jettonAmount: toNano(333),
                    jettonMaster: usdtMinterContract.address,
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
        lightClientMasterCode = await compile('LightClientMaster');
        bridgeAdapterCode = await compile('BridgeAdapter');
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
    let bridgeTetherAdapter: SandboxContract<BridgeAdapter>;
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
        bridgeTetherAdapter = blockchain.openContract(
            BridgeAdapter.createFromConfig(
                {
                    light_client_master: lightClientMaster.address,
                    bridge_wasm_smart_contract: bridgeWasmAddress,
                    jetton_wallet_code: tetherWalletCode,
                    whitelist_denom: whitelistDenom.address,
                    paused: Paused.UNPAUSED,
                    admin: deployer.address,
                },
                bridgeAdapterCode,
            ),
        );

        const deployBridgeTetherResult = await bridgeTetherAdapter.sendDeploy(
            deployer.getSender(),
            {
                value: toNano('1'),
            },
        );
        expect(deployBridgeTetherResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: bridgeTetherAdapter.address,
            deploy: true,
            success: true,
        });
        printTransactionFees(deployBridgeTetherResult.transactions);

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
                toAddress: bridgeTetherAdapter.address,
                jettonAmount: toNano(333333),
                amount: toNano(0.5),
            },
            { value: toNano(1), queryId: 0 },
        );
        printTransactionFees(result.transactions);

        const tetherWalletAddress = await tetherMinterContract.getWalletAddress(
            bridgeTetherAdapter.address,
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
    });

    it('test getAckProof', async () => {
        const bodyCell = Cell.fromBoc(
            Buffer.from(
                'b5ee9c720102540100066c000118f7d02585000000000000000001021000000000019d229c02030472033fc219dfd37267058619767cfe83ea04f73deaceb3709cc647af24b70a672f52000e61636b5f636f6d6d69746d656e74000000000000000a040506070019a64c12a3000000000000000a2004087761736d5308090a009e22373836353832363135313237313635313537343237363835333638323235313837313138313432323832323035353838363331333633353837313536313833333430363230373239303430393422010800010101110302011213530040d08d6fb80f09f50dc2b97d72db03641a3befdfd2b5d6142af12f8f6de2166f6f0108000101010b0302010c0d530002000302010e0f53004201f847725d030c264067fb32cc05ac25b04ab1cc17bedd18bc0d9ac80ab7b1d991030201531053004201a72e3a639dd7031b15521b63eb9b811f0f6a849ff3df1df31d1d481f266313ed0042017e862defe0ff901cb72b5b7799cb06eb400024046beef3f18e8effccacd26a20000c0002b68ae91903020114151600500204b68ae91920dccf58a31120c7fb295eee3128a012c7edce80a09598a8a6c014a0779b57223520030201171853000e0406b68ae91920004220194a47d94947d62d9dd29a3b55009373329f24805b1d693623bacb59e46c75e9030201191a530050060eb68ae9192071c99a0519a986fa28d639e7c099e99359ec5d7e7393fdd5f5e61e6529af04df200302011b1c530050081cb68ae91920f24e640a12bc5142f47b8b6b10a7909d39430153087690e17bfc91604db456de200302011d1e1f00500a2eb68ae91920b7ade8304aa5c6ce1c9b4ef8da3283bd7a76c57154f59942e3e1a212954ce6a020030201202153000e0c44b68ae9192000422003cbc1b1e7ad3513f2734e29f05ed7530fee458739d864e97191c2ef40f2037103020122232400520e8001b68ae919205002b746a8faed5d85dd76c2e5f1d2bc3b60035b92f5bfbe864bd717fa8eb78d20030201252627001010ca01b68ae9192000422015a598f317ab9d89ba59c8d57e4f52a62d3299ac49951ca002c5fb2379fc9a6e030201282953001012ae03b68ae91920004220df5bea5961ccbd4d1775e0850bedc56e15d2dd5c937d4643268c241d6d099e2e0302012a2b2c005214b405b68ae91920046c3c5cd952c09e5aa87c1cdfd29496a0b17ddbe20f7f88208ccfb28de4f3ce200302012d2e2f001016e807b68ae9192000422017d6c738fc93fdf10b3e36e1adbf34616a98615d642fdbd9b7e0eebed85fd425030201303132001018ea0db68ae91920004220774ae69558102d0f6314224a7d2aaea6a6910dc1d6a21728cfe0b0aed7ae8ee603020133345300101af616b68ae91920004220f74ac30028dcc6fb800b3ae77936be3af51c53df7872edda97fb63955d4c1fd403020135363700521cf63ab68ae91920a5b60d5658143dca441c22fedce528599d51497f77953f7e705206a2feeec3212003020138395300101e8859b68ae91920004220cd39f2f2f24603ca7fec2410e81f2480475602c0e1dfa6106923ab69030cfd150302013a3b3c00542088b102b68ae91920442217615372ac5f7fcb56a9f177fa2f31962b2d32c5d090a5a944897f3cecdc200302013d3e3f001222a6aa03b68ae9192000422034ddedfa5e117e01ef04daffe62b150111acaa69aea4210e805c80eea9c86fa2030201404142001224bcb00ab68ae91920004220be70acb3f997478df269961a62f547124b1178622ab7ff72fde9ff4264bc0f31030201434445001226fc9e11b68ae9192000422071441dae7e3099ff80e00a50ae4f77a0304194acd044678f60b6d42ed2392eaf030201464748001228c89c1cb68ae919200042202ae56d65a6404d2a77cbdd2d8fd5386ce6af7580870b65bf30e13090183afac4030201494a4b00122a88852db68ae9192000422039630d3f4958cedaac0652b2df90dfc8a9ffd858b2be58378e1ce8a20dcec5a90302014c4d4e00122ca6d864b68ae91920004220f8ccac8b58e11e6b11ccebf665f396fa57c4138d84db8cc1e01b7bddb12f8b790302014f505100142ec494b501b68ae919200042206bad0f0e05da15ebf47be0968c698c9ca44e7df8c7737f42cf9ade2401186714030201535253001430fcc88d03b68ae919200042207a45c30d60cb9d683fedac3e848865fd0a193c2a6047bc69e0b3da11266c5c3b005632e2c48405b68ae91920b8c7e8870ea39ebaa319a2da5b0a789c62ed0d1d7de0db91411c5e1a8d15a227200000',
                'hex',
            ),
        )[0];
        const bodyCs = bodyCell.asSlice();
        console.log(bodyCs.loadUint(32).toString(16));
        console.log(BridgeAdapterOpcodes.bridgeRecvPacket.toString(16));
        const body = bodyCs.loadRef().asSlice();
        body.loadRef();
        const packet = body.loadRef().asSlice();
        console.log(packet.loadUint(32).toString(16));

        // const transaction = loadTransaction(
        //     Cell.fromBoc(
        //         Buffer.from(
        //             'b5ee9c72010211010003010003b572b5a568181d18297026b02442340fffccf120afdb7606c7fbaa9d9787f92447e00002b627c86d301af74e8e646a00f4eccfba31ec041dda7acb120387acc35d2d9ab974365e6e11b00002b627bb133816690e235000546cb632a80102030201e004050082726082e6b7a2eab9963ddaf62b296efce33786b7188720641ac73fe4248ea28a369843a0f96fb541a341e88ac232698045c753be605710590ead2d845cbd89710002170450890cc053f8186b8b14110f1001b16801dbca20284058a8f0ed1b13985948fe50d91fff9eebe8a0f9757dfae30d316e03000ad695a0607460a5c09ac09108d03fff33c482bf6dd81b1feeaa765e1fe4911f90cc053f8006148420000056c4f8939404cd21c448c0060201dd0a0b01181ae4fbbb0000000000000000070143c0053b7fd39b412240b430f87c07fa998947b7553eee39e15b0f0735b3d7147f68e8080193ae89be5b00000000000000071f886e350000000000000000000000003b9aca00000000006690efc28002dca7653b4c646d7d66400ffc787b1f6d70e8a404e3438ee55e6376927dfb19c409002a14d931bb907b6e9bc806af38d7240bf6f7a2765d680101200c0101200d00b1680056b4ad0303a3052e04d604884681fff99e2415fb6ec0d8ff7553b2f0ff2488fd0005b94eca7698c8dafacc801ff8f0f63edae1d14809c6871dcabcc6ed24fbf63390ee6b28000608235a000056c4f90da604cd21c46a40019fe0015ad2b40c0e8c14b8135812211a07ffe6789057edbb0363fdd54ecbc3fc9223f300da7a8d19481a973dd6fb67eb4380a528928cf6a18a2858862631e7293f59806600002b627c86d3036690e235600e0019ae89be5b000000000000000720009e47634c3d09000000000000000000f700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006fc986b5304c2562cc000000000004000000000005f87991754949694039a4accb1ddc186027164e56db2ef679fcae10c4e252b0e640d02cec',
        //             'hex',
        //         ),
        //     )[0].asSlice(),
        // );
        // const out = transaction.outMessages;
        // console.log(out.get(0));
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // await getAckPacketProofs(
        //     queryClient,
        //     'orai18lppnh7nwfnstpsewe70aql2qnmnm6kwkdcfe3j84ujtwzn89afqjp4pyr',
        //     26987149,
        //     5n,
        // );
        // const ack = beginCell()
        //     .storeUint(2790003363, 32)
        //     .storeUint(5, 64)
        //     .storeUint(TokenOrigin.TON, 32)
        //     .storeUint(10000, 128)
        //     .storeUint(1720698681, 64)
        //     .storeUint(fromBech32('orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd').data.length, 8)
        //     .storeBuffer(
        //         Buffer.from(fromBech32('orai1ehmhqcn8erf3dgavrca69zgp4rtxj5kqgtcnyd').data),
        //     )
        //     .storeAddress(Address.parse('EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA'))
        //     .storeUint(0, 2)
        //     .storeRef(
        //         beginCell()
        //             .storeAddress(Address.parse('EQAW5Tsp2mMja-syAH_jw9j7a4dFICcaHHcq8xu0k-_Yzs_T'))
        //             .endCell(),
        //     )
        //     .endCell();
        // const ackHash = ack.hash();
        // console.log(BigInt('0x' + ackHash.toString('hex')));
    });

    it('Test send jetton token from ton to bridge adapter', async () => {
        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: usdtMinterContract.address,
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
                jettonMaster: usdtMinterContract.address,
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

    it('Test timeout send jetton token from ton to bridge adapter', async () => {
        const height = 28358435;
        const timeout = 1720603835;
        console.log({
            denom: usdtMinterContract.address,
            sender: usdtDeployer.getSender().address,
        });

        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: usdtMinterContract.address,
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

        result = await usdtDeployerJettonWallet.sendTransfer(
            usdtDeployer.getSender(),
            {
                fwdAmount: toNano(1),
                jettonAmount: 10_000_000n,
                jettonMaster: usdtMinterContract.address,
                toAddress: bridgeAdapter.address,
                timeout: BigInt(timeout),
                remoteReceiver: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
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

        const afterJettonBalance = (await usdtDeployerJettonWallet.getBalance()).amount;
        expect(-afterJettonBalance + beforeJettonBalance).toBe(10_000_000n);

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
        //     1n,
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
        //     resolve(__dirname, `./fixtures/light_client_${height + 1}.json`),
        //     JSON.stringify({ header, lastCommit, validators }),
        // );
        //#endregion

        await updateBlock(lightClient_28358436 as any, deployer);
        const sendToCosmosPacket = beginCell()
            .storeUint(0xa64c12a3, 32) // op
            .storeUint(1, 64) // seq
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
        expect(afterAfterJettonBalance - beforeJettonBalance).toBe(0n);
    });

    it('Test send usdt from ton to bridge adapter', async () => {
        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: tetherMinterContract.address,
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

        let result = await whitelistDenom.sendSetDenom(
            deployer.getSender(),
            {
                denom: jettonMinterSrcCosmos.address,
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
        const userJettonWalletBalance = JettonWallet.createFromAddress(userJettonWallet);
        const wallet = blockchain.openContract(userJettonWalletBalance);

        console.log(deployer.getSender().address);
        console.log(jettonMinterSrcCosmos.address);
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
                denom: jettonMinterSrcCosmos.address,
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
                value: toNano(0.05),
            },
        );

        printTransactionFees(result.transactions);
    });
});
