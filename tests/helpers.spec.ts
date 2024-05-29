import { jsonToSliceRef } from "../wrappers/BridgeAdapter";

describe("jsonToSliceRef", ()=>{
    it("should return a right cell", ()=>{
        const msg = {
            "send_to_ton":{
                "asset": {
                    "info":{
                        "token":{
                            "contract_address":"orai12315345123125125123"
                        }
                    },
                    "amount":"1000000000"
                    },
                "ton_info":{
                    "to": "toTON",
                    "denom": "denom",
                    "amount": "amount",
                    "src": "Oraichain",
                    "jetton_code": "JettonCode",
                    "from": "oraiFrom"
                 }          
                }
        }
        let cell = jsonToSliceRef(msg, true);
    
        while(cell.beginParse().remainingRefs > 0){
            let slice = cell.beginParse();
            const nextRef = slice.loadRef();
            const key = slice.loadRef();
            const value = slice.loadRef();
            console.log(key);
            cell = nextRef;
        }
    })
})