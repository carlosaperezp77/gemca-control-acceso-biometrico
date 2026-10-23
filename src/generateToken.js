// Genera un token nuevo para configurar un equipo:
//   node src/generateToken.js
const { generateToken } = require("./config");
console.log(generateToken());
