let a = Buffer.alloc(68);
let b = Buffer.from('3031323334353637383930313233343536373839303132333435363738393031');
a[0] = 0x0a;
a[1] = b.length;
b.copy(a, 2);
// console.log(a);

// console.log(Buffer.from('1624DE6420', 'hex'));

console.log(Buffer.from('Oraichain'));
