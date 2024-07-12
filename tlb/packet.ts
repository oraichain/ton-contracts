import { Builder } from '@ton/core'
import { Slice } from '@ton/core'
import { beginCell } from '@ton/core'
import { BitString } from '@ton/core'
import { Cell } from '@ton/core'
import { Address } from '@ton/core'
import { ExternalAddress } from '@ton/core'
import { Dictionary } from '@ton/core'
import { DictionaryValue } from '@ton/core'
export function bitLen(n: number) {
    return n.toString(2).length;
}

/*
packet#ae89be5b seq:(## 64) token_origin:(## 32) remote_amount:(## 128) timeout_timestamp: (## 64)
remote_receiver: MsgAddressInt remote_denom: MsgAddressInt ^[local_sender_byte_len: (## 8) local_sender: Any] = PacketSendToTon;
*/

export interface PacketSendToTon {
    readonly kind: 'PacketSendToTon';
    readonly seq: number;
    readonly token_origin: number;
    readonly remote_amount: bigint;
    readonly timeout_timestamp: number;
    readonly remote_receiver: Address;
    readonly remote_denom: Address;
    readonly local_sender_byte_len: number;
    readonly local_sender: Cell;
}

/*
packet#a64c12a3 seq:(## 64) token_origin:(## 32) local_amount:(## 128) timeout_timestamp: (## 64)
remote_receiver_byte_len:(## 8) remote_receiver: Any local_denom: MsgAddressInt ^[local_sender: MsgAddressInt] = PacketSendToCosmos;
*/

export interface PacketSendToCosmos {
    readonly kind: 'PacketSendToCosmos';
    readonly seq: number;
    readonly token_origin: number;
    readonly local_amount: bigint;
    readonly timeout_timestamp: number;
    readonly remote_receiver_byte_len: number;
    readonly remote_receiver: Cell;
    readonly local_denom: Address;
    readonly local_sender: Address;
}

/*
msg#_ dest_denom_byte_len:(## 8) dest_denom: Any dest_receiver_byte_len:(## 8) dest_receiver: Any 
dest_channel_len:(## 8) dest_channel: Any = UniversalSwapMsg;
*/

export interface UniversalSwapMsg {
    readonly kind: 'UniversalSwapMsg';
    readonly dest_denom_byte_len: number;
    readonly dest_denom: Cell;
    readonly dest_receiver_byte_len: number;
    readonly dest_receiver: Cell;
    readonly dest_channel_len: number;
    readonly dest_channel: Cell;
}

/*
packet#ae89be5b seq:(## 64) token_origin:(## 32) remote_amount:(## 128) timeout_timestamp: (## 64)
remote_receiver: MsgAddressInt remote_denom: MsgAddressInt ^[local_sender_byte_len: (## 8) local_sender: Any] = PacketSendToTon;
*/

export function loadPacketSendToTon(slice: Slice): PacketSendToTon {
    if (((slice.remainingBits >= 32) && (slice.preloadUint(32) == 0xae89be5b))) {
        slice.loadUint(32);
        let seq: number = slice.loadUint(64);
        let token_origin: number = slice.loadUint(32);
        let remote_amount: bigint = slice.loadUintBig(128);
        let timeout_timestamp: number = slice.loadUint(64);
        let remote_receiver: Address = slice.loadAddress();
        let remote_denom: Address = slice.loadAddress();
        let slice1 = slice.loadRef().beginParse(true);
        let local_sender_byte_len: number = slice1.loadUint(8);
        let local_sender: Cell = slice1.asCell();
        return {
            kind: 'PacketSendToTon',
            seq: seq,
            token_origin: token_origin,
            remote_amount: remote_amount,
            timeout_timestamp: timeout_timestamp,
            remote_receiver: remote_receiver,
            remote_denom: remote_denom,
            local_sender_byte_len: local_sender_byte_len,
            local_sender: local_sender,
        }

    }
    throw new Error('Expected one of "PacketSendToTon" in loading "PacketSendToTon", but data does not satisfy any constructor');
}

export function storePacketSendToTon(packetSendToTon: PacketSendToTon): (builder: Builder) => void {
    return ((builder: Builder) => {
        builder.storeUint(0xae89be5b, 32);
        builder.storeUint(packetSendToTon.seq, 64);
        builder.storeUint(packetSendToTon.token_origin, 32);
        builder.storeUint(packetSendToTon.remote_amount, 128);
        builder.storeUint(packetSendToTon.timeout_timestamp, 64);
        builder.storeAddress(packetSendToTon.remote_receiver);
        builder.storeAddress(packetSendToTon.remote_denom);
        let cell1 = beginCell();
        cell1.storeUint(packetSendToTon.local_sender_byte_len, 8);
        cell1.storeSlice(packetSendToTon.local_sender.beginParse(true));
        builder.storeRef(cell1);
    })

}

