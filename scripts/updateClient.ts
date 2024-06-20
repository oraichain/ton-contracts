import { Address, toNano } from '@ton/core';
import { LightClient, LightClientOpcodes } from '../wrappers/LightClient';
import blockData from '../tests/fixtures/new_data.json';
import * as dotenv from 'dotenv';
import { createTonWallet, waitSeqno } from './utils';
import { TonClient } from '@ton/ton';
dotenv.config();

async function waitUpdateBlock(client: TonClient, lightClientAddress: Address, waitBlockNumber: number) {
    const txs = await client.getTransactions(lightClientAddress, { limit: 5 });
    for (const tx of txs) {
        const inMsg = tx.inMessage;
        if (inMsg?.info.type === 'internal') {
            const body = inMsg?.body.beginParse();
            if (body.remainingBits > 32) {
                const op = body.loadUint(32);
                body.skip(64);
                const realBody = body.loadRef().beginParse();
                if (op === LightClientOpcodes.verify_sigs) {
                    const commits = realBody.loadRef().beginParse();
                    const txHeight = commits.loadUint(32);
                    if (
                        txHeight == waitBlockNumber &&
                        tx.description.type === 'generic' &&
                        tx.description.computePhase.type === 'vm'
                    ) {
                        // assert transaction success
                        if (tx.description.computePhase.success && tx.description.actionPhase?.success) {
                            return { height: waitBlockNumber, txHash: tx.hash().toString('base64') };
                        } else {
                            throw new Error('Transaction failed');
                        }
                    }
                }
            }
        }
    }
    return { height: 0, txHash: null };
}

export async function updateClient() {
    var { client, walletContract, key } = await createTonWallet();
    const { header, commit, validators } = blockData;
    const lightClient = LightClient.createFromAddress(Address.parse(process.env.LIGHT_CLIENT as string));
    const lightClientContract = client.open(lightClient);
    // await lightClientContract.sendVerifyBlockHash(
    //     walletContract.sender(key.secretKey),
    //     {
    //         appHash: header.app_hash,
    //         chainId: header.chain_id,
    //         consensusHash: header.consensus_hash,
    //         dataHash: header.data_hash,
    //         evidenceHash: header.evidence_hash,
    //         height: BigInt(header.height),
    //         lastBlockId: header.last_block_id,
    //         lastCommitHash: header.last_commit_hash,
    //         lastResultsHash: header.last_results_hash,
    //         validatorHash: header.validators_hash,
    //         nextValidatorHash: header.next_validators_hash,
    //         proposerAddress: header.proposer_address,
    //         time: header.time,
    //         version: header.version,
    //     },
    //     validators,
    //     commit,
    //     { value: toNano('2') },
    // );
    // await waitSeqno(walletContract, await walletContract.getSeqno());

    while (true) {
        console.log('Waiting for update block:', parseInt(header.height));
        const { height, txHash } = await waitUpdateBlock(client, lightClient.address, parseInt(header.height));
        if (height && txHash) {
            console.log('Update block:', height, 'at', txHash);
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

updateClient()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .then(() => {
        console.log('done');
        process.exit(0);
    });
