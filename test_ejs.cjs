const path = require('path');
const fs = require('fs');
const ejsPath = path.resolve('src/node_modules/ejs/lib/cjs/ejs.js');
const ejs = require(ejsPath);
const compiled = ejs.compile('<%= "hello" %>');
fs.writeFileSync('compiled_ejs.txt', compiled.toString());
console.log('Written to compiled_ejs.txt');