/*
packet#a64c12a3 seq:(## 64) token_origin:(## 32) local_amount:(## 128) timeout_timestamp: (## 64)
remote_receiver_byte_len:(## 8) remote_receiver: Any local_denom: MsgAddressInt ^[local_sender: MsgAddressInt] = PacketSendToCosmos;
*/

export function loadPacketSendToCosmos(slice: Slice): PacketSendToCosmos {
    if (((slice.remainingBits >= 32) && (slice.preloadUint(32) == 0xa64c12a3))) {
        slice.loadUint(32);
        let seq: number = slice.loadUint(64);
        let token_origin: number = slice.loadUint(32);
        let local_amount: bigint = slice.loadUintBig(128);
        let timeout_timestamp: number = slice.loadUint(64);
        let remote_receiver_byte_len: number = slice.loadUint(8);
        let remote_receiver: Cell = slice.asCell();
        let local_denom: Address = slice.loadAddress();
        let slice1 = slice.loadRef().beginParse(true);
        let local_sender: Address = slice1.loadAddress();
        return {
            kind: 'PacketSendToCosmos',
            seq: seq,
            token_origin: token_origin,
            local_amount: local_amount,
            timeout_timestamp: timeout_timestamp,
            remote_receiver_byte_len: remote_receiver_byte_len,
            remote_receiver: remote_receiver,
            local_denom: local_denom,
            local_sender: local_sender,
        }

    }
    throw new Error('Expected one of "PacketSendToCosmos" in loading "PacketSendToCosmos", but data does not satisfy any constructor');
}

export function storePacketSendToCosmos(packetSendToCosmos: PacketSendToCosmos): (builder: Builder) => void {
    return ((builder: Builder) => {
        builder.storeUint(0xa64c12a3, 32);
        builder.storeUint(packetSendToCosmos.seq, 64);
        builder.storeUint(packetSendToCosmos.token_origin, 32);
        builder.storeUint(packetSendToCosmos.local_amount, 128);
        builder.storeUint(packetSendToCosmos.timeout_timestamp, 64);
        builder.storeUint(packetSendToCosmos.remote_receiver_byte_len, 8);
        builder.storeSlice(packetSendToCosmos.remote_receiver.beginParse(true));
        builder.storeAddress(packetSendToCosmos.local_denom);
        let cell1 = beginCell();
        cell1.storeAddress(packetSendToCosmos.local_sender);
        builder.storeRef(cell1);
    })

}

/*
msg#_ dest_denom_byte_len:(## 8) dest_denom: Any dest_receiver_byte_len:(## 8) dest_receiver: Any 
dest_channel_len:(## 8) dest_channel: Any = UniversalSwapMsg;
*/

export function loadUniversalSwapMsg(slice: Slice): UniversalSwapMsg {
    let dest_denom_byte_len: number = slice.loadUint(8);
    let dest_denom: Cell = slice.asCell();
    let dest_receiver_byte_len: number = slice.loadUint(8);
    let dest_receiver: Cell = slice.asCell();
    let dest_channel_len: number = slice.loadUint(8);
    let dest_channel: Cell = slice.asCell();
    return {
        kind: 'UniversalSwapMsg',
        dest_denom_byte_len: dest_denom_byte_len,
        dest_denom: dest_denom,
        dest_receiver_byte_len: dest_receiver_byte_len,
        dest_receiver: dest_receiver,
        dest_channel_len: dest_channel_len,
        dest_channel: dest_channel,
    }

}

export function storeUniversalSwapMsg(universalSwapMsg: UniversalSwapMsg): (builder: Builder) => void {
    return ((builder: Builder) => {
        builder.storeUint(universalSwapMsg.dest_denom_byte_len, 8);
        builder.storeSlice(universalSwapMsg.dest_denom.beginParse(true));
        builder.storeUint(universalSwapMsg.dest_receiver_byte_len, 8);
        builder.storeSlice(universalSwapMsg.dest_receiver.beginParse(true));
        builder.storeUint(universalSwapMsg.dest_channel_len, 8);
        builder.storeSlice(universalSwapMsg.dest_channel.beginParse(true));
    })

}

