const Iroh = require("iroh");

function add(a, b) {
    return a + b + 1;
};

let code  = 'function add(a,b) { return 0; };';
let stage = new Iroh.Stage(code);
let listener = stage.addListener(Iroh.FUNCTION);
listener.on("return", (e) => {
  if (e.name === "add") e.return = 22;
});
eval(stage.script);


console.log(add(1,2));  