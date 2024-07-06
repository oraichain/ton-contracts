import { Blockchain, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { BridgeAdapter, Src } from '../wrappers/BridgeAdapter';
import { JettonMinter } from '../wrappers/JettonMinter';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { JettonWallet } from '../wrappers/JettonWallet';
import {
    createUpdateClientData,
    deserializeCommit,
    deserializeHeader,
    deserializeValidator,
    getExistenceProofSnakeCell,
    getPacketProofs,
    getSpecCell,
} from '../wrappers/utils';
import { LightClientMaster, LightClientMasterOpcodes } from '../wrappers/LightClientMaster';
import { iavlSpec, tendermintSpec } from '../wrappers/specs';
import { ExistenceProof, ProofSpec } from 'cosmjs-types/cosmos/ics23/v1/proofs';
import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
import * as bridgeToTonProofsSrcCosmos from './fixtures/bridgeToTonProofs.json';
import * as bridgeToTonProofsSrcTon from './fixtures/bridgeToTonProofs2.json';
import * as bridgeToTonProofsTon from './fixtures/bridgeToTonProofs3.json';
import * as multiplePacketProofs from './fixtures/multiplePacketProofs.json';

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { fromBech32, toAscii } from '@cosmjs/encoding';
import { QueryClient } from '@cosmjs/stargate';

describe('BridgeAdapter', () => {
    let lightClientMasterCode: Cell;
    let bridgeAdapterCode: Cell;
    let jettonWalletCode: Cell;
    let jettonMinterCode: Cell;
    let whitelistDenomCode: Cell;

    const bridgeWasmAddress = 'orai1f3sgqnj7z7sk7fwak3wa6kx7xlamzmdqse3a886rpvtg9pl2xrxqtffnk6';
    const updateBlock = async (blockNumber: number, relayer: SandboxContract<TreasuryContract>) => {
        const { header, lastCommit, validators } = await createUpdateClientData(
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
            {
                value: toNano('10'),
            },
        );
        printTransactionFees(result.transactions);
        expect(result.transactions).toHaveTransaction({
            op: LightClientMasterOpcodes.verify_block_hash,
            success: true,
        });
        console.log(`blockhash:`, LightClientMasterOpcodes.verify_block_hash);
        expect(await lightClientMaster.getTrustedHeight()).toBe(blockNumber);
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

    // packet info
    const transferAmount = 10000000n;
    const timeout = 1751623658;
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
        const stack = await bridgeAdapter.getBridgeData();
        expect(stack.readCell().toBoc()).toEqual(
            beginCell().storeAddress(lightClientMaster.address).endCell().toBoc(),
        );
        expect(stack.readBuffer().compare(Buffer.from(fromBech32(bridgeWasmAddress).data))).toEqual(
            0,
        );
        expect(stack.readCell().toBoc()).toEqual(jettonWalletCode.toBoc());
    });

    it('should log data persist data to test', async () => {
        console.log({
            jettonMinterSrcCosmos: jettonMinterSrcCosmos.address,
            jettonMinterSrcTon: jettonMinterSrcTon.address,
            user: user.address,
            srcCosmos: Src.COSMOS,
            srcTon: Src.TON,
        });
    });

    it('should send jetton src::cosmos to TON', async () => {
        const packet = beginCell()
            .storeUint(1, 64) // seq
            .storeUint(0xae89be5b, 32) // op
            .storeUint(Src.COSMOS, 32) // crcSrc
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcCosmos.address) // remote_denom
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeRef(
                beginCell()
                    .storeBuffer(Buffer.from('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c')) //  local_sender
                    .endCell(),
            )
            .endCell();
        const packet_cell = packet.hash();
        console.log(packet_cell.toString('base64'));
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getPacketProofs(
        //     queryClient,
        //     'orai1f3sgqnj7z7sk7fwak3wa6kx7xlamzmdqse3a886rpvtg9pl2xrxqtffnk6',
        //     26380739,
        //     1n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonProofs.json'),
        //     JSON.stringify(data),
        // );
        await updateBlock(26380740, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsSrcCosmos)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight: 26380740,
            },
            { value: toNano('1') },
        );

        printTransactionFees(sendRecvResult.transactions);
        const userJettonWallet = await jettonMinterSrcCosmos.getWalletAddress(user.address);
        const wallet = blockchain.openContract(JettonWallet.createFromAddress(userJettonWallet));
        const balance = await wallet.getBalance();
        expect(balance.amount).toBe(transferAmount);
    });

    it('should send jetton src::ton to TON', async () => {
        const packet = beginCell()
            .storeUint(2, 64) // seq
            .storeUint(0xae89be5b, 32) // op
            .storeUint(3724195509, 32) // crcSrc
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcTon.address) // remote_denom
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeRef(
                beginCell()
                    .storeBuffer(Buffer.from('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c')) //  local_sender
                    .endCell(),
            )
            .endCell();
        const packet_cell = packet.hash();
        console.log(packet_cell.toString('base64'));
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getPacketProofs(
        //     queryClient,
        //     'orai1f3sgqnj7z7sk7fwak3wa6kx7xlamzmdqse3a886rpvtg9pl2xrxqtffnk6',
        //     26380739,
        //     2n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonProofs2.json'),
        //     JSON.stringify(data),
        // );
        await updateBlock(26380740, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsSrcTon)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight: 26380740,
            },
            { value: toNano('1') },
        );

        printTransactionFees(sendRecvResult.transactions);
        const userJettonWallet = await jettonMinterSrcTon.getWalletAddress(user.address);
        const wallet = blockchain.openContract(JettonWallet.createFromAddress(userJettonWallet));
        const balance = await wallet.getBalance();
        expect(balance.amount).toBe(transferAmount);
    });

    it('should send ton to TON', async () => {
        const packet = beginCell()
            .storeUint(4, 64) // seq
            .storeUint(0xae89be5b, 32) // op
            .storeUint(3724195509, 32) // crcSrc
            .storeAddress(user.address) // remote_receiver
            .storeAddress(null) // remote_denom
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeRef(
                beginCell()
                    .storeBuffer(Buffer.from('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c')) //  local_sender
                    .endCell(),
            )
            .endCell();
        const packet_cell = packet.hash();
        console.log(packet_cell.toString('base64'));
        // console.log(packet_cell.toString('base64'));
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await getPacketProofs(
        //     queryClient,
        //     'orai1f3sgqnj7z7sk7fwak3wa6kx7xlamzmdqse3a886rpvtg9pl2xrxqtffnk6',
        //     26460741,
        //     4n,
        // );
        // writeFileSync(
        //     resolve(__dirname, './fixtures/bridgeToTonProofs3.json'),
        //     JSON.stringify(data),
        // );
        // provenBlockHeight = proofHeight + 1
        await updateBlock(26460742, deployer);
        const existenceProofs = Object.values(bridgeToTonProofsTon)
            .slice(0, 2)
            .map(ExistenceProof.fromJSON);

        const sendRecvResult = await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(existenceProofs)!,
                packet,
                provenHeight: 26460742,
            },
            { value: toNano('1') },
        );

        printTransactionFees(sendRecvResult.transactions);
        const userTonBalance = await user.getBalance();
        expect(userTonBalance).toBeGreaterThan(9000000n);
        expect(userTonBalance).toBeLessThan(transferAmount);
    });

    it('should send multiple packet to TON', async () => {
        const sendJettonSrcCosmosPacket = beginCell()
            .storeUint(1, 64) // seq
            .storeUint(0xae89be5b, 32) // op
            .storeUint(Src.COSMOS, 32) // crcSrc
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcCosmos.address) // remote_denom
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeRef(
                beginCell()
                    .storeBuffer(Buffer.from('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c')) //  local_sender
                    .endCell(),
            )
            .endCell();

        const sendJettonSrcTonPacket = beginCell()
            .storeUint(2, 64) // seq
            .storeUint(0xae89be5b, 32) // op
            .storeUint(3724195509, 32) // crcSrc
            .storeAddress(user.address) // remote_receiver
            .storeAddress(jettonMinterSrcTon.address) // remote_denom
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeRef(
                beginCell()
                    .storeBuffer(Buffer.from('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c')) //  local_sender
                    .endCell(),
            )
            .endCell();

        const sendTonPacket = beginCell()
            .storeUint(4, 64) // seq
            .storeUint(0xae89be5b, 32) // op
            .storeUint(3724195509, 32) // crcSrc
            .storeAddress(user.address) // remote_receiver
            .storeAddress(null) // remote_denom
            .storeUint(transferAmount, 128) // amount
            .storeUint(timeout, 64) // timeout
            .storeRef(
                beginCell()
                    .storeBuffer(Buffer.from('orai12p0ywjwcpa500r9fuf0hly78zyjeltakrzkv0c')) //  local_sender
                    .endCell(),
            )
            .endCell();

        //#region script getProofs
        // const tendermint37 = await Tendermint37Client.connect('https://rpc.orai.io');
        // const queryClient = new QueryClient(tendermint37 as any);
        // const data = await Promise.all([
        //     getPacketProofs(
        //         queryClient,
        //         'orai1f3sgqnj7z7sk7fwak3wa6kx7xlamzmdqse3a886rpvtg9pl2xrxqtffnk6',
        //         26460741,
        //         1n,
        //     ),
        //     getPacketProofs(
        //         queryClient,
        //         'orai1f3sgqnj7z7sk7fwak3wa6kx7xlamzmdqse3a886rpvtg9pl2xrxqtffnk6',
        //         26460741,
        //         2n,
        //     ),
        //     getPacketProofs(
        //         queryClient,
        //         'orai1f3sgqnj7z7sk7fwak3wa6kx7xlamzmdqse3a886rpvtg9pl2xrxqtffnk6',
        //         26460741,
        //         4n,
        //     ),
        // ]);
        // writeFileSync(
        //     resolve(__dirname, './fixtures/multiplePacketProofs.json'),
        //     JSON.stringify(data),
        // );
        //#endregion

        // provenBlockHeight = proofHeight + 1
        await updateBlock(26460742, deployer);
        const existenceProofs = Object.values(multiplePacketProofs)
            .slice(0, 3) // cut the default property
            .flat()
            .map(ExistenceProof.fromJSON);
        const proofSendJettonSrcCosmos = existenceProofs.slice(0, 2);
        const proofSendJettonSrcTon = existenceProofs.slice(2, 4);
        const proofSendTon = existenceProofs.slice(4, 6);

        await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendJettonSrcCosmos)!,
                packet: sendJettonSrcCosmosPacket,
                provenHeight: 26460742,
            },
            { value: toNano('1') },
        );
        await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendJettonSrcTon)!,
                packet: sendJettonSrcTonPacket,
                provenHeight: 26460742,
            },
            { value: toNano('1') },
        );
        await bridgeAdapter.sendBridgeRecvPacket(
            deployer.getSender(),
            {
                proofs: getExistenceProofSnakeCell(proofSendTon)!,
                packet: sendTonPacket,
                provenHeight: 26460742,
            },
            { value: toNano('1') },
        );

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
