import { Address, beginCell } from '@ton/core';
import { jsonToSliceRef, sliceRefToJson } from '../wrappers/BridgeAdapter';

describe('jsonToSliceRef', () => {
    it('should return a right cell', () => {
        const msg = {
            send_to_ton: {
                asset: {
                    info: {
                        token: {
                            contract_address: 'orai12315345123125125123',
                        },
                    },
                    amount: '1000000000',
                },
                ton_info: {
                    to: 'toTON',
                    denom: 'denom',
                    amount: 'amount',
                    src: 'Oraichain',
                    jetton_code: 'JettonCode',
                    from: 'oraiFrom',
                },
            },
        };
        let cell = jsonToSliceRef(msg);
        let json = sliceRefToJson(cell);
        const memo = beginCell()
            .storeAddress(Address.parse('EQBxlOhnrtcZ4dRSRsC4-ssHvcuhzvLVGZ_6wkUx461zqTg9'))
            .storeAddress(Address.parse('UQAN2U6sfupqIJ2QBvZImwUsUtiWXw7Il9x6JtdLRwZ9y5cN'))
            .storeCoins(10)
            .storeBuffer(Buffer.from('memo'))
            .endCell()
            .beginParse();
        console.log(memo.asCell().bits);
        console.log(memo.loadAddress());
        console.log(memo.loadAddress());
        console.log(memo.loadCoins());
    });
  
});
