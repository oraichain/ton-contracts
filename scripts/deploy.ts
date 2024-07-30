import { compile } from '@ton/blueprint';
import { createTonWallet, waitSeqno } from './utils';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { WhitelistDenom } from '../wrappers/WhitelistDenom';
import { BridgeAdapter, Paused } from '../wrappers/BridgeAdapter';
import { LightClientMaster } from '../wrappers/LightClientMaster';
import { iavlSpec, tendermintSpec } from '../wrappers/specs';
import { getSpecCell } from '../wrappers';
import { ProofSpec } from 'cosmjs-types/cosmos/ics23/v1/proofs';
import { TetherMinter } from '../wrappers/TetherMinter';
import { fromBech32, toBech32 } from '@cosmjs/encoding';

async function deploy() {
    // =================== Setup TON Wallet ===================
    const { client, walletContract, key } = await createTonWallet();
    // =================== End Setup TON Wallet ===================

    // =================== Deploy Contract ===================
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

    // LIGHT CLIENT
    const lightClientMaster = client.open(
        LightClientMaster.createFromConfig(
            {
                chainId: 'Oraichain',
                lightClientCode: await compile('LightClient'),
                specs: cellSpecs!,
                trustedHeight: 0,
                trustingPeriod: 14 * 86400,
            },
            await compile('LightClientMaster'),
        ),
    );
    // await lightClientMaster.sendDeploy(walletContract.sender(key.secretKey), toNano('0.1'));
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy light client at address: ', lightClientMaster.address);

    // USDT
    // const usdtMinterContract = client.open(
    //     TetherMinter.createFromConfig(
    //         {
    //             adminAddress: walletContract.address,
    //             content: beginCell()
    //                 .storeBuffer(Buffer.from('USDT Token'))
    //                 .storeBuffer(Buffer.from('USDT'))
    //                 .storeBuffer(Buffer.from('USDT token from Telegram OpenNetwork'))
    //                 .endCell(),
    //             jettonWalletCode: await compile('JettonWallet'),
    //         },
    //         await compile('TetherMinter'),
    //     ),
    // );
    // await usdtMinterContract.sendDeploy(walletContract.sender(key.secretKey), {
    //     value: toNano('1'),
    // });
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // console.log('Success deploy usdtContract at address: ', usdtMinterContract.address);

    // await usdtMinterContract.sendMint(
    //     walletContract.sender(key.secretKey),
    //     {
    //         toAddress: walletContract.address,
    //         jettonAmount: toNano(1_000_000),
    //         amount: toNano(0.5),
    //     },
    //     { value: toNano(1), queryId: 0 },
    // );

    const whitelistContract = client.open(
        WhitelistDenom.createFromConfig(
            {
                admin: walletContract.address,
            },
            await compile('WhitelistDenom'),
        ),
    );

    // await whitelistContract.sendDeploy(walletContract.sender(key.secretKey), toNano('0.1'));
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    console.log('Success deploy whitelistContract at address: ', whitelistContract.address);

    // await whitelistContract.sendSetDenom(
    //     walletContract.sender(key.secretKey),
    //     {
    //         denom: Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'),
    //         isRootFromTon: true,
    //         permission: true,
    //     },
    //     {
    //         value: toNano('1'),
    //     },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());

    // old old: EQArWlaBgdGClwJrAkQjQP_8zxIK_bdgbH-6qdl4f5JEfo3r
    // BRIDGE ADAPTER
    const tonBridge = BridgeAdapter.createFromAddress(
        Address.parse('EQASlo5_ZTuknZ5oZkM7RmPXN2oNOKk3usg4NMYBDf2VsTwk'),
    );
    const tonBridgeContract = client.open(tonBridge);

    await tonBridgeContract.sendUpgradeContract(
        walletContract.sender(key.secretKey),
        await compile('BridgeAdapter'),
        {
            value: toNano('0.03'),
        },
    );
    await waitSeqno(walletContract, await walletContract.getSeqno());

    // const tonBridge = BridgeAdapter.createFromConfig(
    //     {
    //         light_client_master: lightClientMaster.address, // just fake it for demo
    //         jetton_wallet_code: Cell.fromBoc(
    //             Buffer.from(
    //                 'b5ee9c72010101010023000842028f452d7a4dfd74066b682365177259ed05734435be76b5fd4bd5d8af2b7c3d68',
    //                 'hex',
    //             ),
    //         )[0],
    //         bridge_wasm_smart_contract:
    //             'orai1f8yer2astssamnyzzp6yvk6q5h49kzj2gu0n7rct8uj38pswy7lqwa8mdw',
    //         whitelist_denom: whitelistContract.address,
    //         admin: walletContract.address!,
    //         paused: Paused.UNPAUSED,
    //     },
    //     await compile('BridgeAdapter'),
    // );

    // const tonBridgeContract = client.open(tonBridge);
    // await tonBridgeContract.sendDeploy(walletContract.sender(key.secretKey), {
    //     value: toNano('0.1'),
    // });
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // console.log('Success deploy tonBridgeContract at address: ', tonBridgeContract.address);

    // const cell = (await tonBridgeContract.getBridgeData()).readCell();
    // console.log(BridgeAdapter.parseBridgeDataResponse(cell));
    // const packet = await tonBridgeContract.getSendPacketCommitment(1n);
    // console.log(BigInt('0x' + packet.hash().toString('hex')));

    // This one we consider it as orai token
    // const jettonMinterSrcCosmos = client.open(
    //     JettonMinter.createFromConfig(
    //         {
    //             adminAddress: tonBridge.address,
    //             content: beginCell()
    //                 .storeBuffer(Buffer.from('ORAI Token'))
    //                 .storeBuffer(Buffer.from('ORAI'))
    //                 .storeBuffer(Buffer.from('ORAI token from Oraichain'))
    //                 .endCell(),
    //             jettonWalletCode: await compile('JettonWallet'),
    //         },
    //         await compile('JettonMinter'),
    //     ),
    // );
    // await jettonMinterSrcCosmos.sendDeploy(walletContract.sender(key.secretKey), { value: toNano('3') });
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // console.log('Success deploy jettonMinterSrcCosmos at address: ', jettonMinterSrcCosmos.address);

    // await whitelistContract.sendSetDenom(
    //     walletContract.sender(key.secretKey),
    //     {
    //         denom: Address.parse('EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA'),
    //         isRootFromTon: true,
    //         permission: true,
    //     },
    //     {
    //         value: toNano('0.1'),
    //     },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());
    // await whitelistContract.sendSetDenom(
    //     walletContract.sender(key.secretKey),
    //     {
    //         denom: Address.parse('EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728'),
    //         isRootFromTon: true,
    //         permission: true,
    //     },
    //     {
    //         value: toNano('0.1'),
    //     },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());
}

deploy()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .then(() => {
        console.log('done');
        process.exit(0);
    });
