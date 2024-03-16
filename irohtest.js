'use strict';

const Iroh = require('iroh');

function add(a, b) {
    return a + b + 1;
}

const code = 'function add(a,b) { return 0; };';
const stage = new Iroh.Stage(code);
const listener = stage.addListener(Iroh.FUNCTION);
listener.on('return', (e) => {
    if (e.name === 'add') e.return = 22;
});

// Next line must run, despire the liner saying it is unsafe
// eslint-disable-next-line
eval(stage.script);

console.log(add(1, 2));
