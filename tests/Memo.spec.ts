import { compile } from '@ton/blueprint';
import { Address, beginCell, Cell } from '@ton/core';
import '@ton/test-utils';

describe('Memo', () => {
    beforeEach(async () => {});

    it('encode memo', async () => {
        const data = {
            from: 'orai1rchnkdpsxzhquu63y6r4j4t57pnc9w8ehdhedx',
            to: 'UQAW5Tsp2mMja-syAH_jw9j7a4dFICcaHHcq8xu0k-_YzpIW',
            denom: 'UQDqdOQfqhnGaIjaZ-qdG-e2eyaLkopDsrwuMze3lIS1INRD',
            amount: '10000000',
            src: '4e545f4',
            jettonCode: await compile('JettonWallet'),
        };
        console.log(JSON.stringify(data));
        // const cell = beginCell()
        //     .storeAddress(Address.parse(data.to))
        //     .storeAddress(Address.parse(data.denom))
        //     .storeUint(BigInt(data.amount), 128)
        //     .storeRef(beginCell().storeBuffer(Buffer.from(data.src)).endCell())
        //     .storeRef(data.jettonCode)
        //     .storeRef(beginCell().storeBuffer(Buffer.from(data.from)).endCell())
        //     .endCell();

        // console.log('Cell', Cell.fromBoc(cell.toBoc())[0]);
    });
});
